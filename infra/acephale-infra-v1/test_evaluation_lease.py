"""Evaluation reuses funded provider time without extending optimizer capacity."""
import ast
import copy
import hashlib
import inspect
import json
from unittest.mock import patch

import pytest
from test_budget_policy import amended, control  # noqa: F401
from test_training_window_capacity import (  # noqa: F401
    NOW,
    exhausted,
    record,
    third_window,
)


@pytest.fixture
def ready(exhausted, tmp_path):  # noqa: F811
    path, ledger, _ = exhausted
    record(path, ledger)
    lease, preflight, _, _ = third_window(path, ledger)
    observed = control.read_json(preflight)
    observed.update(profile="acephale-evaluation-preflight-v1", leaseId=lease["id"], instanceId=lease["instanceId"],
                    studyBindingHash=ledger["planHash"], machineIdSha256="d" * 64, providerReceiptSha256="e" * 64)
    preflight.write_text(json.dumps(observed))
    return path, lease, preflight, tmp_path / "evaluation.json"


def issue(ready, seconds=3600):
    path, lease, preflight, output = ready
    with patch.object(control.time, "time", return_value=NOW):
        return control.evaluation_lease(path, lease["id"], preflight, output, seconds, source_probe=lambda _: "b" * 40)


def test_exhausted_training_capacity_does_not_block_read_only_model_work(ready):
    from acephale.training import validate_execution_lease, validate_training_lease

    path, _, _, output = ready
    before = path.read_bytes()
    receipt = issue(ready)
    assert path.read_bytes() == before
    assert control.training_window_headroom(path, {"version": 1, "windows": []})["usedSeconds"] == {"fit": 43200, "smoke": 900}
    assert receipt["trainingWindowCreated"] is False and receipt["newFinancialReservation"] is False
    for action in ("diagnostic", "export", "evaluate"):
        assert validate_execution_lease(output, action=action, now=NOW + 1) == receipt
    for action in ("train", "smoke", "profile", "unknown"):
        with pytest.raises(ValueError, match="only"):
            validate_execution_lease(output, action=action, now=NOW + 1)
    with pytest.raises(ValueError):
        validate_training_lease(output, now=NOW + 1)
    legacy_ast = ast.parse(inspect.getsource(validate_training_lease)).body[0]
    assert hashlib.sha256(ast.dump(legacy_ast, include_attributes=False).encode()).hexdigest() == \
        "10a91fe8126f78880cb7bb1515158da98ed460e5947a3f9690c55f4fb4029a18"


def test_authorization_is_creation_only_and_keeps_existing_provider_deadline(ready):
    receipt = issue(ready)
    assert receipt["providerDeadline"] == ready[1]["deadline"]
    before = ready[3].read_bytes()
    with pytest.raises((ValueError, FileExistsError)):
        issue(ready)
    assert ready[3].read_bytes() == before


@pytest.mark.parametrize("field,value", [("actorStopped", False), ("gpuProcesses", 1),
    ("observedAt", NOW - 121), ("observedAt", NOW + 1), ("hardwareProfileHash", "f" * 64),
    ("leaseId", "another-lease"), ("instanceId", "another-host"), ("studyBindingHash", "f" * 64),
    ("profile", "acephale-training-preflight-v1")])
def test_actual_fresh_idle_host_observation_required(ready, field, value):
    path = ready[2]
    observation = control.read_json(path)
    observation[field] = value
    path.write_text(json.dumps(observation))
    with pytest.raises(ValueError):
        issue(ready)
    assert not ready[3].exists()


@pytest.mark.parametrize("seconds", [0, -1, True, float("inf"), 28801, 28501])
def test_deadline_and_cleanup_margin_cannot_be_extended(ready, seconds):
    with pytest.raises(ValueError):
        issue(ready, seconds)
    assert not ready[3].exists()


@pytest.mark.parametrize("field,value", [("version", True), ("optimizerAllowed", True),
    ("allowedActions", ["diagnostic", "export", "evaluate", "train"]), ("actorStopped", False),
    ("trainingWindowCreated", True), ("newFinancialReservation", True),
    ("deadline", NOW + 28800), ("executingSourceCommit", "not-a-commit"), ("preflightHash", "invalid")])
def test_resealed_unsafe_authorization_is_denied(ready, field, value):
    from acephale.training import validate_execution_lease

    receipt = copy.deepcopy(issue(ready))
    receipt[field] = value
    receipt["contentHash"] = control.digest({key: value for key, value in receipt.items() if key != "contentHash"})
    ready[3].write_text(json.dumps(receipt))
    with pytest.raises(ValueError):
        validate_execution_lease(ready[3], action="export", now=NOW + 1)


def test_expiry_and_unsealed_tamper_are_denied(ready):
    from acephale.training import validate_execution_lease

    receipt = issue(ready)
    with pytest.raises(ValueError, match="provider window"):
        validate_execution_lease(ready[3], action="evaluate", now=receipt["deadline"])
    receipt["instanceId"] = "different"
    ready[3].write_text(json.dumps(receipt))
    with pytest.raises(ValueError):
        validate_execution_lease(ready[3], action="evaluate", now=NOW + 1)


def test_legacy_training_authority_remains_accepted_for_export(ready):
    from acephale.training import validate_execution_lease

    fit_path = ready[0].with_name("fit.json")
    assert validate_execution_lease(fit_path, action="export", now=NOW + 1) == control.read_json(fit_path)


def test_preflight_checks_actual_machine_and_current_host_identity(ready, tmp_path, monkeypatch):
    machine = tmp_path / "machine-id"
    machine.write_text("synthetic-host-id\n")
    observed = control.read_json(ready[2])
    provider = {"profile": control.PROFILE, "provider": "lambda", "hardwareProfile": "a100-40gb-v1",
        "hardwareProfileHash": observed["hardwareProfileHash"], "leaseId": ready[1]["id"],
        "instance": {"id": ready[1]["instanceId"], "status": "active"},
        "studyBindingHash": observed["studyBindingHash"], "ssh": {"machineIdSha256": control.sha256(machine)}}
    provider["contentHash"] = control.digest(provider)
    path = tmp_path / "provider.json"
    control.write_new(path, provider)
    monkeypatch.setattr(control, "training_preflight", lambda hardware: observed)
    result = control.evaluation_preflight("a100-40gb-v1", path, machine_id_path=machine)
    assert result["instanceId"] == ready[1]["instanceId"] and result["providerReceiptSha256"] == control.sha256(path)
    machine.write_text("different-host")
    with pytest.raises(ValueError, match="machine identity"):
        control.evaluation_preflight("a100-40gb-v1", path, machine_id_path=machine)


def test_evaluation_readiness_uses_actual_inference_without_optimizer_claim(ready, tmp_path):
    path, lease, _, _ = ready
    receipt_path = tmp_path / "readiness.json"
    checks = {key: True for key in ("pinnedModels", "pinnedImages", "driver", "actorStopped", "cudaInference", "export", "watchdogRecovery")}
    receipt = {"profile": control.PROFILE, "purpose": "predictor_evaluation", "leaseId": lease["id"],
        "instanceId": lease["instanceId"], "passed": True, "hardwareProfileHash": lease["quote"]["hardwareProfileHash"], "checks": checks}
    control.write_new(receipt_path, receipt)
    with patch.object(control.time, "time", return_value=NOW):
        assert control.main(["mark-ready", "--ledger", str(path), "--lease-id", lease["id"], "--smoke-receipt", str(receipt_path)]) == 0
    observed = control.checked_bound_ledger(path)["leases"][-1]
    assert observed["ready"] is True and observed["smokeReceiptSha256"] == control.sha256(receipt_path)
    assert "cudaTraining" not in checks
    receipt["checks"]["cudaInference"] = False
    receipt_path.write_text(json.dumps(receipt))
    with patch.object(control.time, "time", return_value=NOW), pytest.raises(ValueError, match="Actual readiness"):
        control.main(["mark-ready", "--ledger", str(path), "--lease-id", lease["id"], "--smoke-receipt", str(receipt_path)])
