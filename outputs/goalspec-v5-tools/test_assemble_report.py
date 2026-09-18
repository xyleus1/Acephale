import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location("assemble_report", Path(__file__).with_name("assemble_report.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def unavailable():
    return {"version": MODULE.VERSION, "allDeclaredCohortsClosed": True,
        "inputs": {role: {"available": False, "reason": "Synthetic fixture explicitly lacks this report"} for role in MODULE.ROLES}}


def test_missing_values_and_negative_differences_are_not_hidden():
    assert MODULE.fmt(None) == "unavailable"
    assert MODULE.interval({"estimate": -.1, "lower": -.2, "upper": -.05}, "pp") == "-10.0 pp [-20.0 pp, -5.0 pp]"
    assert MODULE.interval({"estimate": .5, "lower": None, "upper": None}, "percent") == "50.0% [CI unavailable]"
    assert MODULE.pointer({"metric": None}, "/metric") is None
    assert "unavailable" in "\n".join(MODULE.bound_metrics({}, [{"label": "Missing", "pointer": "/not-present", "format": "count"}]))


def test_hash_bound_closed_inputs_and_no_overwrite(tmp_path):
    config = unavailable()
    budget = {"currency": "USD", "totalCeilingUsd": 500, "totalKnownUsageCostUsd": 3.0,
        "totalSpentOrReservedUsd": 6.0, "unresolvedRequests": 1, "awsChargesUsd": 0, "allocations": []}
    path = tmp_path / "budget.json"
    path.write_text(json.dumps(budget))
    config["inputs"]["budget"] = {"path": "budget.json", "sha256": MODULE.sha(path), "closed": True}
    plan = tmp_path / "inputs.json"
    plan.write_text(json.dumps(config))
    manifest = MODULE.assemble(plan, tmp_path / "report")
    assert len(manifest["sources"]) == 1 and len(manifest["unavailable"]) == 9
    text = (tmp_path / "report/README.md").read_text()
    assert "unresolved requests: 1" in text and "$3.000000" in text and "$6.000000" in text
    assert "none is an invoice" in text
    with pytest.raises(ValueError, match="new directory"):
        MODULE.assemble(plan, tmp_path / "report")
    path.write_text("{}")
    with pytest.raises(ValueError, match="hash mismatch"):
        MODULE.assemble(plan, tmp_path / "changed")


def test_pending_cohort_and_missing_role_fail_closed(tmp_path):
    config = unavailable()
    config["allDeclaredCohortsClosed"] = False
    with pytest.raises(ValueError, match="closure"):
        MODULE.load_inputs(config, tmp_path)
    config["allDeclaredCohortsClosed"] = True
    del config["inputs"]["confirmation"]
    with pytest.raises(ValueError, match="Every named report role"):
        MODULE.load_inputs(config, tmp_path)


def test_partial_physical_work_stays_a_known_subtotal():
    item = {"trials": 2, "successes": 1, "metrics": {"pass1": {"estimate": .5, "lower": 0, "upper": 1},
        "pass2": {"estimate": None}, "liveTotalMeanSeconds": {"estimate": 3, "lower": 2, "upper": 4},
        "physicalCallsPerSuccess": {"estimate": None}},
        "counts": {"physicalCalls": {"knownSum": 7, "missingTrials": 1}},
        "timingSeconds": {"totalTrialSeconds": {"p95": 3, "n": 1, "missing": 1}},
        "timingQuality": {"explicitlyInvalidTimingTrials": 1, "healthUnrecordedTrials": 0},
        "cost": {"knownUsageSubtotalUsd": .5, "unknownChargeTrials": 1}}
    text = "\n".join(MODULE.native_section({"label": "Synthetic fixture", "studyStage": "confirmation", "arms": {"goalspec": item}}))
    assert "7 known subtotal; 1 trials unmeasured" in text
    assert "unavailable" in text and "1 missing/uncertain trial costs" in text
    assert "n=1; missing=1; host-invalid=1; health-unrecorded=0" in text
    assert "interrupted trials still count as task failures" in text


def test_derya_supplement_keeps_separate_work_counts_and_paired_latency():
    report = {"integrityPassed": True, "globalFailure": None, "arms": [{"arm": "goal54", "trials": 12, "successes": 12,
        "meanTotalTrialSeconds": 3.5, "metrics": {"meanLiveSeconds": {"estimate": 3.5, "lower": 3.0, "upper": 4.0}},
        "liveSeconds": {"p95": 4.2, "n": 12}, "counts": {"physicalToolReads": {"knownSum": 12, "missingTrials": 0},
        "physicalSqlStatements": {"knownSum": 102, "missingTrials": 0}},
        "provider": {"actor": {"physicalAttempts": 24}, "goal": {"physicalAttempts": 12}},
        "cost": {"knownResponseUsageUsd": .08}}], "paired": {"goal54-minus-base": {"families": 12,
        "latencySeconds": {"estimate": .3, "lower": .02, "upper": .6}}}}
    text = "\n".join(MODULE.derya_live_section(report))
    assert "4.200 (n=12)" in text and "| 12 | 102 | 36 | $0.080000 |" in text
    assert "0.300 [0.020, 0.600]" in text and "shared-tool/database correlation" in text
