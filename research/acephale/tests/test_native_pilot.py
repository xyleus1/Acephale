import json
from collections import Counter
from copy import deepcopy

import pytest

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import publish_bundle, verify_bundle
from acephale.native_pilot import prepare_native_pilot, select_native_fit_pilot


def public_fixture():
    rows, fit = [], []
    for domain in ("retail", "airline"):
        for family in range(12):
            name = f"{domain}-{family}"
            fit.append(name)
            for checkpoint in range(6):
                value = {"policy": "Read only", "sources": [{"id": "requirement:0", "value": f"Read {family}-{checkpoint}"}], "events": [], "tools": []}
                rows.append({"checkpoint_id": f"{name}:{checkpoint}", "family_id": name, "domain": domain, "split": "train",
                             "input_hash": hash_v1(value), "request_revision": "r1", "input": value})
    return rows, {"weightFitFamilies": fit, "calibrationFamilies": ["cal"], "developmentFamilies": ["dev"], "testFamilies": ["test"]}


def test_native_pilot_is_fit_only_balanced_and_independent_of_input_order_and_future_labels():
    rows, partitions = public_fixture()
    rows.append({**deepcopy(rows[0]), "checkpoint_id": "cal", "family_id": "cal"})
    first = select_native_fit_pilot(rows, partitions)
    changed = deepcopy(list(reversed(rows)))
    for row in changed:
        row["future_actions"] = "POISON_NOT_PUBLIC_INPUT"
        row["reward"] = 0
    assert select_native_fit_pilot(changed, partitions) == first
    by_id = {row["checkpoint_id"]: row for row in rows}
    selected = [by_id[row["checkpoint_id"]] for row in first["checkpoints"]]
    assert len(selected) == 100
    assert min(Counter(row["family_id"] for row in selected).values()) == 4
    assert Counter(row["domain"] for row in selected) == {"retail": 50, "airline": 50}
    audits = [by_id[row["checkpoint_id"]] for row in first["audit"]]
    assert len({row["family_id"] for row in audits}) == 20
    assert Counter(row["domain"] for row in audits) == {"retail": 10, "airline": 10}
    assert "cal" not in {row["family_id"] for row in selected}
    assert "POISON" not in str(first)


def test_native_pilot_can_use_frozen_public_candidate_eligibility_without_looking_at_labels():
    rows, partitions = public_fixture()
    eligible = [row["checkpoint_id"] for row in rows if not row["checkpoint_id"].endswith(":5")]
    selected = select_native_fit_pilot(rows, partitions, eligible_checkpoint_ids=eligible)
    assert len(selected["checkpoints"]) == 100
    assert all(row["checkpoint_id"] in eligible for row in selected["checkpoints"])
    with pytest.raises(ValueError, match="100 eligible"):
        select_native_fit_pilot(rows, partitions, eligible_checkpoint_ids=eligible[:99])
    with pytest.raises(ValueError, match="unique current"):
        select_native_fit_pilot(rows, partitions, eligible_checkpoint_ids=[*eligible, "absent"])


def test_published_pilot_binds_eligibility_windows_and_rejects_changed_declarations(tmp_path):
    rows, partitions = public_fixture()
    dataset = tmp_path / "dataset"
    source = publish_bundle(dataset, {"public.jsonl": rows, "split.json": {"families": {family: "train" for family in partitions["weightFitFamilies"]}}})
    partitions_path = tmp_path / "partitions.json"
    partitions_path.write_text(json.dumps(partitions), encoding="utf-8")
    windows = [{"checkpointId": row["checkpoint_id"], "familyId": row["family_id"], "inputHash": row["input_hash"],
                "candidateIds": [] if row["checkpoint_id"].endswith(":5") else ["current-read"],
                "candidatePoolHash": "a" * 64, "candidateWindowHash": "b" * 64} for row in rows]
    body = {"schemaVersion": 1, "kind": "acephale-public-window-eligibility", "sourceDatasetHash": source["bundle_hash"],
            "partitionsHash": hash_v1(partitions), "compilerHash": "c" * 64, "generationCalls": 0, "futureLabelsUsed": False,
            "rows": windows, "rejected": [], "checkpointIds": [row["checkpointId"] for row in windows if row["candidateIds"]]}
    eligibility = tmp_path / "eligibility.json"
    eligibility.write_text(json.dumps({**body, "contentHash": hash_v1(body)}), encoding="utf-8")
    prepare_native_pilot(dataset, partitions_path, tmp_path / "pilot", eligibility_path=eligibility)
    verify_bundle(tmp_path / "pilot")
    pilot = json.loads((tmp_path / "pilot" / "pilot.json").read_text(encoding="utf-8"))
    assert pilot["public_eligibility_hash"] == hash_v1(body)
    assert all(not row["checkpoint_id"].endswith(":5") for row in pilot["checkpoints"])
    body["futureLabelsUsed"] = True
    eligibility.write_text(json.dumps({**body, "contentHash": hash_v1(body)}), encoding="utf-8")
    with pytest.raises(ValueError, match="public-only"):
        prepare_native_pilot(dataset, partitions_path, tmp_path / "changed", eligibility_path=eligibility)


@pytest.mark.parametrize("defect", ["too_few_family_prefixes", "wrong_split", "changed_input", "duplicate", "private"])
def test_native_pilot_rejects_insufficient_or_contaminated_public_data(defect):
    rows, partitions = public_fixture()
    if defect == "too_few_family_prefixes":
        rows = [row for row in rows if not row["checkpoint_id"].startswith("retail-0:") or row["checkpoint_id"].endswith((":0", ":1", ":2"))]
    elif defect == "wrong_split":
        rows[0]["split"] = "test"
    elif defect == "changed_input":
        rows[0]["input"]["policy"] = "Changed"
    elif defect == "duplicate":
        rows.append(rows[0])
    else:
        rows[0]["input"]["private_state"] = "Hidden"
        rows[0]["input_hash"] = hash_v1(rows[0]["input"])
    with pytest.raises(ValueError):
        select_native_fit_pilot(rows, partitions)
