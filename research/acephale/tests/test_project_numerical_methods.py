"""Synthetic extraction fixtures; these are not model or benchmark observations."""
import importlib.util
import json
import math
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/project_numerical_methods.py"
SPEC = importlib.util.spec_from_file_location("project_numerical_methods", SCRIPT)
methods = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(methods)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def checked(value, condition):
    if not condition:
        raise ValueError("Invalid fixture scalar")
    return value


def diagnostic(variant):
    return {
        "kind": "acephale-fixed-serving-parity-diagnostic-v1", "variant": variant,
        "fixedRequestCount": 3, "selectedProofIndex": 0, "originalGate": methods.GATE,
        "deterministicExecutionProven": False, "benchmarkAccuracyMeasured": False,
        "allPassed": True, "privatePrompt": "PRIVATE_SENTINEL",
        "rows": [{"index": i, "cacheIntent": intent, "passed": True, "gateFailure": None,
                  "observedConditionalOneProbability": 0.4, "conditionalProbabilityDifference": 0.002,
                  "responseHash": "f" * 64,
                  "receipt": {"passed": True, "gate": methods.GATE, "responseHash": "f" * 64,
                              "observedConditionalOneProbability": 0.4, "conditionalProbabilityDifference": 0.002},
                  "cachedTokens": None, "cacheTokenCountObserved": False,
                  "response": "PRIVATE_SENTINEL", "cacheSalt": "PRIVATE_SENTINEL"}
                 for i, intent in enumerate(("cold_requested", "warm_requested", "cold_requested"))],
    }


@pytest.fixture
def study(tmp_path):
    root, publication = tmp_path / "run", tmp_path / "publication"
    identity = {"leaseId": "PRIVATE_SENTINEL", "instanceId": "PRIVATE_SENTINEL"}
    report_path = write(root / "report.json", {"contentHash": "a" * 64})
    write(root / "successor-sequence/execution-result.json", identity)
    files = []
    for name in ("aggregate-results.json", "methods-and-limitations.md"):
        path = write(publication / name, {"alreadyProjected": True})
        files.append({"path": name, "sha256": methods.sha(path)})
    write(publication / "publication-manifest.json", {
        "sourceReportSha256": methods.sha(report_path), "sourceReportContentHash": "a" * 64,
        "allowlistSha256": "b" * 64, "projectorSha256": "c" * 64, "files": files,
    })
    bindings, checked_companions = {}, []
    for occurrence in methods.OCCURRENCES:
        base = root / "downstream" / occurrence
        labels = ["qualified", "replay", "calibration"] if occurrence.endswith("01") else ["qualified"]
        # The fixture names the protocol independently of the extractor's table.
        native = {"seed17-01": ["opportunity"], "seed29-01": ["opportunity", "development"],
                  "seed17-02": ["development", "heldout"], "seed29-02": ["heldout"]}
        labels.extend(f"{stage}-{occurrence}-{suffix}" for stage in native[occurrence]
                      for suffix in ("inputs", "outputs"))
        companions = []
        for label in labels:
            path = write(base / "numerical-policy" / (label + ".json"), {
                "contentHash": "d" * 64, "files": {}, "private": "PRIVATE_SENTINEL",
                "frozenScientificOutputsModified": False,
                "diagnosticResponsesUsedAsReplayOrCalibration": False,
            })
            companions.append({"path": str(path), "sha256": methods.sha(path)})
        phase = occurrence.replace("-", "_")
        phase_path = write(root / "downstream/phase-receipts" / (phase + ".json"), {
            "kind": "acephale-evaluation-successor-phase-v1", "phase": phase,
            "completed": True, "optimizerRerun": False, **identity, "evidence": companions,
        })
        write(root / "successor-sequence" / (phase + ".closed.json"), {
            "phase": phase, "receiptPath": str(phase_path), "receiptSha256": methods.sha(phase_path), **identity,
        })
        serving = root / f"serving-{occurrence}-stage/verified/serving"
        reports = {name: write(serving / (name + ".json"), diagnostic(variant))
                   for name, variant in (("baseline", "baseline"), ("configured", "split_k1"))}
        receipt = write(serving / "receipt.json", {
            **{name + "ReportPath": str(path) for name, path in reports.items()},
            **{name + "ReportSha256": methods.sha(path) for name, path in reports.items()},
        })
        write(serving / "serving-completed.json", {"diagnosticReceiptPath": str(receipt)})
        bindings[occurrence] = {
            **identity, "files": {},
            **dict.fromkeys(("numericalPolicyHash", "effectiveComposeSha256", "tunedConfigSha256",
                             "numericalAttestationSha256", "diagnosticReceiptSha256", "baseSourceComposeSha256"), "e" * 64),
        }

    def check_companion(_root, occurrence, path):
        checked_companions.append((occurrence, path.stem))
        return read(path)

    reader = SimpleNamespace(
        RUN_ROOT=root, POLICY_SHA="b" * 64, read=read,
        policy=lambda: {"reportRelativePath": "report.json"}, scientific_hash=lambda: None,
        verify_closed_run=lambda *_: (read(report_path), {report_path: methods.sha(report_path)}),
        boolean=lambda v: checked(v, type(v) is bool),
        count=lambda v: checked(v, type(v) is int and v >= 0),
        rate=lambda v: checked(v, type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1),
        hexadecimal=lambda n: lambda v: checked(v, type(v) is str and re.fullmatch(f"[a-f0-9]{{{n}}}", v)),
    )
    numerical = SimpleNamespace(load=lambda _root, occurrence: bindings[occurrence],
                                check_companion=check_companion, archived=lambda _root, _occ, path: Path(path))
    return reader, numerical, publication, {"aggregateProjectorSha256": "c" * 64}, checked_companions


def test_projects_observations_without_private_subtrees_or_scores(study):
    reader, numerical, publication, hashes, calls = study
    result = methods.project(reader, numerical, publication, hashes)
    assert len(result["occurrences"]) == 4
    assert len(calls) == 20
    assert "PRIVATE_SENTINEL" not in json.dumps(result)
    assert str(reader.RUN_ROOT) not in json.dumps(result)
    assert result["scoresRecomputed"] is result["modelCallsPerformed"] is False
    row = result["occurrences"][0]["diagnostics"][0]["rows"][0]
    assert row["cachedTokens"] is None and row["cacheTokenCountObserved"] is False
    assert row["conditionalProbabilityDifference"] == 0.002


def test_requires_existing_closed_run_gate_before_numerical_reads(study):
    reader, numerical, publication, hashes, calls = study

    def incomplete(*_):
        raise ValueError("Actual completed finalization required")

    reader.verify_closed_run = incomplete
    with pytest.raises(ValueError, match="completed finalization"):
        methods.project(reader, numerical, publication, hashes)
    assert calls == []


@pytest.mark.parametrize("fault", ["report", "published_file", "checkpoint", "evidence", "other_study"])
def test_rejects_detached_publication_or_occurrence(study, fault):
    reader, numerical, publication, hashes, _ = study
    root = reader.RUN_ROOT
    if fault in ("report", "published_file"):
        path = publication / ("publication-manifest.json" if fault == "report" else "aggregate-results.json")
        value = read(path)
        value["sourceReportSha256"] = "f" * 64
    elif fault == "checkpoint":
        path = root / "successor-sequence/seed17_01.closed.json"
        value = read(path)
        value["receiptSha256"] = "f" * 64
    else:
        path = root / "downstream/phase-receipts/seed17_01.json"
        value = read(path)
        if fault == "evidence":
            value["evidence"] = []
        else:
            value["instanceId"] = "ANOTHER_STUDY"
        write(path, value)
        checkpoint = root / "successor-sequence/seed17_01.closed.json"
        updated = read(checkpoint)
        updated["receiptSha256"] = methods.sha(path)
        write(checkpoint, updated)
    write(path, value)
    with pytest.raises(ValueError):
        methods.project(reader, numerical, publication, hashes)


@pytest.mark.parametrize("fault", ["proof_index", "threshold", "configured_failure", "false_cache_zero",
                                  "nonfinite", "pass_delta", "receipt_delta"])
def test_rejects_changed_protocol_and_unobserved_cache_zero(study, fault):
    reader = study[0]
    value = diagnostic("split_k1")
    if fault == "proof_index":
        value["selectedProofIndex"] = 1
    elif fault == "threshold":
        value["originalGate"] = {**methods.GATE, "maximumConditionalProbabilityDifference": 0.02}
    elif fault == "configured_failure":
        value["rows"][0].update(passed=False, gateFailure="Cross-engine binary probability gate failed",
                                conditionalProbabilityDifference=0.02, receipt=None)
        value["allPassed"] = False
    elif fault == "false_cache_zero":
        value["rows"][0]["cachedTokens"] = 0
    elif fault == "nonfinite":
        value["rows"][0]["conditionalProbabilityDifference"] = float("nan")
    elif fault == "pass_delta":
        value["rows"][0]["conditionalProbabilityDifference"] = 0.02
    else:
        value["rows"][0]["receipt"]["conditionalProbabilityDifference"] = 0.003
    with pytest.raises(ValueError):
        methods.diagnostic_projection(reader, value, "split_k1")


def test_preserves_baseline_numerical_failure_and_observed_zero(study):
    value = diagnostic("baseline")
    value["rows"][0].update(passed=False, gateFailure="Cross-engine binary probability gate failed",
                            conditionalProbabilityDifference=0.02, receipt=None,
                            cachedTokens=0, cacheTokenCountObserved=True)
    value["allPassed"] = False
    result = methods.diagnostic_projection(study[0], value, "baseline")
    assert result["allPassed"] is False
    assert result["rows"][0]["cachedTokens"] == 0


@pytest.mark.parametrize("suffix", ["inputs", "outputs"])
def test_requires_every_declared_native_companion(study, suffix):
    reader, numerical, publication, hashes, _ = study
    root = reader.RUN_ROOT
    missing = root / "downstream/seed17-02/numerical-policy" / f"heldout-seed17-02-{suffix}.json"
    missing.unlink()
    phase_path = root / "downstream/phase-receipts/seed17_02.json"
    phase = read(phase_path)
    phase["evidence"] = [row for row in phase["evidence"] if row["path"] != str(missing)]
    write(phase_path, phase)
    checkpoint_path = root / "successor-sequence/seed17_02.closed.json"
    checkpoint = read(checkpoint_path)
    checkpoint["receiptSha256"] = methods.sha(phase_path)
    write(checkpoint_path, checkpoint)
    with pytest.raises(ValueError, match="Every declared numerical companion"):
        methods.project(reader, numerical, publication, hashes)


def test_source_hash_checked_before_reader_import(tmp_path):
    path = tmp_path / "reader.py"
    path.write_text("raise AssertionError('must not import')", encoding="utf-8")
    with pytest.raises(ValueError, match="source changed"):
        methods.load_reviewed("untrusted_test_reader", path, "0" * 64)
