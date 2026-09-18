"""CPU listwise controller. Actor model weights are never loaded or changed."""
from __future__ import annotations
import copy
import hashlib
import json
import math
from pathlib import Path
from .contracts_v1 import canonical_v1, hash_v1
from .controller_v4 import build_decision_state, feature_tokens, _js_length

FEATURE_VERSION = "goalspec-controller-features-v5.1"
NEUTRAL_DIMENSION, GOAL_DIMENSION = 120, 72


def _hashed(tokens, buckets):
    result = [0] * buckets
    for token in tokens:
        value = 2166136261
        encoded = token.encode("utf-16-le")
        for i in range(0, len(encoded), 2):
            value = ((value ^ (encoded[i] | encoded[i + 1] << 8)) * 16777619) & 0xFFFFFFFF
        result[value % buckets] += -1 if value & 0x80000000 else 1
    norm = math.sqrt(sum(v * v for v in result)) or 1
    return [v / norm for v in result]


def candidate_features(context, candidate):
    state = build_decision_state(context["frame"])
    present = isinstance(candidate, dict)
    tool_name = candidate["invocation"]["tool"] if present else candidate
    tool = feature_tokens(tool_name.replace("_", " "))
    request = feature_tokens(" ".join(state["unresolvedRequirements"][-3:]) or state["requestedObjective"])
    args_text = canonical_v1(candidate["invocation"]["arguments"]).decode() if present else ""
    args = feature_tokens(args_text)
    values = list(candidate["invocation"]["arguments"].values()) if present else []
    memory = context.get("memory") or {}
    transitions = [row for row in memory.get("transitions", []) if row["to"] == tool_name]
    confusions = memory.get("confusions", [])
    episodes = memory.get("episodes", [])
    matching = [row for row in episodes if any(action["tool"] == tool_name for action in row["episode"]["nextActions"])]
    provenance = [source for row in matching for source in row["episode"]["argumentSources"]]
    observations = [value for row in matching for value in row["episode"]["resultingObservations"]]
    successes = sum(row["successes"] for row in transitions)
    total = sum(row["successes"] + row["failures"] for row in transitions)
    cap = lambda value, scale: min(1, max(0, value / scale))
    overlap = lambda a, b: len(set(a) & set(b)) / len(set(b)) if b else 0
    neutral = [1, int(present), int(candidate == "NO_READ"), int(candidate == "READ_UNCOVERED"),
        cap(state["boundary"], 40), cap(len(state["unresolvedRequirements"]), 12), cap(len(state["recentTools"]), 12),
        cap(len(candidate["bindings"]) if present else 0, 8), cap(len(values), 8), overlap(request, tool), overlap(request, args),
        int(tool_name in state["recentTools"]), cap(_js_length(state["visibleText"]), 32768), cap(_js_length(args_text), 1024),
        sum(row["confidence"] for row in transitions), successes / total if total else 0,
        cap(sum(row["count"] for row in confusions if row["actualTool"] == tool_name), 10),
        cap(sum(row["count"] for row in confusions if row["predictedTool"] == tool_name), 10),
        cap(len(matching), 4), sum(row["similarity"] for row in matching) / max(1, len(matching)),
        sum(bool(row["sources"]) for row in provenance) / len(provenance) if provenance else 0,
        cap(len(observations), 8), cap(len(context["workflows"]), 12), cap(len(episodes), 4)]
    goals = context["goals"]
    goal_words = feature_tokens(" ".join(" ".join([goal["objective"], *[c["text"] for c in goal["constraints"]]])
        for goal in goals["set"]["hypotheses"])) if goals["grounded"] else []
    goal = [int(goals["grounded"]), int(present), int(candidate == "NO_READ"), int(candidate == "READ_UNCOVERED"),
        overlap(goal_words, tool), overlap(goal_words, args), overlap(goal_words, request), cap(len(goal_words), 100)]
    neutral += _hashed([f"r:{t}" for t in request] + [f"t:{t}" for t in tool] + [f"p:{t}" for t in state["recentTools"][-3:]]
        + [f"x:{tool_name}:{t}" for t in request] + [f"a:{t}" for t in args], 96)
    goal += _hashed([f"g:{t}" for t in goal_words] + [f"x:{tool_name}:{t}" for t in goal_words], 64)
    return {"neutral": neutral, "goal": goal}


def probabilities(row, neutral, goal=None, reliability=0, temperature=1):
    values = [sum(x * y for x, y in zip(f["neutral"], neutral)) + reliability * sum(x * y for x, y in zip(f["goal"], goal or [])) for f in row["features"]]
    maximum = max(values)
    exp = [math.exp((value - maximum) / temperature) for value in values]
    return [value / sum(exp) for value in exp]


def validate_artifact(artifact):
    if artifact.get("version") != "goalspec-controller-v5" or artifact.get("featureVersion") != FEATURE_VERSION or artifact.get("architecture") != "listwise-linear-neutral-plus-goal-residual":
        raise ValueError("Invalid controller version")
    if hash_v1({k: v for k, v in artifact.items() if k != "contentHash"}) != artifact.get("contentHash"):
        raise ValueError("Invalid controller hash")
    for key, dimension in [("neutralWeights", NEUTRAL_DIMENSION), ("goalWeights", GOAL_DIMENSION)]:
        if not isinstance(artifact.get(key), list) or len(artifact[key]) != dimension or any(not isinstance(n, (int, float)) or not math.isfinite(n) for n in artifact[key]):
            raise ValueError("Invalid controller weights")
    lineage, calibration = artifact["lineage"], artifact["calibration"]
    families = [lineage[key] for key in ["trainingFamilies", "selectionFamilies", "calibrationFamilies"]]
    joined = [family for group in families for family in group]
    if not all(families) or len(joined) != len(set(joined)) or not lineage.get("excludedPriorHeldout"):
        raise ValueError("Invalid family isolation")
    if any(not math.isfinite(calibration[key]) or calibration[key] <= 0 for key in ["neutralTemperature", "goalTemperature"]):
        raise ValueError("Invalid temperature")
    reliability = calibration["reliability"]
    if reliability["status"] == "unavailable":
        if reliability["bins"]: raise ValueError("Unavailable reliability cannot have bins")
    elif reliability["status"] == "teacher-calibrated":
        if lineage["goalTraining"] != "teacher-goals" or not reliability["bins"] or not reliability["sourceHashes"]:
            raise ValueError("Teacher calibration requires independent provenance")
        previous = 0
        for item in reliability["bins"]:
            if not previous < item["upper"] <= 1 or not 0 <= item["probability"] <= 1 or not isinstance(item["count"], int) or item["count"] < 1:
                raise ValueError("Invalid reliability bin")
            previous = item["upper"]
        if previous != 1: raise ValueError("Reliability bins must cover confidence one")
    else:
        raise ValueError("Unknown reliability status")
    return artifact


def metrics(rows, neutral, goal=None, reliability=0, temperature=1):
    correct = nll = no_read_correct = uncovered_correct = reads = nonreads = uncovered = covered = top3 = 0
    for row in rows:
        probs = probabilities(row, neutral, goal, reliability, temperature)
        best = max(range(len(probs)), key=lambda i: probs[i])
        correct += best in row["targets"]
        nll -= math.log(max(1e-12, sum(probs[i] for i in row["targets"])))
        n = len(row["candidates"])
        nonreads += not row["actualRead"]
        no_read_correct += not row["actualRead"] and best == n
        uncovered += row["actualRead"] and row["targets"] == [n + 1]
        uncovered_correct += row["actualRead"] and row["targets"] == [n + 1] and best == n + 1
        reads += row["actualRead"]
        covered += row["actualRead"] and any(i < n for i in row["targets"])
        top = sorted(range(n), key=lambda i: (-probs[i], row["candidates"][i]["id"]))[:3]
        top3 += row["actualRead"] and bool(set(top) & set(row["targets"]))
    return {"checkpoints": len(rows), "jointActionAccuracy": correct / max(1, len(rows)), "estimatedActionCrossEntropyNats": nll / max(1, len(rows)),
        "readCheckpoints": reads, "candidateCoverage": covered / max(1, reads), "readTop3Exact": top3 / max(1, reads),
        "nonreadCheckpoints": nonreads, "noReadSpecificity": no_read_correct / max(1, nonreads),
        "uncoveredReadCheckpoints": uncovered, "uncoveredReadAccuracy": uncovered_correct / max(1, uncovered)}


def train(dataset_directory, output_directory, epochs=120):
    import torch
    torch.set_num_threads(1)
    torch.manual_seed(51219)
    directory, output = Path(dataset_directory), Path(output_directory)
    if output.exists():
        raise ValueError("Training output must be new")
    data = (directory / "dataset.jsonl").read_bytes()
    manifest = json.loads((directory / "manifest.json").read_text())
    fresh_profile = manifest.get("version") == "goalspec-controller-dataset-v5-fresh"
    expected_policy = "prior-v4-train-families-plus-fresh-v5-training-only" if fresh_profile else "prior-v4-train-families-only-no-confirmation-cohorts"
    if manifest.get("version") not in {"goalspec-controller-dataset-v5", "goalspec-controller-dataset-v5-fresh"} or hashlib.sha256(data).hexdigest() != manifest["datasetHash"] or manifest["sourcePolicy"] != expected_policy:
        raise ValueError("Training source contract mismatch")
    rows = [json.loads(line) for line in data.splitlines()]
    splits = {name: [row for row in rows if row["split"] == name] for name in ["train", "selection", "calibration"]}
    for row in rows:
        if "confirmation" in row["cohort"] or manifest["splits"].get(row["familyId"]) != row["split"]:
            raise ValueError("Forbidden held-out row")
        if len(row["features"]) != len(row["candidates"]) + 2 or not row["targets"] or any(not isinstance(i, int) or i < 0 or i >= len(row["features"]) for i in row["targets"]):
            raise ValueError("Invalid listwise labels")
        for candidate, features in zip([*row["candidates"], "NO_READ", "READ_UNCOVERED"], row["features"]):
            expected = candidate_features(row["context"], candidate)
            if any(len(expected[head]) != len(features[head]) or any(not math.isfinite(b) or abs(a - b) > 1e-12 for a, b in zip(expected[head], features[head])) for head in expected):
                raise ValueError("TS/Python feature mismatch")
    if not isinstance(epochs, int) or epochs < 1 or epochs > 1000 or any(not part for part in splits.values()):
        raise ValueError("Nonempty disjoint train/selection/calibration folds and bounded epochs required")
    if fresh_profile and any(row.get("goalSupervision") != "masked-until-independent-annotation-join" for row in rows):
        raise ValueError("Fresh profile requires explicitly masked goal labels")
    dtype = torch.float64
    tensors = [(torch.tensor([f["neutral"] for f in row["features"]], dtype=dtype), torch.tensor([f["goal"] for f in row["features"]], dtype=dtype), row["targets"], row["familyId"]) for row in splits["train"]]
    family_counts = {family: sum(row["familyId"] == family for row in splits["train"]) for family in {row["familyId"] for row in splits["train"]}}
    def fit(neutral, residual=False):
        weights = torch.zeros(GOAL_DIMENSION if residual else NEUTRAL_DIMENSION, dtype=dtype, requires_grad=True)
        optimizer = torch.optim.Adam([weights], lr=.03)
        best = None
        for epoch in range(epochs):
            optimizer.zero_grad()
            losses = []
            for index, (x, g, targets, family) in enumerate(tensors):
                # Fixed deterministic 50% goal dropout; neutral base is frozen.
                strength = int((index + epoch) % 2 == 0) if residual else 0
                logits = x @ neutral + strength * (g @ weights) if residual else x @ weights
                loss = torch.logsumexp(logits, 0) - torch.logsumexp(logits[targets], 0)
                losses.append(loss / family_counts[family])
            objective = sum(losses) / len(family_counts) + .01 * weights.square().mean()
            objective.backward(); optimizer.step()
            exported = weights.detach().tolist()
            score = metrics(splits["selection"], neutral.tolist() if residual else exported,
                exported if residual else None, 1 if residual else 0)["estimatedActionCrossEntropyNats"]
            if best is None or score < best[0]: best = (score, exported, epoch + 1)
        return best
    neutral_result = fit(torch.zeros(NEUTRAL_DIMENSION, dtype=dtype))
    neutral_weights = neutral_result[1]
    goal_result = (None, [0.0] * GOAL_DIMENSION, 0) if fresh_profile else fit(torch.tensor(neutral_weights, dtype=dtype), residual=True)
    goal_weights = goal_result[1]
    temperatures = [.5, .75, 1, 1.5, 2, 3, 4]
    neutral_temperature = min(temperatures, key=lambda t: metrics(splits["calibration"], neutral_weights, temperature=t)["estimatedActionCrossEntropyNats"])
    goal_temperature = neutral_temperature if fresh_profile else min(temperatures, key=lambda t: metrics(splits["calibration"], neutral_weights, goal_weights, 1, t)["estimatedActionCrossEntropyNats"])
    body = {"version": "goalspec-controller-v5", "featureVersion": FEATURE_VERSION, "architecture": "listwise-linear-neutral-plus-goal-residual",
        "neutralWeights": neutral_weights, "goalWeights": goal_weights,
        "calibration": {"neutralTemperature": neutral_temperature, "goalTemperature": goal_temperature,
            "reliability": {"status": "unavailable", "bins": [], "sourceHashes": []}},
        "lineage": {"datasetHash": manifest["datasetHash"], "trainingFamilies": sorted({row["familyId"] for row in splits["train"]}) if fresh_profile else sorted(f for f, s in manifest["splits"].items() if s == "train"),
            "selectionFamilies": sorted({row["familyId"] for row in splits["selection"]}) if fresh_profile else sorted(f for f, s in manifest["splits"].items() if s == "selection"), "calibrationFamilies": sorted({row["familyId"] for row in splits["calibration"]}) if fresh_profile else sorted(f for f, s in manifest["splits"].items() if s == "calibration"),
            "goalTraining": "none" if fresh_profile else "literal-request-proxy", "excludedPriorHeldout": True,
            "sources": [{"path": str(directory / "manifest.json"), "sha256": hashlib.sha256((directory / "manifest.json").read_bytes()).hexdigest()},
                        {"path": str(Path(__file__)), "sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}]}}
    artifact = validate_artifact({**body, "contentHash": hash_v1(body)})
    report = {"version": "goalspec-controller-v5-training-report", "artifactHash": artifact["contentHash"], "epochsMaximum": epochs,
        "selectedEpochs": {"neutral": neutral_result[2], "goalProxy": goal_result[2]}, "selectionObjective": "family-disjoint selection cross-entropy; early stopping",
        "calibrationUse": "temperature only; no model or architecture selection", "featureParity": "every exported TS vector verified in Python",
        "semanticReliability": "unavailable; deployed inferred-goal residual is exactly zero", "noExecutorModelWeightsChanged": True,
        "actualFamiliesBySplit": {name: sorted({row["familyId"] for row in part}) for name, part in splits.items()},
        "literalGroundedCheckpoints": sum(row["context"]["goals"]["grounded"] and row["context"]["goals"].get("kind") == "literal-proxy" for row in rows),
        "goalResidualLabels": "masked pending independent annotation join" if fresh_profile else "literal-request-proxy only",
        "sourcePolicy": expected_policy,
        "labelSemantics": "Any exact current candidate among the next actor batch of read calls is positive; a missing read maps to READ_UNCOVERED; otherwise NO_READ",
        "metrics": {name: {"neutralDeployed": metrics(part, neutral_weights, temperature=neutral_temperature),
            "goalResidualMasked" if fresh_profile else "literalProxyExperimental": metrics(part, neutral_weights, goal_weights, 1, goal_temperature)} for name, part in splits.items()},
        "limitations": ["Training, selection and calibration results are not held-out performance", "Unlabeled goal residuals are masked in the fresh profile; literal proxies in the initial profile are not annotation-teacher supervision", "No exposure benefit, execution utility, actor latency or task success was fitted or estimated from these imitation labels"]}
    output.mkdir(parents=True)
    (output / "controller.json").write_bytes(canonical_v1(artifact) + b"\n")
    (output / "report.json").write_bytes(canonical_v1(report) + b"\n")
    return report
