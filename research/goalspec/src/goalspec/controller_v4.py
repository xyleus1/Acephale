"""CPU controller training and portable inference. Labels never enter features."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from pathlib import Path

from .contracts_v1 import canonical_v1, hash_v1

FEATURE_VERSION = "goalspec-controller-features-v1"
DIMENSION = 216
HEADS = ["actionRead", "nextAction", "usefulWithin2", "readiness", "exposure"]


def feature_tokens(text):
    return re.findall(r"[a-z0-9_]+", re.sub(r"[^a-z0-9_]+", " ", text.lower())[:16384])[:512]


def _canonical_text(value):
    return canonical_v1(value).decode("utf-8")


def _js_length(text):
    return len(text.encode("utf-16-le")) // 2


def build_decision_state(frame):
    """Public-prefix state compiler, matching the TypeScript reserved-source rule."""
    sources = {key: value for key, value in frame["sources"].items() if key != "server_policy"}
    # Requirement IDs use ASCII namespace labels and numeric conversation order.
    ordered = sorted(((key, value) for key, value in sources.items() if re.match(r"^(requirement:|request:|current_user_request$)", key)),
                     key=lambda item: tuple((0, int(part)) if part.isdigit() else (1, part) for part in re.split(r"(\d+)", item[0])))
    requirements = [value if isinstance(value, str) else _canonical_text(value) for _, value in ordered]
    events = sources.get("_binding_events", [])
    recent = [event["tool"] for event in events if isinstance(event, dict) and event.get("kind") == "tool_result"
              and event.get("status") == "success" and isinstance(event.get("tool"), str)][-12:] if isinstance(events, list) else []
    return {"version": "goalspec-decision-state-v1", "boundary": frame["boundary"], "requestedObjective": frame["requestedObjective"],
            "activeGoals": [" ".join([goal["objective"], *[constraint["text"] for constraint in goal["constraints"]]]) for goal in frame["goals"]["hypotheses"]],
            "unresolvedRequirements": requirements, "recentTools": recent,
            "sourceIds": sorted(sources, key=lambda key: key.encode("utf-16-be")), "visibleText": _canonical_text(sources), "unknownGoal": frame["goals"]["unknown"]}


def candidate_features(state, candidate):
    cap = lambda n, scale: min(1, max(0, n / scale))
    overlap = lambda a, b: len(set(a) & set(b)) / len(set(b)) if b else 0
    request = feature_tokens(" ".join(state["unresolvedRequirements"][-3:]) or state["requestedObjective"])
    goals = []  # Public-request-only profile: inferred-goal slots deliberately neutral.
    tool_name = candidate["invocation"]["tool"] if candidate else "NO_READ"
    tool = feature_tokens(tool_name.replace("_", " ") if candidate else "NO_READ")
    arguments = candidate["invocation"]["arguments"] if candidate else {}
    arguments_text = _canonical_text(arguments) if candidate else ""
    args = feature_tokens(arguments_text)
    values = list(arguments.values())
    bindings = candidate["bindings"] if candidate else []
    numeric = [1, cap(state["boundary"], 40), 1, 0, cap(len(state["unresolvedRequirements"]), 12),
               cap(len(state["sourceIds"]), 64), cap(len(state["recentTools"]), 12), int(candidate is not None), 0.86 if candidate else 0,
               0.5 if candidate else 0, cap(len(bindings), 8), cap(len(values), 8), cap(sum(isinstance(v, str) for v in values), 8),
               cap(sum(type(v) in (int, float) for v in values), 8), 0, int(bool(candidate and tool_name in state["recentTools"])),
               overlap(request, tool), overlap(request, args), overlap(goals, tool), overlap(goals, args),
               sum(ref["sourceId"] in state["sourceIds"] for ref in bindings) / len(bindings) if bindings else 0,
               cap(_js_length(" ".join(state["unresolvedRequirements"])), 4096), cap(_js_length(state["visibleText"]), 32768), cap(_js_length(arguments_text), 1024)]
    hashed = [0] * 192
    tokens = ([f"r:{t}" for t in request] + [f"g:{t}" for t in goals] + [f"t:{t}" for t in tool]
              + [f"p:{t}" for t in state["recentTools"][-3:]] + [f"x:{tool_name}:{t}" for t in request] + [f"a:{t}" for t in args])
    for token in tokens:
        h = 2166136261
        utf16 = token.encode("utf-16-le")
        for i in range(0, len(utf16), 2):
            code = utf16[i] | (utf16[i + 1] << 8)
            h = ((h ^ code) * 16777619) & 0xFFFFFFFF
        hashed[h % 192] += -1 if h & 0x80000000 else 1
    norm = math.sqrt(sum(v * v for v in hashed)) or 1
    return numeric + [v / norm for v in hashed]


def validate_artifact(value, schema_path):
    import jsonschema
    schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator({"$ref": "#/$defs/ControllerArtifact", "$defs": schema["$defs"]}).validate(value)
    body = {k: v for k, v in value.items() if k != "contentHash"}
    if hash_v1(body) != value["contentHash"] or value["heads"] != HEADS:
        raise ValueError("Controller artifact hash/head mismatch")
    width = DIMENSION
    for layer in value["layers"]:
        if len(layer["weights"]) != len(layer["bias"]) or any(len(row) != width for row in layer["weights"]):
            raise ValueError("Controller artifact matrix mismatch")
        width = len(layer["bias"])
    if width != 5 or value["layers"][-1]["activation"] != "linear":
        raise ValueError("Invalid output layer")
    architecture = [(5, 216, "linear")] if value["architecture"] == "logistic" else [(32, 216, "relu"), (16, 32, "relu"), (5, 16, "linear")]
    actual_architecture = [(len(layer["weights"]), len(layer["weights"][0]), layer["activation"]) for layer in value["layers"]]
    if actual_architecture != architecture:
        raise ValueError("Controller architecture declaration mismatch")
    lineage = value["lineage"]
    sets = [set(lineage[k]) for k in ["trainFamilies", "selectionFamilies", "calibrationFamilies"]]
    if len(sets[0]) != len(lineage["trainFamilies"]) or any(sets[i] & sets[j] for i in range(3) for j in range(i)):
        raise ValueError("Family contamination")
    if value["trainedHeads"]["exposure"] and not lineage["randomizedExposureDataHash"]:
        raise ValueError("Missing randomized exposure lineage")


def infer(artifact, features):
    hidden = features
    for layer in artifact["layers"]:
        hidden = [sum(w * v for w, v in zip(row, hidden, strict=True)) + b for row, b in zip(layer["weights"], layer["bias"], strict=True)]
        if layer["activation"] == "relu":
            hidden = [max(0, v) for v in hidden]
    logits = [(v + b) / t for v, b, t in zip(hidden, artifact["calibration"]["bias"], artifact["calibration"]["temperature"], strict=True)]
    return [1 / (1 + math.exp(-v)) if v >= 0 else math.exp(v) / (1 + math.exp(v)) for v in logits]


def train_controller(dataset_path: Path, output: Path, schema_path: Path, seed: int = 43117):
    import torch
    from torch import nn
    from torch.nn import functional as functional

    if output.exists():
        raise ValueError("Training output must be a new directory")
    torch.set_num_threads(2)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True)
    raw = dataset_path.read_bytes()
    dataset_hash = hashlib.sha256(raw).hexdigest()
    manifest = json.loads(dataset_path.with_name("manifest.json").read_text(encoding="utf-8"))
    if manifest["datasetHash"] != dataset_hash or manifest["baseOnly"] is not True:
        raise ValueError("Dataset provenance mismatch")
    rows = [json.loads(line) for line in raw.splitlines()]
    splits = {name: [row for row in rows if row["split"] == name] for name in ["train", "selection", "calibration"]}
    family_sets = {name: {r["familyId"] for r in part} for name, part in splits.items()}
    if any(not part for part in splits.values()) or any(family_sets[a] & family_sets[b] for a in family_sets for b in family_sets if a != b):
        raise ValueError("Invalid family-disjoint data split")
    for row in rows:
        if manifest["splits"].get(row["familyId"]) != row["split"]:
            raise ValueError("Dataset family assignment changed")
        computed = candidate_features(row["state"], row["candidate"])
        if len(computed) != DIMENSION or max(abs(a - b) for a, b in zip(computed, row["features"]["values"], strict=True)) > 1e-12:
            raise ValueError("Python/TypeScript feature mismatch")
        if row["labels"][4] is not None:
            raise ValueError("Historical exposure labels cannot train causal usefulness")

    def tensors(part):
        return (torch.tensor([r["features"]["values"] for r in part], dtype=torch.float32),
                torch.tensor([[v or 0 for v in r["labels"]] for r in part], dtype=torch.float32),
                torch.tensor([[v is not None for v in r["labels"]] for r in part], dtype=torch.float32))

    tensor_splits = {name: tensors(part) for name, part in splits.items()}
    x, y, mask = tensor_splits["train"]
    active = mask.sum(0).clamp(min=1)
    positives = (y * mask).sum(0)
    pos_weight = ((active - positives) / positives.clamp(min=1)).clamp(1, 8)
    # Masks isolate the action sentinel and absent causal supervision from candidate labels.
    def loss_fn(logits, targets, valid, weighted=True):
        losses = functional.binary_cross_entropy_with_logits(logits, targets, reduction="none", pos_weight=pos_weight if weighted else None)
        return ((losses * valid).sum(0) / valid.sum(0).clamp(min=1))[:4].mean()

    def model(kind):
        return nn.Sequential(nn.Linear(DIMENSION, 5)) if kind == "logistic" else nn.Sequential(nn.Linear(DIMENSION, 32), nn.ReLU(), nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 5))

    early_stopping = []
    def fit(net, epochs, lr, decay, ranking_weight=0.0):
        optimizer = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=decay)
        validation_x, validation_y, validation_mask = tensor_splits["selection"]
        with torch.no_grad():
            best_loss = float(loss_fn(net(validation_x), validation_y, validation_mask, weighted=False))
        best_state, best_epoch = copy.deepcopy(net.state_dict()), 0
        groups = {}
        for i, row in enumerate(splits["train"]):
            if row["candidate"]:
                groups.setdefault(row["groupId"], []).append(i)
        pairs = [(positive, negative) for ids in groups.values() for positive in ids if y[positive, 1] == 1 for negative in ids if y[negative, 1] == 0]
        if pairs:
            pair_tensor = torch.tensor(pairs)
        for epoch in range(epochs):
            net.train(); optimizer.zero_grad(set_to_none=True)
            logits = net(x); loss = loss_fn(logits, y, mask)
            if ranking_weight and pairs:
                loss = loss + ranking_weight * functional.softplus(logits[pair_tensor[:, 1], 1] - logits[pair_tensor[:, 0], 1]).mean()
            loss.backward(); optimizer.step()
            if (epoch + 1) % 5 == 0:
                with torch.no_grad():
                    validation_loss = float(loss_fn(net(validation_x), validation_y, validation_mask, weighted=False))
                if validation_loss < best_loss:
                    best_loss, best_epoch, best_state = validation_loss, epoch + 1, copy.deepcopy(net.state_dict())
        net.load_state_dict(best_state)
        early_stopping.append({"epochsRequested": epochs, "selectedEpoch": best_epoch, "selectionBce": best_loss, "learningRate": lr, "weightDecay": decay, "rankingWeight": ranking_weight})
        net.eval()
        return net

    def metrics(net, split, temperature=None):
        features, targets, valid = tensor_splits[split]
        with torch.no_grad():
            logits = net(features)
            if temperature is not None:
                logits = logits / torch.tensor(temperature)
            probabilities = logits.sigmoid()
            per_head = (functional.binary_cross_entropy_with_logits(logits, targets, reduction="none") * valid).sum(0) / valid.sum(0).clamp(min=1)
        group_rows = {}
        for i, row in enumerate(splits[split]):
            group_rows.setdefault(row["groupId"], []).append((i, row))
        read_total = read_hits = pool_hits = correct_action = 0
        for entries in group_rows.values():
            sentinel = next((i for i, r in entries if r["candidate"] is None), None)
            if sentinel is None:
                continue
            is_read = bool(targets[sentinel, 0]); correct_action += int(bool(probabilities[sentinel, 0] >= 0.5) == is_read)
            if is_read:
                read_total += 1
                candidates = [(i, r) for i, r in entries if r["candidate"]]
                pool_hits += int(any(targets[i, 1] == 1 for i, _ in candidates))
                if candidates:
                    chosen = max(candidates, key=lambda pair: float(probabilities[pair[0], 1] + probabilities[pair[0], 2]))[0]
                    read_hits += int(targets[chosen, 1] == 1)
        return {"maskedBce": float(per_head[:4].mean()), "headBce": {h: float(per_head[i]) if valid[:, i].sum() else None for i, h in enumerate(HEADS)},
                "actionAccuracy": correct_action / len(group_rows), "actionCount": len(group_rows), "exactArgumentTop1": read_hits / read_total if read_total else None,
                "exactArgumentHits": read_hits, "readDecisions": read_total, "candidatePoolCoverage": pool_hits / read_total if read_total else None, "candidatePoolHits": pool_hits}

    baseline = fit(model("logistic"), 180, 0.015, 0.03)
    base = fit(model("mlp-32-16"), 160, 0.008, 0.03)
    checkpoints = {"mlp-base": base}
    for name, lr, decay, rank in [("fine-low", 0.001, 0.02, 0.0), ("fine-regularized", 0.002, 0.2, 0.1), ("fine-ranking", 0.0015, 0.04, 0.3)]:
        checkpoints[name] = fit(copy.deepcopy(base), 60, lr, decay, rank)
    evaluations = {name: metrics(net, "selection") for name, net in checkpoints.items()}
    ordered = sorted(checkpoints, key=lambda name: evaluations[name]["maskedBce"])
    soup = copy.deepcopy(checkpoints[ordered[0]]); members = [ordered[0]]
    attempts = []
    for name in ordered[1:]:
        proposed = copy.deepcopy(soup)
        proposed.load_state_dict({k: (v * len(members) + checkpoints[name].state_dict()[k]) / (len(members) + 1) for k, v in soup.state_dict().items()})
        before, after = metrics(soup, "selection"), metrics(proposed, "selection")
        improves = after["maskedBce"] < before["maskedBce"] - 1e-6 and (after["exactArgumentTop1"] or 0) >= (before["exactArgumentTop1"] or 0)
        attempts.append({"add": name, "accepted": improves, "metrics": after})
        if improves:
            soup = proposed; members.append(name)
    models = {"logistic": baseline, **checkpoints, "greedy-soup": soup}
    for name, net in models.items():
        evaluations[name] = metrics(net, "selection")
    selected_name = min(models, key=lambda name: (evaluations[name]["maskedBce"], -(evaluations[name]["exactArgumentTop1"] or 0)))
    selected = models[selected_name]
    calibration_x, calibration_y, calibration_mask = tensor_splits["calibration"]
    with torch.no_grad():
        calibration_logits = selected(calibration_x)
        temperatures = []
        for i in range(5):
            if not calibration_mask[:, i].sum():
                temperatures.append(1.0); continue
            options = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0]
            temperatures.append(min(options, key=lambda t: float((functional.binary_cross_entropy_with_logits(calibration_logits[:, i] / t, calibration_y[:, i], reduction="none") * calibration_mask[:, i]).sum())))
    layers = [{"weights": layer.weight.detach().tolist(), "bias": layer.bias.detach().tolist(), "activation": "linear" if index == len(selected) - 1 else "relu"}
              for index, layer in enumerate(selected) if isinstance(layer, nn.Linear)]
    artifact = {"version": "goalspec-controller-artifact-v1", "featureVersion": FEATURE_VERSION, "goalFeaturePolicy": "public-request-only", "inputDimension": DIMENSION,
                "architecture": "logistic" if selected_name == "logistic" else "mlp-32-16", "layers": layers, "heads": HEADS,
                "trainedHeads": {h: h != "exposure" for h in HEADS}, "calibration": {"temperature": temperatures, "bias": [0] * 5, "method": "family-heldout-temperature-grid"},
                "thresholds": {"actionRead": 0.5, "usefulWithin2": 0.5, "readiness": 0.5, "exposure": 1},
                "lineage": {"datasetHash": dataset_hash, "trainFamilies": sorted(family_sets["train"]), "selectionFamilies": sorted(family_sets["selection"]),
                            "calibrationFamilies": sorted(family_sets["calibration"]), "baseOnly": True, "seed": seed, "selectedCheckpoint": selected_name,
                            "soupMembers": members if selected_name == "greedy-soup" else [], "randomizedExposureDataHash": None,
                            "labelSemantics": "next-action-imitation;within-two-observed-use;readiness-is-not-authorization;exposure-masked"}}
    artifact["contentHash"] = hash_v1(artifact)
    validate_artifact(artifact, schema_path)
    with torch.no_grad():
        model_logits = selected(calibration_x[:32])
        native_probabilities = (model_logits / torch.tensor(temperatures)).sigmoid().tolist()
    parity = [{"features": splits["calibration"][i]["features"]["values"], "probabilities": infer(artifact, splits["calibration"][i]["features"]["values"]),
               "torchProbabilities": native_probabilities[i], "state": splits["calibration"][i]["state"], "candidate": splits["calibration"][i]["candidate"]} for i in range(len(native_probabilities))]
    report = {"version": "goalspec-controller-training-v1", "datasetHash": dataset_hash, "seed": seed, "torchVersion": torch.__version__, "device": "cpu", "threads": 2,
              "rows": {k: len(v) for k, v in splits.items()}, "families": {k: sorted(v) for k, v in family_sets.items()},
              "selectionMetrics": evaluations, "soupAttempts": attempts, "soupMembers": members, "selectedCheckpoint": selected_name, "earlyStopping": early_stopping,
              "calibrationMetricsBefore": metrics(selected, "calibration"), "calibrationMetricsAfter": metrics(selected, "calibration", temperatures),
              "artifactHash": artifact["contentHash"], "causalExposureHeadTrained": False,
              "limitations": ["Historical development, not fresh test performance", "Within-two label means observed future use, not causal usefulness", "Readiness score cannot authorize execution", "Calibration metrics are fitted diagnostics", "Binary READ/NO_READ action head; message/write/compute/stop unmodeled", "Public-request-only features; inferred goals deliberately ignored"]}
    report["trainingCode"] = [{"path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in [Path(__file__), schema_path]]
    output.mkdir(parents=True)
    for filename, value in [("controller.json", artifact), ("training-report.json", report), ("parity-fixtures.json", parity)]:
        (output / filename).write_bytes(canonical_v1(value) + b"\n")
    for name, net in models.items():
        torch.save(net.state_dict(), output / (name + ".pt"))
    return report
