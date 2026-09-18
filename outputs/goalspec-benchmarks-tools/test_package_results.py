"""Tiny path/grid tests; no live artifacts, scans, providers or packing."""
import copy
import hashlib
import json
import zipfile

import pytest

import package_results as bundle


@pytest.mark.parametrize("path", ["../secret.json", "/abs/file.json", "C:/file.json", "a\\b.json",
    "a/.env", "a/.env.local", "a/credentials.json", "node_modules/a.json", "a/.benchmarks/task.json"])
def test_excluded_paths(path):
    with pytest.raises(ValueError):
        bundle.safe_name(path)


def rows():
    return [{"runId": f"official-v4-{domain}-{task}-{trial}-{arm}", "domain": domain, "taskId": str(task),
             "arm": arm, "trial": trial, "seed": 100 + trial, "success": False}
            for domain in ("retail", "airline") for task in range(7) for trial in (0, 1) for arm in sorted(bundle.ARMS)]


def test_full_grid_preserves_failures():
    bundle.validate_rows(rows())


@pytest.mark.parametrize("change", ["missing", "duplicate", "swapped_seed", "missing_trial"])
def test_invalid_native_grid(change):
    changed = copy.deepcopy(rows())
    if change == "missing":
        changed.pop()
    elif change == "duplicate":
        changed[-1]["runId"] = changed[0]["runId"]
    elif change == "swapped_seed":
        changed[0]["seed"] += 1
    else:
        changed[0]["trial"] = 1
    with pytest.raises(ValueError):
        bundle.validate_rows(changed)


def test_no_name_normalization():
    assert str(bundle.safe_name("research/goalspec/runs/result/report.json")) == "research/goalspec/runs/result/report.json"


def fixture_plan(tmp_path):
    native = tmp_path / "research/goalspec/runs/native"
    native.mkdir(parents=True)
    analysis = tmp_path / "research/goalspec/runs/analysis"
    analysis.mkdir()
    plan_dir = tmp_path / "research/goalspec/runs/plan"
    plan_dir.mkdir()
    (tmp_path / "outputs").mkdir()
    source = plan_dir / "source.zip"
    with zipfile.ZipFile(source, "x") as archive:
        archive.writestr("src/runtime.ts", "export const version = 4;\n")
    members = rows()
    for name in bundle.NATIVE_METADATA:
        value = {"sourceArchiveSha256": bundle.sha256(source), "sources": {"src/runtime.ts": {"sha256": hashlib.sha256(b"export const version = 4;\n").hexdigest(), "bytes": len(b"export const version = 4;\n")}}} if name == "dispatch-plan.json" else {}
        (native / name).write_text(json.dumps(value), encoding="utf-8")
    (native / "outcomes.jsonl").write_bytes(b"".join(json.dumps(row).encode() + b"\r\n" for row in members))
    for row in members:
        (native / f"{row['runId']}.json").write_text(json.dumps({"record": row}), encoding="utf-8")
    events = tmp_path / "research/goalspec/runs/events.jsonl"
    events.write_text('{"closed":true}\n', encoding="utf-8")
    report = analysis / "report.json"
    report.write_text(json.dumps({"version": "official-tau-v4-report-v1", "trials": members}), encoding="utf-8")
    sources = {str(path.resolve()): bundle.sha256(path) for path in native.iterdir()}
    sources[str(events.resolve())] = bundle.sha256(events)
    (analysis / "manifest.json").write_text(json.dumps({"outputs": {"report.json": bundle.sha256(report)}, "sources": sources}), encoding="utf-8")
    plan = {"version": bundle.PLAN_VERSION, "files": [{"role": "analysis", "path": (analysis / name).relative_to(tmp_path).as_posix()} for name in ("report.json", "manifest.json")],
        "tauAnalysis": analysis.relative_to(tmp_path).as_posix(),
        "native": {"directory": native.relative_to(tmp_path).as_posix(), "events": [events.relative_to(tmp_path).as_posix()], "sourceArchive": source.relative_to(tmp_path).as_posix(), "expectedTrials": 112},
        "externalInputs": [{"name": "synthetic", "pin": "a" * 40, "reason": "Test dependency"}]}
    plan_path = tmp_path / "outputs/plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    return plan, plan_path, native


def test_synthetic_bundle_roundtrip(tmp_path):
    _, plan_path, _ = fixture_plan(tmp_path)
    output = tmp_path / "outputs/results.zip"
    receipt = bundle.generate(tmp_path, plan_path, output)
    assert receipt["everyMemberRoundtripVerified"] and receipt["sourceBytesUnchanged"]
    with zipfile.ZipFile(output) as archive:
        manifest = json.loads(archive.read("BUNDLE-MANIFEST.json"))
        assert manifest["nativeOutcomes"] == 112
        assert sum(item["role"] == "native-trace" for item in manifest["files"].values()) == 112


def test_changed_native_trace_is_rejected(tmp_path):
    plan, path, native = fixture_plan(tmp_path)
    (native / f"{rows()[0]['runId']}.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="Frozen hash mismatch"):
        bundle.collect(tmp_path, plan, path)


def test_embedded_pinned_source_is_not_general_checkout_permission():
    path = "research/goalspec/.benchmarks/tau3/LICENSE"
    with pytest.raises(ValueError):
        bundle.safe_name(path)
    assert str(bundle.safe_name(path, pinned_native_source=True)) == path
    with pytest.raises(ValueError):
        bundle.safe_name("research/goalspec/.benchmarks/tau3/.env", pinned_native_source=True)


def test_lossless_parquet_preserves_original_jsonl_bytes(tmp_path):
    pytest.importorskip("pyarrow")
    _, _, native = fixture_plan(tmp_path)
    output = tmp_path / "export"
    bundle.export_outcomes(native / "outcomes.jsonl", output, rows())
    assert (output / "outcomes.jsonl").read_bytes() == (native / "outcomes.jsonl").read_bytes()
    assert bundle.read(output / "manifest.json")["parquetReconstructedBytesIdentical"]
