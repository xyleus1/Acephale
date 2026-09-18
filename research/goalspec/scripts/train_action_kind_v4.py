"""Auxiliary observed action kinds. STOP is unknown unless explicitly supervised."""
import copy
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import jsonschema
import torch
from torch import nn
from torch.nn import functional as functional

from goalspec.contracts_v1 import canonical_v1, hash_v1
from goalspec.controller_v4 import candidate_features

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "research/goalspec/runs/local-controller-v4-dataset-20260916-c/checkpoints.jsonl"
output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "research/goalspec/runs/local-controller-v4-action-kind-20260916"
if output.exists():
    raise ValueError("Action-kind output must be new")
classes = ["read", "message", "write", "compute", "stop"]
roles = {
    "read": ["find_user_id_by_email", "find_user_id_by_name_zip", "get_user_details", "get_order_details", "get_product_details", "get_item_details", "list_all_product_types", "get_reservation_details", "get_flight_status", "list_all_airports", "search_direct_flight", "search_onestop_flight"],
    "write": ["cancel_pending_order", "return_delivered_order_items", "modify_pending_order_address", "modify_user_address", "modify_pending_order_payment", "modify_pending_order_items", "exchange_delivered_order_items", "cancel_reservation", "update_reservation_baggages", "update_reservation_passengers", "update_reservation_flights", "book_reservation"],
    "compute": ["calculate"],
}
role_by_tool = {tool: role for role, tools in roles.items() for tool in tools}
raw = DATA.read_bytes()
all_rows = [json.loads(line) for line in raw.splitlines()]
rows, unknown = [], []
for row in all_rows:
    tools = [a["tool"] for a in row["actual"]]
    kinds = {role_by_tool.get(tool) for tool in tools}
    if None in kinds:
        unknown.append({"groupId": row["groupId"], "reason": "tool-role-not-audited", "tools": tools}); continue
    kind = "message" if not tools else "write" if "write" in kinds else "read" if "read" in kinds else "compute"
    rows.append({**row, "kind": kind, "features": candidate_features(row["state"], None)})
splits = {name: [r for r in rows if r["split"] == name] for name in ["train", "selection", "calibration"]}
counts = {name: [sum(r["kind"] == kind for r in part) for kind in classes] for name, part in splits.items()}
trained = [count > 0 for count in counts["train"]]
torch.set_num_threads(2); torch.manual_seed(43118); torch.use_deterministic_algorithms(True)
net = nn.Linear(216, 5)
mask = torch.tensor(trained)


def tensors(part, supported_only=True):
    part = [r for r in part if not supported_only or trained[classes.index(r["kind"])]]
    return torch.tensor([r["features"] for r in part], dtype=torch.float32), torch.tensor([classes.index(r["kind"]) for r in part], dtype=torch.long)


x, y = tensors(splits["train"])
sx, sy = tensors(splits["selection"])
optimizer = torch.optim.AdamW(net.parameters(), lr=0.012, weight_decay=0.1)
best_loss, best_epoch, best_state = float("inf"), 0, copy.deepcopy(net.state_dict())
for epoch in range(180):
    optimizer.zero_grad(set_to_none=True)
    logits = net(x).masked_fill(~mask, -1e9)
    loss = functional.cross_entropy(logits, y); loss.backward(); optimizer.step()
    if (epoch + 1) % 5 == 0:
        with torch.no_grad():
            selection_loss = float(functional.cross_entropy(net(sx).masked_fill(~mask, -1e9), sy))
        if selection_loss < best_loss:
            best_loss, best_epoch, best_state = selection_loss, epoch + 1, copy.deepcopy(net.state_dict())
net.load_state_dict(best_state); net.eval()
cx, cy = tensors(splits["calibration"])
with torch.no_grad():
    cal_logits = net(cx).masked_fill(~mask, -1e9)
    temperature = min([0.5, 0.75, 1, 1.5, 2, 3, 5, 8], key=lambda t: float(functional.cross_entropy(cal_logits / t, cy)))
artifact = {"version": "goalspec-action-kind-artifact-v1", "featureVersion": "goalspec-controller-features-v1", "goalFeaturePolicy": "public-request-only",
            "classes": classes, "trained": trained, "weights": net.weight.detach().tolist(), "bias": net.bias.detach().tolist(), "temperature": temperature,
            "lineage": {"datasetHash": hashlib.sha256(raw).hexdigest(), "baseOnly": True,
                        "trainFamilies": sorted({r["familyId"] for r in splits["train"]}), "selectionFamilies": sorted({r["familyId"] for r in splits["selection"]}),
                        "calibrationFamilies": sorted({r["familyId"] for r in splits["calibration"]}), "trainLabelCounts": counts["train"],
                        "seed": 43118, "selectedEpoch": best_epoch, "stopLabelPolicy": "unavailable-without-explicit-public-actor-stop", "roleMapHash": hash_v1(roles)}}
artifact["contentHash"] = hash_v1(artifact)
schema = json.loads((ROOT / "src/lib/goalspec/contracts/v4-action-kind.schema.json").read_text(encoding="utf-8"))
jsonschema.Draft202012Validator(schema).validate(artifact)
metrics = {}
for name, part in splits.items():
    px, py = tensors(part, supported_only=False)
    with torch.no_grad():
        logits = net(px).masked_fill(~mask, -1e9) / temperature
        predicted = logits.argmax(1)
    confusion = [[int(((py == i) & (predicted == j)).sum()) for j in range(5)] for i in range(5)]
    supported = [i for i, kind in enumerate(py) if trained[int(kind)]]
    metrics[name] = {"decisions": len(part), "accuracy": float((predicted == py).float().mean()), "labelCounts": counts[name], "confusion": confusion,
                     "crossEntropySupportedClassesNats": float(functional.cross_entropy(logits[supported], py[supported])), "unsupportedActualClassCount": len(part) - len(supported)}
with torch.no_grad():
    probabilities = (net(cx[:32]).masked_fill(~mask, -1e9) / temperature).softmax(1).tolist()
calibrated_part = [r for r in splits["calibration"] if trained[classes.index(r["kind"])]]
parity = [{"state": row["state"], "probabilities": [p if trained[i] else None for i, p in enumerate(probabilities[index])]} for index, row in enumerate(calibrated_part[:32])]
report = {"version": "goalspec-action-kind-training-v1", "artifactHash": artifact["contentHash"], "metrics": metrics, "roles": roles, "unknownLabels": unknown,
          "classOrder": classes, "trained": trained, "stopAvailability": "untrained; zero explicit public actor-stop labels", "temperature": temperature, "selectedEpoch": best_epoch,
          "conditionalDistribution": "probabilities sum to one only over classes observed in training; unavailable classes return null",
          "limitations": ["Auxiliary output does not change the selected binary execution gate", "STOP cannot be inferred from private/native terminal reward", "Only three calculator examples exist across all splits", "Selection and calibration metrics are development diagnostics"],
          "sourceCodeHash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "datasetHash": artifact["lineage"]["datasetHash"]}
output.mkdir(parents=True)
for name, value in [("action-kind.json", artifact), ("report.json", report), ("parity-fixtures.json", parity)]:
    (output / name).write_bytes(canonical_v1(value) + b"\n")
print(json.dumps({"artifactHash": artifact["contentHash"], "trained": trained, "selectedEpoch": best_epoch, "metrics": metrics, "unknownLabels": len(unknown)}, indent=2))
