import pytest
import copy
import hashlib
import json
from goalspec.contracts_v1 import canonical_v1, hash_v1
from goalspec.controller_v5 import candidate_features
from goalspec.controller_v5_teacher import teacher_family_partition, fit_teacher_residual


def test_teacher_partition_is_family_disjoint_and_uses_predeclared_failed_families():
    declarations = {f"{domain}:{i}": "calibration" if i == 0 else "train" for domain in ["retail", "airline"] for i in range(5)}
    rows = [{"familyId": family, "reliabilitySplit": split, "goalAgreement": 1} for family, split in declarations.items()]
    partition = teacher_family_partition(rows, declarations)
    assert list(partition.values()).count("selection") == 2
    assert list(partition.values()).count("calibration") == 2
    assert list(partition.values()).count("train") == 6
    # Failed labels may disappear from fitting rows; they cannot reassign folds.
    assert teacher_family_partition(rows[:2], declarations) == partition
    for row in rows: row["goalAgreement"] = 0
    assert teacher_family_partition(rows, declarations) == partition


def test_conflicting_teacher_family_splits_fail_closed():
    with pytest.raises(ValueError, match="Inconsistent"):
        teacher_family_partition([{"familyId": "retail:a", "reliabilitySplit": "train"}, {"familyId": "retail:a", "reliabilitySplit": "calibration"}])
    with pytest.raises(ValueError, match="Too few"):
        teacher_family_partition([{"familyId": "retail:a", "reliabilitySplit": "train"}])


def test_calibration_labels_cannot_update_goal_weights_or_neutral_base(tmp_path):
    pytest.importorskip("torch")
    declarations = {f"{domain}:{i}": "calibration" if i == 0 else "train" for domain in ["retail", "airline"] for i in range(5)}
    base = {"version":"goalspec-controller-v5","featureVersion":"goalspec-controller-features-v5.1","architecture":"listwise-linear-neutral-plus-goal-residual",
        "neutralWeights":[0.01]*120,"goalWeights":[0]*72,"calibration":{"neutralTemperature":1,"goalTemperature":1,"reliability":{"status":"unavailable","bins":[],"sourceHashes":[]}},
        "lineage":{"datasetHash":"a"*64,"trainingFamilies":sorted(declarations),"selectionFamilies":["unrelated:select"],"calibrationFamilies":["unrelated:cal"],"goalTraining":"literal-request-proxy","excludedPriorHeldout":True,"sources":[]}}
    base["contentHash"]=hash_v1(base)
    base_path=tmp_path/"base.json"; base_path.write_bytes(canonical_v1(base))
    rows=[]
    for family,split in declarations.items():
        for boundary in range(3):
            context={"frame":{"boundary":boundary,"requestedObjective":"Read order A","sources":{"requirement:0":"Read order A"},"goals":{"hypotheses":[],"unknown":1}},
                "goals":{"grounded":True,"set":{"hypotheses":[{"objective":"Read order A","constraints":[]}]}},"memory":None,"workflows":[]}
            candidate={"id":"order","bindings":[{"sourceId":"requirement:0","path":[]}],"invocation":{"tool":"get_order_details","arguments":{"order_id":"A"}}}
            rows.append({"familyId":family,"split":"train","cohort":"synthetic-training-only","reliabilitySplit":split,"goalAgreement":1,"context":context,
                "candidates":[candidate],"features":[candidate_features(context,c) for c in [candidate,"NO_READ","READ_UNCOVERED"]],"targets":[0],"actualRead":True})
    artifacts=[]
    for label in [0,1]:
        values=copy.deepcopy(rows)
        for row in values:
            if row["reliabilitySplit"]=="calibration": row["goalAgreement"]=label
        directory=tmp_path/f"joined-{label}"; directory.mkdir()
        data=b"\n".join(canonical_v1(row) for row in values)+b"\n"
        (directory/"dataset.jsonl").write_bytes(data)
        (directory/"manifest.json").write_bytes(canonical_v1({"version":"goalspec-controller-v5-teacher-join","datasetHash":hashlib.sha256(data).hexdigest(),"sourceDatasetHash":base["lineage"]["datasetHash"],"familyReliabilitySplits":declarations}))
        output=tmp_path/f"fit-{label}"
        fit_teacher_residual(base_path,directory,output,epochs=3)
        artifacts.append(json.loads((output/"controller.json").read_text(encoding="utf-8")))
    assert artifacts[0]["goalWeights"]==artifacts[1]["goalWeights"]
    assert artifacts[0]["neutralWeights"]==base["neutralWeights"]==artifacts[1]["neutralWeights"]
    assert artifacts[0]["calibration"]["reliability"]["bins"][0]["probability"] < artifacts[1]["calibration"]["reliability"]["bins"][0]["probability"]
