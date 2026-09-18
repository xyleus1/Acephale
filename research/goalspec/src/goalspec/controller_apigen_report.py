"""Read-only APIGen source-tape prediction diagnostic, never an APIGen task-success score."""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from goalspec.controller_native_v4_report import HITS, RANKERS, paired, summarize
from goalspec.report_v4 import Sources, file_hash, number

VERSION = "goalspec-apigen-controller-report-v1"


def validate_rows(checkpoint_ids, rows):
    groups = defaultdict(dict)
    for row in rows:
        if (row.get("id") not in checkpoint_ids or row.get("universe") != "proposal"
                or row.get("ranker") not in RANKERS or row.get("executionAllowed") is not False
                or row.get("status") not in ("completed", "unavailable")):
            raise ValueError("Invalid non-executable APIGen score")
        if row["ranker"] in groups[row["id"]]:
            raise ValueError("Duplicate checkpoint/ranker")
        if row.get("actualRead") is not None and type(row["actualRead"]) is not bool:
            raise ValueError("Invalid observed read label")
        if row["status"] == "completed" and type(row.get("actualRead")) is not bool:
            raise ValueError("Completed row lacks known action")
        if type(row.get("predictedRead")) is not bool or not number(row.get("actionReadProbability")) or not 0 <= row["actionReadProbability"] <= 1:
            raise ValueError("Invalid frozen read prediction")
        if row.get("actualRead") is True and any(type(row.get(field)) is not bool for field in (*HITS, "poolCovered")):
            raise ValueError("Read row lacks exact/tool labels")
        groups[row["id"]][row["ranker"]] = row
    if set(groups) != checkpoint_ids:
        raise ValueError("Score checkpoint coverage mismatch")
    for group in groups.values():
        if set(group) != set(RANKERS):
            raise ValueError("Each checkpoint requires both rankers")
        left, right = (group[ranker] for ranker in RANKERS)
        if any(left.get(field) != right.get(field) for field in ("runId", "domain", "familyId", "boundary", "poolHash", "poolSize", "actualRead", "poolCovered")):
            raise ValueError("Identical-pool or label pairing mismatch")
    return rows


def analyze(directory, samples=2000, seed=20260916):
    if type(samples) is not int or not 100 <= samples <= 100000:
        raise ValueError("Invalid bootstrap sample bound")
    directory = Path(directory).resolve()
    sources = Sources()
    manifest = sources.read(directory / "manifest.json")
    if (manifest.get("version") != "goalspec-apigen-frozen-read-prediction-v1"
            or manifest.get("completeDeclaredCorpus") is not True or manifest.get("episodes") != 5000
            or manifest.get("sourceInputsExcludeFutureActions") is not True
            or manifest.get("providerCalls") != 0 or manifest.get("nativeToolExecutions") != 0
            or manifest.get("independentReplayVerified") is not False):
        raise ValueError("Expected complete APIGen public-source diagnostic")
    for source in [*manifest["sourceFiles"], *manifest["codeFiles"]]:
        if file_hash(sources.track(source["path"])) != source["sha256"]:
            raise ValueError("APIGen replay source hash mismatch")
    for name, field in (("checkpoints.jsonl", "checkpointsSha256"), ("scores.jsonl", "scoresSha256"), ("episodes.jsonl", "episodesSha256")):
        if file_hash(sources.track(directory / name)) != manifest[field]:
            raise ValueError("APIGen replay output hash mismatch")
    # Stream checkpoint identities to avoid retaining candidate payloads twice.
    checkpoint_ids = set()
    with (directory / "checkpoints.jsonl").open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            if row["id"] in checkpoint_ids or row.get("executionAllowed") is not False:
                raise ValueError("Duplicate or executable checkpoint")
            checkpoint_ids.add(row["id"])
    rows = validate_rows(checkpoint_ids, sources.jsonl(directory / "scores.jsonl"))
    episodes = sources.jsonl(directory / "episodes.jsonl")
    if len(episodes) != 5000 or len(rows) != manifest["scoreRows"] or len(checkpoint_ids) != manifest["checkpoints"]:
        raise ValueError("Full corpus denominator mismatch")
    summaries = {ranker: summarize([row for row in rows if row["ranker"] == ranker], samples, seed) for ranker in RANKERS}
    differences = paired(rows, "proposal", samples, seed)
    differences["matchedCheckpoints"] = len(differences.pop("matchedCheckpointIds"))
    clean_episodes = {episode["episodeId"] for episode in episodes if not episode["errors"]}
    clean_rows = [row for row in rows if row["runId"] in clean_episodes]
    domain_results = {domain: {ranker: summarize([row for row in rows if row["domain"] == domain and row["ranker"] == ranker], samples, seed)
                               for ranker in RANKERS} for domain in ("retail", "airline")}
    for path in (Path(__file__), Path(__file__).with_name("controller_native_v4_report.py"), Path(__file__).with_name("report_v4.py"), Path(__file__).with_name("report_v3.py")):
        sources.track(path)
    result = {"version": VERSION, "inputManifest": manifest, "checkpoints": len(checkpoint_ids), "scoreRows": len(rows),
              "summary": summaries, "pairedDifferences": differences, "byDomain": domain_results,
              "catalogCleanSensitivity": {"episodes": len(clean_episodes), "excludedEpisodes": 5000 - len(clean_episodes),
                   "label": "Sensitivity view only; full retained corpus above remains the principal denominator.",
                   "summary": {ranker: summarize([row for row in clean_rows if row["ranker"] == ranker], samples, seed) for ranker in RANKERS}},
              "coverage": {"sourceEpisodes": 5000, "sourceMessageCheckpoints": len(checkpoint_ids), "knownActionCheckpoints": summaries[RANKERS[0]]["knownActions"],
                           "strictCatalogOrArgumentErrors": manifest["errorCounts"], "errorEpisodes": manifest["errorEpisodes"], "duplicates": manifest["duplicates"],
                           "checkpointsWithInvalidEarlierAction": sum(row.get("prefixHasInvalidAction") is True for row in rows if row["ranker"] == RANKERS[0])},
              "bootstrapSamples": samples, "bootstrapSeed": seed, "sources": sources.hashes,
              "interpretation": [
                  "Zero-provider frozen-controller transfer diagnostic over Salesforce/APIGen-MT-5k public source tapes, not APIGen actor execution or task success.",
                  "Every assistant text or function_call source row is a checkpoint. Source formatting can split text and calls that one native actor batch would combine; NO_READ calibration is therefore distribution-shifted.",
                  "Candidate schemas and arguments are validated against the source episode catalog. The static native binder proposes only its retail/airline read vocabulary. Source environment execution and authorization are unverified.",
                  "Out-of-catalog or malformed actions remain unknown-label records in source/checkpoint coverage, excluded from label-dependent accuracy denominators rather than misclassified as NO_READ.",
                  "Unknown source results are not consumed as trusted binding observations. Later affected prefixes are flagged; catalog-clean episode sensitivity is reported separately.",
                  "Exact normalized duplicate records remain in primary metrics; duplicate counts are disclosed. Provisional action-family bootstrap intervals are pointwise, not certified task-family heldout inference or multiplicity corrected.",
                  "Ungated top-k scores measure candidate ranking; gated exact top-1 also requires the frozen binary READ, useful-within-two and learned readiness thresholds. These are imitation gates, not causal utility or permission.",
                  "Tool cross-entropy is a normalized sum of independent next-action candidate confidences, smoothed by 0.001 per supplied supported read tool. It estimates predictive cross-entropy, not true conditional entropy or a joint argument likelihood.",
                  "The current-prior ranker shares exactly the same bounded candidate pool, tie-breaks by candidate ID and predicts READ whenever that pool is nonempty. It is a mechanical heuristic, not a Salesforce or PASTE implementation.",
                  "No model fitting, threshold selection, native task reward, latency savings or superiority across all metrics is inferred. Research-only CC BY-NC 4.0 lineage and source-reported verification are preserved."]}
    sources.verify()
    return result


def write_report(directory, output, samples=2000):
    output = Path(output)
    if output.exists():
        raise FileExistsError("Report must be new")
    result = analyze(directory, samples)
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write("\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bootstrap-samples", type=int, default=2000)
    args = parser.parse_args()
    result = write_report(args.input, args.output, args.bootstrap_samples)
    print(json.dumps({"checkpoints": result["checkpoints"], "scoreRows": result["scoreRows"], "output": str(args.output)}))


if __name__ == "__main__":
    main()
