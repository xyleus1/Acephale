"""Offline evaluation of frozen rankers on closed fresh Base public prefixes.

No fitting, provider, native environment, database, or private evaluator imports.
"""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from goalspec.report_v4 import Sources, cluster_interval, file_hash, number

VERSION = "goalspec-frozen-controller-native-report-v1"
UNIVERSES = ("proposal", "policy-ready")
RANKERS = ("current-prior", "frozen-logistic")
HITS = ("toolTop1", "toolTop3", "exactTop1", "exactTop3", "gatedExactTop1")
METRICS = (*HITS, "poolCoverage", "operationalPoolCoverage", "actionAccuracy",
           "noReadSpecificity", "readSensitivity", "actionNllNats", "actionBrier",
           "nextToolCrossEntropyEstimateNats")
NUMERIC = {"actionNllNats": "actionNll", "actionBrier": "actionBrier",
           "nextToolCrossEntropyEstimateNats": "toolCrossEntropyEstimateNats"}


def load_scores(directory, sources):
    directory = Path(directory).resolve()
    manifest = sources.read(directory / "manifest.json")
    if manifest.get("completeDeclaredCohort") is not True or manifest.get("sourceInputsExcludePrivateFields") is not True:
        raise ValueError("Frozen replay requires a complete cohort and public-prefix input contract")
    if manifest.get("cohortStage") not in ("development", "confirmation"):
        raise ValueError("Unsupported fresh cohort stage")
    for name, field in (("scores.jsonl", "scoresSha256"), ("checkpoints.jsonl", "checkpointsSha256")):
        path = sources.track(directory / name)
        if file_hash(path) != manifest.get(field):
            raise ValueError(f"Replay {name} hash mismatch")
    for item in [*manifest.get("sourceFiles", []), *manifest.get("codeFiles", [])]:
        path = sources.track(item["path"])
        if file_hash(path) != item.get("sha256"):
            raise ValueError("Frozen replay source/code hash mismatch")
    for field in ("frozenControllerHash", "controllerFileSha256"):
        value = manifest.get(field)
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("Frozen controller hash missing")
    # Hash validation precedes all score parsing. Checkpoint IDs establish the
    # full retained denominator; prediction labels are never reconstructed here.
    checkpoints = sources.jsonl(directory / "checkpoints.jsonl")
    checkpoint_ids = [row.get("id") for row in checkpoints]
    if any(not isinstance(identifier, str) or not identifier for identifier in checkpoint_ids) or len(set(checkpoint_ids)) != len(checkpoint_ids):
        raise ValueError("Invalid or repeated source checkpoint identity")
    rows = sources.jsonl(directory / "scores.jsonl")
    groups = defaultdict(dict)
    for row in rows:
        if (not isinstance(row.get("id"), str) or not row["id"] or row.get("universe") not in UNIVERSES
                or row.get("ranker") not in RANKERS or row.get("status") not in ("completed", "unavailable")
                or row.get("actualRead") is not None and not isinstance(row["actualRead"], bool)):
            raise ValueError("Invalid controller score identity or status")
        if any(not isinstance(row.get(field), str) or not row[field] for field in ("runId", "familyId", "domain")):
            raise ValueError("Missing score family/run identity")
        key = row["universe"], row["ranker"]
        if key in groups[row["id"]]:
            raise ValueError("Duplicate checkpoint/ranker/universe")
        groups[row["id"]][key] = row
        if row["status"] == "completed":
            if not isinstance(row.get("actualRead"), bool) or not isinstance(row.get("predictedRead"), bool):
                raise ValueError("Completed prediction lacks observed and predicted action labels")
            probability = row.get("actionReadProbability")
            if not number(probability) or not 0 <= probability <= 1:
                raise ValueError("Invalid binary read probability")
            if row["actualRead"] and any(not isinstance(row.get(field), bool) for field in (*HITS, "poolCovered")):
                raise ValueError("Completed known read lacks hit labels")
            if not isinstance(row.get("poolHash"), str) or not row["poolHash"] or type(row.get("poolSize")) is not int or row["poolSize"] < 0:
                raise ValueError("Completed prediction lacks candidate pool provenance")
        elif row.get("actualRead") is True and any(row.get(field) is not False for field in HITS):
            raise ValueError("Unavailable known-read predictions must retain failed hit labels")
        for field in NUMERIC.values():
            value = row.get(field)
            if value is not None and (not number(value) or value < 0):
                raise ValueError("Invalid score loss")
    if set(groups) != set(checkpoint_ids):
        raise ValueError("Score checkpoint set differs from complete checkpoint artifact")
    expected = {(universe, ranker) for universe in UNIVERSES for ranker in RANKERS}
    for group in groups.values():
        if set(group) != expected:
            raise ValueError("Every checkpoint requires both frozen rankers and both universes")
        reference = next(iter(group.values()))
        for row in group.values():
            if any(row.get(field) != reference.get(field) for field in ("runId", "familyId", "domain", "boundary", "actualRead")):
                raise ValueError("Paired checkpoint identity or observed label mismatch")
        for universe in UNIVERSES:
            left, right = (group[(universe, ranker)] for ranker in RANKERS)
            if any(left.get(field) != right.get(field) for field in ("poolHash", "poolSize", "poolCovered")):
                raise ValueError("Rankers were not evaluated on identical candidate pools")
    if not groups:
        raise ValueError("Empty frozen replay")
    sources.verify()
    return manifest, rows


def contribution(row, metric):
    actual = row.get("actualRead")
    if actual is None:
        return 0, 0
    if metric in HITS:
        return (int(row.get(metric) is True), 1) if actual else (0, 0)
    if metric in ("poolCoverage", "operationalPoolCoverage"):
        if not actual or metric == "poolCoverage" and not isinstance(row.get("poolCovered"), bool):
            return 0, 0
        return int(row.get("poolCovered") is True), 1
    if metric == "actionAccuracy":
        return int(isinstance(row.get("predictedRead"), bool) and row["predictedRead"] == actual), 1
    if metric == "noReadSpecificity":
        return (int(row.get("predictedRead") is False), 1) if not actual else (0, 0)
    if metric == "readSensitivity":
        return (int(row.get("predictedRead") is True), 1) if actual else (0, 0)
    if metric == "nextToolCrossEntropyEstimateNats" and not actual:
        return 0, 0
    value = row.get(NUMERIC[metric])
    return (value, 1) if number(value) else (0, 0)


def _sum(rows, metric):
    pairs = [contribution(row, metric) for row in rows]
    return sum(pair[0] for pair in pairs), sum(pair[1] for pair in pairs)


def summarize(rows, samples, seed):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["domain"], row["familyId"])].append(row)
    metrics = {}
    for metric in METRICS:
        pair = _sum(rows, metric)
        metrics[metric] = {**cluster_interval([_sum(group, metric) for group in groups.values()], samples, seed),
                           "numerator": pair[0], "denominator": pair[1]}
    reads = [row for row in rows if row.get("actualRead") is True]
    known = [row for row in rows if row.get("actualRead") is not None]
    return {"checkpoints": len(rows), "families": len(groups), "knownActions": len(known), "readActions": len(reads),
            "nonReadActions": sum(row.get("actualRead") is False for row in rows), "unknownActions": len(rows) - len(known),
            "completed": sum(row["status"] == "completed" for row in rows),
            "unavailable": sum(row["status"] == "unavailable" for row in rows),
            "unavailableReasons": dict(Counter(row.get("unavailableReason") or "unspecified" for row in rows if row["status"] == "unavailable")),
            "knownReadPredictionFailures": sum(row["status"] == "unavailable" for row in reads),
            "missingLosses": {metric: sum(contribution(row, metric)[1] == 0 for row in (reads if metric == "nextToolCrossEntropyEstimateNats" else known)) for metric in NUMERIC},
            "metrics": metrics}


def paired(rows, universe, samples, seed):
    selected = [row for row in rows if row["universe"] == universe]
    by_ranker = {ranker: {row["id"]: row for row in selected if row["ranker"] == ranker} for ranker in RANKERS}
    left, right = by_ranker["frozen-logistic"], by_ranker["current-prior"]
    if left.keys() != right.keys():
        raise ValueError("Paired checkpoint sets differ")
    estimates = {}
    for metric in METRICS:
        groups = defaultdict(lambda: [[], []])
        measured = 0
        for identifier in sorted(left):
            a, b = contribution(left[identifier], metric), contribution(right[identifier], metric)
            group = groups[(left[identifier]["domain"], left[identifier]["familyId"])]
            if a[1] and b[1]:
                group[0].append(a)
                group[1].append(b)
                measured += 1
        def total(pairs):
            return sum(p[0] for p in pairs), sum(p[1] for p in pairs)
        estimates[metric] = {**cluster_interval([total(group[0]) for group in groups.values()], samples, seed,
                                                [total(group[1]) for group in groups.values()]), "matchedMeasuredCheckpoints": measured}
    return {"matchedCheckpointIds": sorted(left), "samePoolVerified": True, "differences": estimates,
            "sign": "frozen-logistic minus current-prior; negative loss differences favor the frozen controller"}


def analyze(directory, samples=5000, seed=20260916):
    if type(samples) is not int or not 100 <= samples <= 100000:
        raise ValueError("Invalid bootstrap sample bound")
    sources = Sources()
    manifest, rows = load_scores(directory, sources)
    sources.track(Path(__file__))
    sources.track(Path(__file__).with_name("report_v4.py"))
    sources.track(Path(__file__).with_name("report_v3.py"))
    result = {"version": VERSION, "cohortStage": manifest["cohortStage"], "inputManifest": manifest,
              "uniqueCheckpoints": len({row["id"] for row in rows}), "scoreRows": len(rows),
              "summary": {universe: {ranker: summarize([row for row in rows if row["universe"] == universe and row["ranker"] == ranker], samples, seed)
                                     for ranker in RANKERS} for universe in UNIVERSES},
              "pairedDifferences": {universe: paired(rows, universe, samples, seed) for universe in UNIVERSES},
              "bootstrapSamples": samples, "seed": seed, "sources": sources.hashes,
              "semantics": {"population": "Every retained Base decision checkpoint from the declared closed cohort; failed and unavailable predictions retained.",
                            "hits": "Known-read unavailable predictions score false. Unknown actual actions are counted separately and excluded from label-dependent denominators.",
                            "poolCoverage": "Measured coverage excludes unknown pools; operational coverage counts unknown pools as unsuccessful. Top-k is ungated ranking; gatedExactTop1 additionally requires READ.",
                            "action": "Binary READ/NO_READ classification; unavailable predictions fail operational classification metrics. Losses use measured predictions only and disclose missing counts.",
                            "toolCrossEntropy": "Per-tool sum of independent next-action candidate confidences plus 0.001 per catalog tool, normalized over tools. Average negative log probability on observed read tool names; not true conditional entropy or a joint next-action likelihood.",
                            "actionNll": "Binary read-head cross-entropy in nats, separate from tool-distribution cross-entropy.",
                            "pairing": "Exact checkpoint IDs and ordered candidate-pool hashes; only jointly measured pairs enter loss differences.",
                            "uncertainty": "Pointwise family-clustered percentile intervals; all runs, variants and repeated trials from a family move together. No multiplicity or selection correction.",
                            "claims": "No fitting, provider calls, live latency, causal usefulness or native task-success score is inferred by this offline replay."}}
    sources.verify()
    return result


def write_report(directory, output, samples=5000, seed=20260916):
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError("Controller report output must be a new file")
    result = analyze(directory, samples, seed)
    if str(output) in result["sources"]:
        raise ValueError("Report cannot replace source")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write("\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bootstrap-samples", type=int, default=5000)
    args = parser.parse_args()
    result = write_report(args.input, args.output, args.bootstrap_samples)
    print(json.dumps({"output": str(args.output), "checkpoints": result["uniqueCheckpoints"], "stage": result["cohortStage"]}))


if __name__ == "__main__":
    main()
