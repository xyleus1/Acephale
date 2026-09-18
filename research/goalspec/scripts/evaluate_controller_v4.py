"""Identical-pool offline ablations. No provider, private evaluator, or live timing."""
import copy
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import torch
from torch import nn
from torch.nn import functional as functional

from goalspec.contracts_v1 import canonical_v1, hash_v1
from goalspec.controller_v4 import DIMENSION, infer, validate_artifact

ROOT = Path(__file__).resolve().parents[3]
RUNS = ROOT / "research/goalspec/runs"
trained = RUNS / "local-controller-v4-trained-20260916-b"
replay = Path(sys.argv[1]) if len(sys.argv) > 1 else RUNS / "local-controller-v4-replay-20260916"
if (replay / "report.json").exists():
    raise ValueError("Replay analysis output already exists")
torch.set_num_threads(2)
artifact = json.loads((trained / "controller.json").read_text(encoding="utf-8"))
training = json.loads((trained / "training-report.json").read_text(encoding="utf-8"))
calibration_rows = [json.loads(line) for line in (RUNS / "local-controller-v4-dataset-20260916-c/dataset.jsonl").read_bytes().splitlines() if b'"split":"calibration"' in line]
calibration_x = torch.tensor([r["features"]["values"] for r in calibration_rows], dtype=torch.float32)
calibration_y = torch.tensor([[v or 0 for v in r["labels"]] for r in calibration_rows], dtype=torch.float32)
calibration_mask = torch.tensor([[v is not None for v in r["labels"]] for r in calibration_rows], dtype=torch.float32)
best_mlp = min(["mlp-base", "fine-low", "fine-regularized", "fine-ranking"], key=lambda name: training["selectionMetrics"][name]["maskedBce"])
models = {"logistic-selected": artifact}
for label, checkpoint in [("best-mlp", best_mlp), ("greedy-soup", "greedy-soup")]:
    network = nn.Sequential(nn.Linear(DIMENSION, 32), nn.ReLU(), nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 5))
    network.load_state_dict(torch.load(trained / (checkpoint + ".pt"), weights_only=True, map_location="cpu")); network.eval()
    with torch.no_grad():
        logits = network(calibration_x)
        temperatures = [min([0.5, 0.75, 1, 1.5, 2, 3, 5, 8], key=lambda t: float((functional.binary_cross_entropy_with_logits(logits[:, i] / t, calibration_y[:, i], reduction="none") * calibration_mask[:, i]).sum())) if calibration_mask[:, i].sum() else 1 for i in range(5)]
    variant = copy.deepcopy(artifact)
    variant["architecture"] = "mlp-32-16"
    variant["layers"] = [{"weights": layer.weight.detach().tolist(), "bias": layer.bias.detach().tolist(), "activation": "linear" if index == 4 else "relu"} for index, layer in enumerate(network) if isinstance(layer, nn.Linear)]
    variant["calibration"]["temperature"] = temperatures
    variant["lineage"]["selectedCheckpoint"] = checkpoint
    variant["lineage"]["soupMembers"] = training["soupMembers"] if label == "greedy-soup" else []
    variant["contentHash"] = hash_v1({k: v for k, v in variant.items() if k != "contentHash"})
    validate_artifact(variant, ROOT / "src/lib/goalspec/contracts/v4-controller.schema.json")
    models[label] = variant
    (replay / (label + ".json")).write_bytes(canonical_v1(variant) + b"\n")

rows = [json.loads(line) for line in (replay / "checkpoints.jsonl").read_bytes().splitlines()]
key = lambda invocation: canonical_v1([invocation["tool"], invocation["arguments"]])
bounded = lambda p: max(1e-6, min(1 - 1e-6, p))
scored = []
for row in rows:
    if row["unavailableReason"] or row["state"] is None or row["actual"] is None:
        continue
    actual = [a for a in row["actual"] if a["tool"] in row["readToolNames"]]
    actual_read = bool(actual)
    actual_keys, actual_tools = {key(a) for a in actual}, {a["tool"] for a in actual}
    for universe in ["proposal", "policy-ready"]:
        pool = [entry for entry in row["candidates"] if universe == "proposal" or entry["eligible"]]
        for name in ["current-prior", *models]:
            probabilities = {entry["candidate"]["id"]: ([1, entry["candidate"]["probability"], entry["candidate"]["probability"], 1, 0] if name == "current-prior" else infer(models[name], entry["features"])) for entry in pool}
            action_read = (1 if pool else 0) if name == "current-prior" else infer(models[name], row["actionFeatures"])[0]
            ranked = sorted(pool, key=lambda e: (-(probabilities[e["candidate"]["id"]][1] + probabilities[e["candidate"]["id"]][2]), e["candidate"]["id"]))
            top = ranked[:1]
            # Normalized candidate confidence mass with epsilon per tool. It is an
            # estimated tool distribution, not a language-model conditional entropy.
            tool_mass = {tool: 0.001 for tool in row["readToolNames"]}
            for entry in pool:
                tool_mass[entry["candidate"]["invocation"]["tool"]] += probabilities[entry["candidate"]["id"]][1]
            total_mass = sum(tool_mass.values())
            tool_nll = sum(-math.log(tool_mass[t] / total_mass) for t in actual_tools) / len(actual_tools) if actual_read else None
            p = bounded(action_read)
            scored.append({"checkpointId": row["id"], "familyId": row["familyId"], "split": row["split"], "universe": universe, "ranker": name,
                           "actualRead": actual_read, "poolSize": len(pool), "poolCovered": any(key(e["candidate"]["invocation"]) in actual_keys for e in pool) if actual_read else None,
                           "predictedRead": action_read >= 0.5, "actionReadProbability": action_read, "actionNll": -math.log(p if actual_read else 1 - p),
                           "actionBrier": (action_read - int(actual_read)) ** 2,
                           "toolTop1": any(e["candidate"]["invocation"]["tool"] in actual_tools for e in top) if actual_read else None,
                           "exactTop1": any(key(e["candidate"]["invocation"]) in actual_keys for e in top) if actual_read else None,
                           "exactTop3": any(key(e["candidate"]["invocation"]) in actual_keys for e in ranked[:3]) if actual_read else None,
                           "gatedExactTop1": (action_read >= 0.5 and any(key(e["candidate"]["invocation"]) in actual_keys for e in top)) if actual_read else None,
                           "toolCrossEntropyEstimateNats": tool_nll})


def summary(part):
    reads = [r for r in part if r["actualRead"]]
    nonreads = [r for r in part if not r["actualRead"]]
    mean = lambda values: sum(values) / len(values) if values else None
    bins = []
    for lo in range(10):
        group = [r for r in part if min(9, int(r["actionReadProbability"] * 10)) == lo]
        if group:
            bins.append({"lower": lo / 10, "count": len(group), "meanProbability": mean([r["actionReadProbability"] for r in group]), "observedReadRate": mean([r["actualRead"] for r in group])})
    return {"decisions": len(part), "readDecisions": len(reads), "nonReadDecisions": len(nonreads),
            "toolTop1": mean([r["toolTop1"] for r in reads]), "exactArgumentTop1": mean([r["exactTop1"] for r in reads]),
            "exactArgumentTop3": mean([r["exactTop3"] for r in reads]), "gatedExactArgumentTop1": mean([r["gatedExactTop1"] for r in reads]),
            "noReadSpecificity": mean([not r["predictedRead"] for r in nonreads]), "readSensitivity": mean([r["predictedRead"] for r in reads]),
            "actionAccuracy": mean([r["predictedRead"] == r["actualRead"] for r in part]), "actionNllNats": mean([r["actionNll"] for r in part]),
            "actionBrier": mean([r["actionBrier"] for r in part]), "nextToolCrossEntropyEstimateNats": mean([r["toolCrossEntropyEstimateNats"] for r in reads]),
            "poolCoverage": mean([r["poolCovered"] for r in reads]), "calibrationBins": bins,
            "actionExpectedCalibrationError": sum(abs(b["meanProbability"] - b["observedReadRate"]) * b["count"] for b in bins) / len(part) if part else None}


summaries = {}
for universe in ["proposal", "policy-ready"]:
    summaries[universe] = {name: {split: summary([r for r in scored if r["universe"] == universe and r["ranker"] == name and (split == "all-development" or r["split"] == split)]) for split in ["all-development", "train", "selection", "calibration"]} for name in ["current-prior", *models]}

paired = {}
for universe in ["proposal", "policy-ready"]:
    baseline = {r["checkpointId"]: r for r in scored if r["universe"] == universe and r["ranker"] == "current-prior"}
    for name in models:
        for metric, read_only in [("exactTop1", True), ("toolTop1", True), ("toolCrossEntropyEstimateNats", True), ("actionNll", False)]:
            by_family = {}
            for r in scored:
                if r["universe"] == universe and r["ranker"] == name and (not read_only or r["actualRead"]):
                    by_family.setdefault(r["familyId"], []).append(float(r[metric]) - float(baseline[r["checkpointId"]][metric]))
            families = sorted(by_family)
            randomizer = random.Random(43117)
            estimates = []
            for _ in range(2000):
                sample = [v for family in randomizer.choices(families, k=len(families)) for v in by_family[family]]
                estimates.append(sum(sample) / len(sample))
            estimates.sort()
            all_values = [v for values in by_family.values() for v in values]
            paired[f"{universe}/{name}/{metric}"] = {"difference": sum(all_values) / len(all_values), "familyClustered95CI": [estimates[49], estimates[1949]], "families": len(families), "bootstrapSamples": 2000}

v3_path = RUNS / "local-v3-confirmation-prediction-corrected-20260915/summary.json"
v3 = json.loads(v3_path.read_text(encoding="utf-8"))
report = {"version": "goalspec-controller-identical-pool-ablation-v1", "label": "historical v3 Base development, partly reused for training; not held-out",
          "checkpointCount": len(rows), "scoredDecisions": len(scored) // 8, "unavailable": [{"id": r["id"], "reason": r["unavailableReason"]} for r in rows if r["unavailableReason"]],
          "rankers": {name: model["contentHash"] for name, model in models.items()}, "summary": summaries, "pairedDifferencesVsCurrentPrior": paired,
          "historicalV3DifferentPoolReference": {arm: v3["arms"][arm] for arm in ["paste", "salesforce", "goalspec"]},
          "historicalSource": {"path": str(v3_path), "sha256": hashlib.sha256(v3_path.read_bytes()).hexdigest()},
          "semantics": {"pool": "same up-to-32 candidates per checkpoint for every ranker; policy-ready separately removes server-denied candidates",
                        "noReadBaseline": "current-prior predicts READ if any candidate exists; learned heads threshold 0.5",
                        "rankerTopK": "ungated candidate ranking; gated Top1 also reported separately",
                        "toolCrossEntropy": "negative log of summed per-tool next-action confidence plus 0.001 epsilon per catalog tool, normalized over catalog; not true conditional entropy",
                        "calibration": "each model temperature fit on identical designated calibration families; no architecture selection on calibration outcomes",
                        "soup": "all attempted additions rejected by selection; greedy-soup equals retained best MLP",
                        "latency": "no live latency or native task score inferred by this replay"},
          "sourceCodeHash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
(replay / "scores.jsonl").write_bytes(b"\n".join(canonical_v1(row) for row in scored) + b"\n")
(replay / "report.json").write_bytes(canonical_v1(report) + b"\n")
print(json.dumps({"scoredDecisions": report["scoredDecisions"], "rankers": {u: {n: {k: v for k, v in s["all-development"].items() if k not in ["calibrationBins"]} for n, s in names.items()} for u, names in summaries.items()}}, indent=2))
