"""Prepare a source-bound human review packet. Never records approval itself."""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import html
import json
from pathlib import Path

from acephale.contracts_v1 import hash_v1


def jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_reference(prefix: dict, reference: dict):
    if reference.get("sourceId") != "checkpoint":
        raise ValueError("Historical annotation references an unknown source")
    value = prefix
    for part in reference.get("path", []):
        if isinstance(value, list):
            if type(part) is not int or not 0 <= part < len(value):
                raise ValueError("Invalid source array index")
        elif not isinstance(value, dict) or part not in value:
            raise ValueError("Source path is unavailable at this checkpoint")
        value = value[part]
    return value


def prepare(queue_path: Path, annotations_path: Path, output: Path) -> dict:
    if output.exists():
        raise FileExistsError("Review output must be new")
    queue = {row["episode_id"]: row for row in jsonl(queue_path)}
    groups = defaultdict(list)
    wrappers = []
    quarantined = []
    for annotation in jsonl(annotations_path):
        if annotation.get("annotation_status") != "validated":
            continue
        row = queue.get(annotation["episode_id"])
        if not row or row["split"] != "train" or annotation.get("split") != "train":
            raise ValueError("Review seed must belong to the declared training partition")
        if row["family_id"] in {"airline:baggage", "airline:baggage+book"}:
            quarantined.append(row["episode_id"])
            continue
        prefix = json.loads(row["visible_input_json"])
        source_hash = hash_v1({"checkpoint": prefix})
        if source_hash != annotation["visible_input_hash"]:
            raise ValueError("Annotation is not bound to this public input")
        goal = annotation["requested_goals"]
        if goal["revisionHash"] != source_hash:
            raise ValueError("Annotation revision differs from its source")
        references = []
        for hypothesis in goal["hypotheses"]:
            refs = hypothesis["sources"] + [ref for constraint in hypothesis["constraints"] for ref in constraint["sources"]]
            for reference in refs:
                references.append({"reference": reference, "value": resolve_reference(prefix, reference)})
        draft = {key: value for key, value in goal.items() if key != "revisionHash"}
        wrapper = {"checkpoint_id": row["episode_id"], "originalRow": annotation,
                   "originalHash": hash_v1(annotation), "sourceHash": source_hash, "goalDraft": draft}
        wrappers.append(wrapper)
        item = {"episodeId": row["episode_id"], "familyId": row["family_id"], "sourceHash": source_hash,
                "annotationHash": hash_v1(wrapper), "draftHash": hash_v1(draft), "publicPrefix": prefix,
                "goalDraft": draft, "sourceReferences": references}
        groups[row["family_id"].split(":", 1)[0]].append(item)
    cases = []
    for domain in ("airline", "retail"):
        ordered = sorted(groups[domain], key=lambda row: hash_v1({"seed": 20261110, "episode": row["episodeId"]}))
        seen = set()
        chosen = []
        for row in ordered:
            if row["familyId"] not in seen:
                seen.add(row["familyId"])
                chosen.append(row)
            if len(chosen) == 10:
                break
        if len(chosen) != 10:
            raise ValueError("Need ten distinct training families in each domain")
        cases.extend(chosen)
    for index, row in enumerate(cases, 1):
        row["id"] = f"review-{index:02}"
    body = {"version": 1, "kind": "acephale_goal_annotation_review", "cases": cases,
            "provenance": {"queueSha256": digest(queue_path), "annotationsSha256": digest(annotations_path),
                           "source": "Salesforce/APIGen-MT-5k", "license": "CC-BY-NC-4.0, research only",
                           "verificationTier": "source_reported", "quarantinedEpisodeIds": quarantined},
            "humanReviewStatus": "pending", "requiredCount": 20,
            "rubric": "Accept only if the goals preserve the visible user intent and material constraints, and every claimed fact is supported by the shown public sources. A valid JSON pointer does not establish semantic support."}
    packet = {**body, "contentHash": hash_v1(body)}
    output.mkdir(parents=True)
    (output / "packet.json").write_text(json.dumps(packet, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output / "annotations.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in wrappers), encoding="utf-8")
    pilot = {"version": 1, "packetHash": packet["contentHash"], "audit": [{"checkpoint_id": row["episodeId"]} for row in cases],
             "annotationsSha256": digest(output / "annotations.jsonl"), "humanReviewStatus": "pending"}
    (output / "pilot.json").write_text(json.dumps(pilot, indent=2) + "\n", encoding="utf-8")
    e = html.escape
    sections = []
    for case in cases:
        messages = "\n\n".join(f"{row['role']}: {row['content']}" for row in case["publicPrefix"]["messages"])
        goals = []
        for hypothesis in case["goalDraft"]["hypotheses"]:
            constraints = "".join(f"<li>{e(c['text'])}</li>" for c in hypothesis["constraints"])
            goals.append(f"<li><strong>{e(hypothesis['objective'])}</strong><ul>{constraints}</ul></li>")
        sections.append(f"<section><h2>{e(case['id'])}: {e(case['familyId'])}</h2><h3>Visible request</h3><pre>{e(messages)}</pre>"
                        f"<h3>Proposed goals and constraints</h3><ol>{''.join(goals)}</ol>"
                        f"<details><summary>Full policy and available tools</summary><pre>{e(json.dumps(case['publicPrefix'], indent=2, ensure_ascii=False))}</pre></details>"
                        f"<details><summary>Exact annotation and source references</summary><pre>{e(json.dumps(case['goalDraft'], indent=2, ensure_ascii=False))}</pre></details>"
                        "<p>Review: <b>A</b> = acceptable and supported; <b>R</b> = incorrect/incomplete; <b>U</b> = unsupported factual binding. Add notes for R/U.</p></section>")
    page = ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
            "<title>Acephale annotation review</title><style>body{font:17px/1.6 system-ui;margin:3rem auto;max-width:960px;padding:0 1.5rem;color:#17212b}"
            "section{border-top:2px solid #ccd5df;padding:2rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 ui-monospace;background:#f3f5f8;padding:1rem}"
            "summary{cursor:pointer}h1,h2,h3{line-height:1.25}</style><h1>Acephale: review 20 goal annotations</h1>"
            "<p>These are synthetic benchmark requests. No future tool actions are shown. Check whether each proposed goal and its constraints reflect the visible request and policy. "
            "Source-path validity was checked automatically; semantic correctness needs your review.</p>"
            "<p>Reply in the conversation with <code>01 A, 02 R: missing constraint, ...</code>. If all twenty are acceptable after reading them, say so explicitly. "
            "At least 18/20 must be acceptable, with zero unsupported bindings. No approval is recorded by opening this page.</p>"
            f"<p>Packet identity: <code>{packet['contentHash']}</code></p>{''.join(sections)}</html>")
    (output / "review.html").write_text(page, encoding="utf-8")
    return {"contentHash": packet["contentHash"], "cases": len(cases), "status": "pending_human_review"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--queue", required=True, type=Path)
    parser.add_argument("--annotations", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.queue, args.annotations, args.output)))
