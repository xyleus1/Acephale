"""Optional offline residual fitting from independently labeled goal agreement.

The neutral ranker stays frozen. Reliability calibration families never update
the goal residual. Annotation agreement is not semantic truth or execution utility.
"""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path
from .contracts_v1 import canonical_v1, hash_v1
from .controller_v5 import GOAL_DIMENSION, candidate_features, metrics, validate_artifact


def teacher_family_partition(rows, family_declarations=None):
    declared = dict(family_declarations or {})
    for row in rows:
        family, split = row["familyId"], row["reliabilitySplit"]
        if split not in {"train", "calibration"} or declared.get(family, split) != split:
            raise ValueError("Inconsistent reliability family split")
        declared[family] = split
    # One predeclared internal selection family per domain, selected by family ID
    # hash before labels are consumed by the optimizer.
    result = dict(declared)
    for domain in {family.split(":")[0] for family in declared}:
        candidates = [family for family, split in declared.items() if split == "train" and family.startswith(domain + ":")]
        if len(candidates) < 2:
            raise ValueError("Too few goal fitting families for disjoint selection")
        selected = min(candidates, key=lambda family: hash_v1(["v5-goal-selection-before-labels-1", family]))
        result[selected] = "selection"
    if not any(split == "calibration" for split in result.values()):
        raise ValueError("Missing independent reliability calibration family")
    return result


def fit_teacher_residual(base_path, joined_directory, output_directory, epochs=80):
    import torch
    torch.set_num_threads(1); torch.manual_seed(51831)
    base_path, directory, output = Path(base_path), Path(joined_directory), Path(output_directory)
    if output.exists(): raise ValueError("Teacher fit output must be new")
    base_bytes = base_path.read_bytes()
    base = validate_artifact(json.loads(base_bytes))
    data = (directory / "dataset.jsonl").read_bytes()
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if hashlib.sha256(data).hexdigest() != manifest["datasetHash"] or manifest.get("version") != "goalspec-controller-v5-teacher-join":
        raise ValueError("Joined dataset contract/hash mismatch")
    if manifest.get("sourceDatasetHash") != base["lineage"]["datasetHash"]:
        raise ValueError("Teacher join must use the neutral model's exact source dataset")
    rows = [json.loads(line) for line in data.splitlines()]
    partition = teacher_family_partition(rows, manifest["familyReliabilitySplits"])
    base_allowed = set(base["lineage"]["trainingFamilies"])
    for row in rows:
        if row["split"] != "train" or row["familyId"] not in base_allowed or "confirmation" in row["cohort"] or row["goalAgreement"] not in (0, 1):
            raise ValueError("Teacher source is not permitted historical training")
        for choice, features in zip([*row["candidates"], "NO_READ", "READ_UNCOVERED"], row["features"]):
            expected = candidate_features(row["context"], choice)
            if any(len(features[head]) != len(expected[head]) or any(abs(a-b) > 1e-12 for a,b in zip(features[head], expected[head])) for head in expected):
                raise ValueError("Teacher TS/Python feature parity failure")
    splits = {name: [row for row in rows if partition[row["familyId"]] == name] for name in ["train", "selection", "calibration"]}
    if any(len(part) < 5 for part in splits.values()): raise ValueError("Insufficient independent teacher rows")
    if not isinstance(epochs, int) or epochs < 1 or epochs > 1000: raise ValueError("Bounded positive epoch count required")
    dtype = torch.float64
    neutral = torch.tensor(base["neutralWeights"], dtype=dtype)
    residual = torch.zeros(GOAL_DIMENSION, dtype=dtype, requires_grad=True)
    optimizer = torch.optim.Adam([residual], lr=.02)
    tensors = [(torch.tensor([f["neutral"] for f in row["features"]],dtype=dtype),torch.tensor([f["goal"] for f in row["features"]],dtype=dtype),row) for row in splits["train"]]
    counts = {family: sum(row["familyId"] == family for row in splits["train"]) for family in {row["familyId"] for row in splits["train"]}}
    best = None
    for epoch in range(epochs):
        optimizer.zero_grad(); losses = []
        for index, (x,g,row) in enumerate(tensors):
            correction = g @ residual
            # Agreement-negative goals are trained toward neutral behavior;
            # agreement-positive rows get a listwise imitation objective.
            if row["goalAgreement"]:
                logits = x @ neutral + int((index + epoch) % 2 == 0) * correction
                loss = torch.logsumexp(logits,0)-torch.logsumexp(logits[row["targets"]],0)
            else:
                loss = (correction - correction.mean()).square().mean()
            losses.append(loss / counts[row["familyId"]])
        objective = sum(losses)/len(counts) + .02*residual.square().mean()
        objective.backward(); optimizer.step()
        exported = residual.detach().tolist()
        selection_loss = metrics(splits["selection"],base["neutralWeights"],exported,1)["estimatedActionCrossEntropyNats"]
        if best is None or selection_loss < best[0]: best = (selection_loss,exported,epoch+1)
    goal_weights = best[1]
    calibration_rows = splits["calibration"]
    # With this small pilot, one global bin is prespecified. Do not fit many
    # unstable confidence buckets or use next-action correctness as agreement.
    agreements = sum(row["goalAgreement"] for row in calibration_rows)
    reliability = (agreements + 1)/(len(calibration_rows)+2)
    temperature = min([.5,.75,1,1.5,2,3,4],key=lambda t: metrics(calibration_rows,base["neutralWeights"],goal_weights,reliability,t)["estimatedActionCrossEntropyNats"])
    lineage = {**base["lineage"],"datasetHash":hash_v1({"neutralArtifact":base["contentHash"],"teacherDataset":manifest["datasetHash"]}),
        "goalTraining":"teacher-goals", "goalResidualTrainingFamilies":sorted(f for f,s in partition.items() if s=="train"),
        "goalResidualSelectionFamilies":sorted(f for f,s in partition.items() if s=="selection"),
        "goalReliabilityCalibrationFamilies":sorted(f for f,s in partition.items() if s=="calibration"),
        "sources":[*base["lineage"]["sources"],{"path":str(base_path),"sha256":hashlib.sha256(base_bytes).hexdigest()},
            {"path":str(directory/"manifest.json"),"sha256":hashlib.sha256((directory/"manifest.json").read_bytes()).hexdigest()},
            {"path":str(Path(__file__)),"sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}]}
    body = {**{k:v for k,v in base.items() if k!="contentHash"},"goalWeights":goal_weights,"lineage":lineage,
        "calibration":{**base["calibration"],"goalTemperature":temperature,"reliability":{"status":"teacher-calibrated",
            "bins":[{"upper":1,"probability":reliability,"count":len(calibration_rows)}],"sourceHashes":[manifest["datasetHash"]]}}}
    artifact = validate_artifact({**body,"contentHash":hash_v1(body)})
    report = {"version":"goalspec-controller-v5-teacher-fit","artifactHash":artifact["contentHash"],"partition":partition,
        "selectedEpoch":best[2],"epochsMaximum":epochs,"neutralWeightsFrozen":True,
        "goalDropout":.5,"negativeAgreementObjective":"centered residual squared shrinkage toward neutral",
        "reliability":{"label":"conservative independent annotation-teacher agreement, not semantic truth","method":"one prespecified Laplace-smoothed calibration bin",
            "completedCalibrationRows":len(calibration_rows),"agreementPositives":agreements,"probability":reliability,
            "observedCalibrationFamilies":sorted({row["familyId"] for row in calibration_rows}),
            "assessment":"small pilot estimate; correlated prefixes do not establish reliable unseen-family calibration",
            "fewerThan20CalibrationRows":len(calibration_rows)<20},
        "metrics":{name:{"neutral":metrics(part,base["neutralWeights"],temperature=base["calibration"]["neutralTemperature"]),
            "conditional":metrics(part,base["neutralWeights"],goal_weights,reliability,temperature)} for name,part in splits.items()},
        "limitations":["Prior training-prefix reuse, not new held-out performance","Neutral ranker previously saw action labels in these historical families; goal residual and agreement calibration are family disjoint",
            "Calibration action cross-entropy fits temperature only, never teacher reliability","Missing annotation calls were masked by the join, not converted into disagreement","No executor LLM weights changed; no causal utility labels"]}
    output.mkdir(parents=True)
    for name,value in [("controller.json",artifact),("report.json",report)]: (output/name).write_bytes(canonical_v1(value)+b"\n")
    return report
