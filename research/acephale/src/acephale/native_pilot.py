"""Select a fit-only annotation pilot without reading future actions or rewards."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import VERSION, _public_check, publish_bundle, read_jsonl, verify_bundle


def select_native_fit_pilot(public: list[dict[str, Any]], partitions: dict[str, Any], *, seed: int = 42,
                            eligible_checkpoint_ids: list[str] | None = None) -> dict[str, Any]:
    families = partitions.get("weightFitFamilies")
    if families is None and isinstance(partitions.get("families"), dict):
        families = [family for family, partition in partitions["families"].items() if partition == "weight_fit"]
    if not isinstance(families, list) or len(families) != 24 or len(set(families)) != 24:
        raise ValueError("Native pilot requires 24 distinct declared weight-fitting families")
    if len({row["checkpoint_id"] for row in public}) != len(public):
        raise ValueError("Duplicate public checkpoint")
    eligible = set(eligible_checkpoint_ids) if eligible_checkpoint_ids is not None else None
    if eligible is not None and (len(eligible) != len(eligible_checkpoint_ids) or not eligible <= {row["checkpoint_id"] for row in public}):
        raise ValueError("Eligibility must name unique current public checkpoints")
    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    domains: dict[str, str] = {}
    for row in public:
        family = row["family_id"]
        if family not in families or eligible is not None and row["checkpoint_id"] not in eligible:
            continue
        if (row["split"] != "train" or row.get("domain") not in {"retail", "airline"}
                or row["input_hash"] != hash_v1(row["input"]) or not row.get("request_revision")):
            raise ValueError("Pilot selection requires unchanged public native training checkpoints")
        _public_check(row["input"])
        if domains.setdefault(family, row["domain"]) != row["domain"]:
            raise ValueError("One semantic family cannot cross domains")
        by_family[family].append(row)
    if any(len(by_family[family]) < 4 for family in families) or sum(map(len, by_family.values())) < 100:
        raise ValueError("Need 100 eligible public checkpoints and at least four per fitting family")
    if any(sum(domain == name for domain in domains.values()) != 12 for name in ("retail", "airline")):
        raise ValueError("Pilot requires twelve fitting families in each native domain")
    if any(sum(len(by_family[family]) for family in families if domains[family] == domain) < 50 for domain in ("retail", "airline")):
        raise ValueError("Pilot requires fifty eligible public checkpoints per domain")
    ordered_domains = {domain: sorted((family for family in families if domains[family] == domain),
                                     key=lambda family: hash_v1({"seed": seed, "family": family})) for domain in ("retail", "airline")}
    family_order = [family for pair in zip(ordered_domains["retail"], ordered_domains["airline"], strict=True) for family in pair]
    for family in family_order:
        by_family[family].sort(key=lambda row: hash_v1({"seed": seed, "checkpoint": row["checkpoint_id"]}))
    selected = []
    domain_counts = {"retail": 0, "airline": 0}
    while len(selected) < 100:
        for family in family_order:
            if by_family[family] and domain_counts[domains[family]] < 50 and len(selected) < 100:
                selected.append(by_family[family].pop(0))
                domain_counts[domains[family]] += 1
    # Twenty different families, ten per domain; the sample is fixed before annotation.
    audit = []
    for family in family_order[:20]:
        row = min((row for row in selected if row["family_id"] == family),
                  key=lambda row: hash_v1({"seed": seed + 1, "checkpoint": row["checkpoint_id"]}))
        audit.append({"checkpoint_id": row["checkpoint_id"], "reason": "predeclared_family_domain_sample_v2"})
    return {"schema_version": VERSION, "selection_version": "native-fit-family-domain-round-robin-v2",
            "seed": seed, "pilot_count": 100, "audit_count": 20, "weight_fit_families": sorted(families),
            "partitions_hash": hash_v1(partitions), "minimum_checkpoints_per_family": 4,
            "checkpoints": [{"checkpoint_id": row["checkpoint_id"], "input_hash": row["input_hash"]} for row in selected],
            "audit": audit, "annotation_inputs": [{key: row[key] for key in ("checkpoint_id", "input_hash", "request_revision", "input")} for row in selected]}


def prepare_native_pilot(dataset_directory: Path, partitions_path: Path, output: Path, *, seed: int = 42,
                         eligibility_path: Path | None = None) -> dict[str, Any]:
    manifest = verify_bundle(dataset_directory)
    partitions = json.loads(partitions_path.read_text(encoding="utf-8"))
    split = json.loads((dataset_directory / "split.json").read_text(encoding="utf-8"))
    public = read_jsonl(dataset_directory / "public.jsonl")
    if any(split["families"].get(row["family_id"]) != row["split"] for row in public):
        raise ValueError("Public family split differs from its frozen declaration")
    eligibility = None
    if eligibility_path is not None:
        eligibility = json.loads(eligibility_path.read_text(encoding="utf-8"))
        normalized = {key: [family for family, value in partitions["families"].items() if value == partition]
                      for key, partition in (("weightFitFamilies", "weight_fit"), ("calibrationFamilies", "calibration"),
                                             ("developmentFamilies", "development"), ("testFamilies", "test"))} if "families" in partitions else partitions
        by_id = {row["checkpoint_id"]: row for row in public}
        rows = eligibility.get("rows", [])
        if (eligibility.get("schemaVersion") != 1 or eligibility.get("kind") != "acephale-public-window-eligibility"
                or eligibility.get("contentHash") != hash_v1({key: value for key, value in eligibility.items() if key != "contentHash"})
                or eligibility.get("sourceDatasetHash") != manifest["bundle_hash"] or eligibility.get("partitionsHash") != hash_v1(normalized)
                or eligibility.get("futureLabelsUsed") is not False or eligibility.get("generationCalls") != 0
                or not re.fullmatch(r"[0-9a-f]{64}", eligibility.get("compilerHash", ""))
                or not isinstance(rows, list) or len({row["checkpointId"] for row in rows}) != len(rows)
                or eligibility.get("checkpointIds") != [row["checkpointId"] for row in rows if row["candidateIds"]]):
            raise ValueError("Pilot eligibility is not a bound public-only candidate compilation")
        for row in rows:
            original = by_id.get(row["checkpointId"])
            if (not original or original["input_hash"] != row["inputHash"] or original["family_id"] != row["familyId"]
                    or original["split"] != "train" or original["family_id"] not in normalized["weightFitFamilies"]
                    or not isinstance(row["candidateIds"], list) or len(row["candidateIds"]) > 128
                    or any(not isinstance(candidate, str) or not candidate for candidate in row["candidateIds"])
                    or len(set(row["candidateIds"])) != len(row["candidateIds"])
                    or any(not re.fullmatch(r"[0-9a-f]{64}", row.get(field, "")) for field in ("candidateWindowHash", "candidatePoolHash"))):
                raise ValueError("Eligibility candidate window differs from its public checkpoint")
    pilot = select_native_fit_pilot(public, partitions, seed=seed,
                                   eligible_checkpoint_ids=eligibility["checkpointIds"] if eligibility else None)
    if eligibility:
        pilot["public_eligibility_hash"] = eligibility["contentHash"]
    inputs = pilot.pop("annotation_inputs")
    pilot.update(source_dataset_hash=manifest["bundle_hash"], source_split_hash=hash_v1(split))
    return publish_bundle(output, {"pilot.json": pilot, "annotation-inputs.jsonl": inputs})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("dataset", "partitions", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--eligibility", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare_native_pilot(args.dataset, args.partitions, args.output, seed=args.seed, eligibility_path=args.eligibility)))


if __name__ == "__main__":
    main()
