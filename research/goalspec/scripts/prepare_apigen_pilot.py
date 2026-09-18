"""Ingest pinned APIGen and prepare a pre-actor 100-record annotation queue.

Family grouping is a conservative, visible-request taxonomy that requires review
before use in a scientific held-out run. No goal labels or native verification
are inferred from source-reported successful endpoints.
"""
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from goalspec.corpus import annotation_pilot, ingest, records

INTENTS = {
    "cancel": r"cancel", "return": r"return|refund", "exchange": r"exchange|replace",
    "modify": r"change|modify|update", "book": r"book|reserv", "status": r"status|track|where",
    "baggage": r"bag|luggage", "payment": r"pay|credit|gift.card", "search": r"find|search|available",
}


def family(row):
    tools = json.loads(row["tools"])
    names = {t.get("name", t.get("function", {}).get("name")) for t in tools}
    domain = "airline" if "get_reservation_details" in names else "retail" if "get_order_details" in names else "unknown"
    request = next((m["value"] for m in row["conversations"] if m["from"] == "human"), "").lower()
    intents = sorted(name for name, pattern in INTENTS.items() if re.search(pattern, request))
    return domain + ":" + ("+".join(intents) or "other")


def main():
    root = Path(__file__).resolve().parents[1]
    pin = json.loads((root / "dataset-releases.lock.json").read_text())["releases"]["apigen"]
    acquired = root / "runs" / f"apigen-{pin['revision']}"
    source = acquired / "apigen-mt_5k.json"
    assignments = {}
    for index, row in enumerate(records(source)):
        key = family(row)
        bucket = int(hashlib.sha256(("goalspec-apigen-family-v1:" + key).encode()).hexdigest()[:8], 16) % 100
        assignments[str(index)] = (key, "train" if bucket < 70 else "development" if bucket < 85 else "test")
    (acquired / "family-assignments.json").write_text(json.dumps(assignments, indent=2) + "\n", encoding="utf-8")
    destination = acquired / "ingested"
    manifest = ingest(source, destination, "apigen", pin["revision"],
                      "CC BY-NC 4.0; research purposes only; preserve Salesforce APIGen-MT attribution and source-card restrictions. Card SHA256: " + pin["card_sha256"],
                      assignments, acquired / "cross-source-dedup.sqlite3")
    # Bound candidate retention independently of corpus size.
    candidates = defaultdict(list)
    for row in records(destination / "episodes.jsonl"):
        if row["split"] == "train" and len(candidates[row["family_id"]]) < 100:
            candidates[row["family_id"]].append(row)
    selected = annotation_pilot([r for rows in candidates.values() for r in rows])
    queue = []
    for row in selected:
        visible = []
        for message in row["messages"]:
            if message["role"] not in {"user", "system"}:
                break
            visible.append(message)
        queue.append({"episode_id": row["id"], "family_id": row["family_id"], "split": "train",
                      "visible_input_json": json.dumps({"messages": visible, "policy": row["policy"], "tools": row["tools"]}, ensure_ascii=False),
                      "teacher_model": "gpt-5.4-2026-03-05", "annotation_status": "pending_credentials"})
    queue_path = destination / "annotation-pilot.jsonl"
    with queue_path.open("x", encoding="utf-8") as out:
        for row in queue:
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
    import pyarrow as pa
    import pyarrow.parquet as pq
    parquet_path = destination / "annotation-pilot.parquet"
    pq.write_table(pa.Table.from_pylist(queue), parquet_path)
    report = {"manifest": manifest, "family_assignment_method": "visible-request-taxonomy-v1, provisional pending review",
              "source_records_by_split": dict(Counter(split for _, split in assignments.values())),
              "annotation_queue_count": len(queue), "annotation_queue_domain_counts": dict(Counter(row["family_id"].split(":")[0] for row in queue)),
              "annotation_calls": 0, "independently_verified_native_patterns": 0,
              "artifacts": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [queue_path, parquet_path]}}
    (destination / "pilot-manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
