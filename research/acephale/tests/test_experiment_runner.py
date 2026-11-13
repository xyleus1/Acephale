from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import pytest

from acephale import experiment_runner as runner
from acephale.storage import file_hash
from acephale.training_data import hashed


def fixture(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    frozen = tmp_path / "input.json"
    frozen.write_text('{"fixture":true}')
    value = {"schemaVersion": 1, "kind": "acephale-experiment", "experimentId": "runner-test",
             "source": "source", "sourceCommit": "a" * 40,
             "inputs": {"data": {"path": "input.json", "sha256": file_hash(frozen)}},
             "stages": [{"id": "collect", "command": ["producer", "{input:data}", "{output}"],
                         "timeoutSeconds": 10, "artifacts": [{"path": "receipt.json", "kind": "hashed_json", "expected": {"status": "completed"}}]},
                        {"id": "score", "command": ["consumer", "{stage:collect}", "{output}"],
                         "timeoutSeconds": 10, "artifacts": [{"path": "receipt.json", "kind": "hashed_json", "expected": {"status": "completed"}}]}],
             "deadline": time.time() + 300, "maximumSeconds": 60}
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(value))
    monkeypatch.setattr(runner, "verify_source", lambda *_: None)
    return manifest, tmp_path / "run", value


def completed_stage(command, directory, _stage, _source, guard, _deadline, _stopped):
    guard()
    root = directory / "artifacts"
    root.mkdir()
    (root / "receipt.json").write_text(json.dumps(hashed({"status": "completed", "argv": command})))


def test_sequence_binds_dependencies_and_resume_verifies_without_redispatch(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)
    calls = []

    def execute(*args):
        calls.append(args[0])
        completed_stage(*args)

    monkeypatch.setattr(runner, "execute", execute)
    original = runner.run(manifest, output)
    assert original["status"] == "completed"
    assert len(calls) == 2
    assert calls[1][1] == str(output / "collect" / "artifacts")
    assert runner.run(manifest, output, resume=True) == original
    assert len(calls) == 2
    path = output / "collect" / "artifacts" / "receipt.json"
    path.write_text(json.dumps(hashed({"status": "completed", "tampered": True})))
    with pytest.raises(ValueError, match="verified successful"):
        runner.run(manifest, output, resume=True)
    assert len(calls) == 2


def test_failure_is_retained_and_blocks_later_stages_and_automatic_retry(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)
    calls = []

    def fail(*args):
        calls.append(args[0])
        raise TimeoutError("fixture deadline")

    monkeypatch.setattr(runner, "execute", fail)
    with pytest.raises(TimeoutError):
        runner.run(manifest, output)
    receipt = runner.read_json(output / "collect" / "receipt.json")
    assert receipt["status"] == "failed" and receipt["failureRetained"] is True
    assert not (output / "score").exists()
    with pytest.raises(ValueError, match="verified successful"):
        runner.run(manifest, output, resume=True)
    assert len(calls) == 1
    assert runner.read_json(output / "collect" / "receipt.json") == receipt


def test_completed_stage_survives_interruption_but_incomplete_stage_cannot_be_reused(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)

    def interrupted(*args):
        if args[2].id == "collect":
            completed_stage(*args)
        else:
            raise InterruptedError("cooperative stop")

    monkeypatch.setattr(runner, "execute", interrupted)
    with pytest.raises(InterruptedError):
        runner.run(manifest, output)
    assert runner.read_json(output / "collect" / "receipt.json")["status"] == "completed"
    assert runner.read_json(output / "score" / "receipt.json")["errorType"] == "InterruptedError"
    assert not (output / "completion.json").exists()


def test_input_change_fails_before_dispatch_and_during_execution(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)
    monkeypatch.setattr(runner, "execute", completed_stage)
    frozen = tmp_path / "input.json"
    previous = frozen.read_bytes()
    frozen.write_text("changed")
    with pytest.raises(ValueError, match="Frozen input changed"):
        runner.run(manifest, output)
    assert not output.exists()
    frozen.write_bytes(previous)

    def change(*args):
        frozen.write_text("changed while running")
        args[4]()

    monkeypatch.setattr(runner, "execute", change)
    with pytest.raises(ValueError, match="Frozen input changed"):
        runner.run(manifest, output)
    assert runner.read_json(output / "collect" / "receipt.json")["status"] == "failed"


def test_polling_checks_metadata_without_rehashing_contents(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)
    frozen = tmp_path / "input.json"
    hashes = []
    actual_hash = runner.file_hash

    def counted_hash(path):
        if path == frozen:
            hashes.append(path)
        return actual_hash(path)

    def polling(*args):
        count = len(hashes)
        for _ in range(100):
            args[4]()
        assert len(hashes) == count
        completed_stage(*args)

    monkeypatch.setattr(runner, "file_hash", counted_hash)
    monkeypatch.setattr(runner, "execute", polling)
    assert runner.run(manifest, output)["status"] == "completed"
    # Initial admission and both cryptographic boundaries of each stage.
    assert len(hashes) == 5


def test_post_stage_hash_rejects_changed_bytes_even_when_metadata_is_unchanged(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)
    frozen = tmp_path / "input.json"
    metadata = runner.input_metadata({"data": frozen})
    # Model a filesystem whose visible metadata has not reflected the write.
    # The final full hash must still reject same-length changes.
    monkeypatch.setattr(runner, "input_metadata", lambda _: metadata)

    def mutate(*args):
        completed_stage(*args)
        before = frozen.stat()
        original = frozen.read_text()
        frozen.write_text(original.replace("true", "null"))
        os.utime(frozen, ns=(before.st_atime_ns, before.st_mtime_ns))
        args[4]()

    monkeypatch.setattr(runner, "execute", mutate)
    with pytest.raises(ValueError, match="Frozen input changed: data"):
        runner.run(manifest, output)
    assert runner.read_json(output / "collect/receipt.json")["status"] == "failed"
    assert not (output / "score").exists()


def test_replaced_input_identity_is_detected_without_content_hashing(tmp_path):
    frozen = tmp_path / "input.json"
    frozen.write_text("original")
    before = frozen.stat()
    snapshot = runner.input_metadata({"data": frozen})
    replacement = tmp_path / "replacement.json"
    replacement.write_text("modified")
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    replacement.replace(frozen)
    assert runner.input_metadata({"data": frozen}) != snapshot
    frozen.unlink()
    with pytest.raises(ValueError, match="Frozen input changed: data"):
        runner.input_metadata({"data": frozen})


def test_input_mutation_during_initial_hash_cannot_establish_a_new_baseline(tmp_path, monkeypatch):
    manifest_path, output, _ = fixture(tmp_path, monkeypatch)
    frozen = tmp_path / "input.json"
    actual_hash = runner.file_hash

    def mutate_after_read(path):
        digest = actual_hash(path)
        if path == frozen:
            frozen.write_text("changed after read")
        return digest

    monkeypatch.setattr(runner, "file_hash", mutate_after_read)
    with pytest.raises(ValueError, match="during hash verification"):
        runner.run(manifest_path, output)
    assert not output.exists()


@pytest.mark.skipif(os.name not in {"posix", "nt"}, reason="Managed Linux/Windows process ownership")
def test_actual_input_change_drains_child_before_failure_receipt(tmp_path, monkeypatch):
    if os.name == "nt":
        import _winapi

    manifest, output, value = fixture(tmp_path, monkeypatch)
    value["stages"] = value["stages"][:1]
    value["stages"][0]["command"] = [sys.executable, "-c",
        "import os,pathlib,time; pathlib.Path('pid').write_text(str(os.getpid())); time.sleep(60)"]
    manifest.write_text(json.dumps(value))
    frozen = tmp_path / "input.json"
    pid_path = tmp_path / "source/pid"
    actual_metadata = runner.input_metadata
    pid = None
    handle = None

    def detect_then_mutate(inputs):
        nonlocal pid, handle
        if pid is None and pid_path.exists() and pid_path.read_text():
            pid = int(pid_path.read_text())
            if os.name == "nt":
                handle = _winapi.OpenProcess(0x100000, False, pid)
            frozen.write_text("changed while child runs")
        return actual_metadata(inputs)

    monkeypatch.setattr(runner, "input_metadata", detect_then_mutate)
    try:
        with pytest.raises(ValueError, match="Frozen input changed during execution"):
            runner.run(manifest, output)
        assert pid is not None
        if os.name == "nt":
            assert _winapi.WaitForSingleObject(handle, 5000) == 0
        else:
            with pytest.raises(ProcessLookupError):
                os.kill(pid, 0)
        assert runner.read_json(output / "collect/receipt.json")["status"] == "failed"
        assert not (output / "completion.json").exists()
    finally:
        if handle is not None:
            _winapi.CloseHandle(handle)


def test_future_stage_binding_cannot_dispatch(tmp_path, monkeypatch):
    manifest, output, value = fixture(tmp_path, monkeypatch)
    value["stages"][0]["command"] = ["consumer", "{stage:score}"]
    manifest.write_text(json.dumps(value))
    monkeypatch.setattr(runner, "execute", lambda *_: pytest.fail("Must not dispatch"))
    with pytest.raises(ValueError, match="incomplete command binding"):
        runner.run(manifest, output)


def test_result_checks_reject_failed_receipt_even_after_zero_exit(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)

    def false_success(*args):
        root = args[1] / "artifacts"
        root.mkdir()
        (root / "receipt.json").write_text(json.dumps(hashed({"status": "failed"})))

    monkeypatch.setattr(runner, "execute", false_success)
    with pytest.raises(ValueError, match="declared result"):
        runner.run(manifest, output)
    assert not (output / "score").exists()


def test_prior_artifact_change_by_later_stage_invalidates_run(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)

    def tamper(*args):
        completed_stage(*args)
        if args[2].id == "score":
            (output / "collect/artifacts/receipt.json").write_text(json.dumps(hashed({"status": "completed", "altered": True})))

    monkeypatch.setattr(runner, "execute", tamper)
    with pytest.raises(ValueError, match="changed during execution"):
        runner.run(manifest, output)
    assert runner.read_json(output / "score/receipt.json")["status"] == "failed"


def test_changed_dependency_is_rejected_before_next_command(tmp_path, monkeypatch):
    manifest, output, _ = fixture(tmp_path, monkeypatch)
    calls, source_checks = [], []

    def source_check(*_):
        source_checks.append(True)
        if len(source_checks) == 4:
            (output / "collect/artifacts/receipt.json").write_text(json.dumps(hashed({"status": "completed", "changed": True})))

    def execute(*args):
        calls.append(args[2].id)
        completed_stage(*args)

    monkeypatch.setattr(runner, "verify_source", source_check)
    monkeypatch.setattr(runner, "execute", execute)
    with pytest.raises(ValueError, match="before dispatch"):
        runner.run(manifest, output)
    assert calls == ["collect"]
    assert not (output / "score").exists()


def test_expired_manifest_cannot_dispatch_and_cannot_extend_on_resume(tmp_path, monkeypatch):
    manifest, output, value = fixture(tmp_path, monkeypatch)
    value["deadline"] = time.time() - 1
    manifest.write_text(json.dumps(value))
    monkeypatch.setattr(runner, "execute", lambda *_: pytest.fail("Must not dispatch"))
    with pytest.raises(TimeoutError, match="Original experiment"):
        runner.run(manifest, output)
    value["deadline"] = time.time() + 300
    manifest.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="Resume manifest differs"):
        runner.run(manifest, output, resume=True)


def test_manifest_checks_and_artifact_paths_are_explicit(tmp_path):
    with pytest.raises(ValueError, match="successful result fields"):
        runner.ArtifactCheck(path="receipt.json", kind="json")
    for name in ("../outside", str(tmp_path.resolve())):
        with pytest.raises(ValueError, match="inside its stage"):
            runner.child_path(tmp_path, name)


def test_pending_stop_never_launches_a_stage(tmp_path, monkeypatch):
    stage = runner.Stage(id="stop", command=[sys.executable], timeoutSeconds=10,
                         artifacts=[runner.ArtifactCheck(path="unused", kind="json", expected={"status": "completed"})])
    monkeypatch.setattr(runner.subprocess, "Popen", lambda *args, **kwargs: pytest.fail("Stopped stage must not launch"))
    with pytest.raises(InterruptedError, match="before dispatch"):
        runner.execute([sys.executable], tmp_path, stage, tmp_path, lambda: None, time.time() + 10, [15])


def test_actual_git_source_must_match_commit_and_be_clean(tmp_path):
    def git(*args):
        return subprocess.run(["git", "-C", str(tmp_path), *args], check=True, capture_output=True, text=True).stdout.strip()

    git("init", "--quiet")
    file = tmp_path / "source.py"
    file.write_text("original")
    git("add", "source.py")
    git("-c", "user.name=Runner Test", "-c", "user.email=runner@example.invalid", "commit", "--quiet", "-m", "fixture")
    commit = git("rev-parse", "HEAD")
    runner.verify_source(tmp_path, commit)
    with pytest.raises(ValueError, match="commit changed"):
        runner.verify_source(tmp_path, "0" * 40)
    file.write_text("changed")
    with pytest.raises(ValueError, match="clean committed"):
        runner.verify_source(tmp_path, commit)


@pytest.mark.skipif(os.name != "posix", reason="Linux process-group execution contract")
def test_actual_timeout_drains_process_group(tmp_path):
    stage = runner.Stage(id="timeout", command=[sys.executable], timeoutSeconds=1,
                         artifacts=[runner.ArtifactCheck(path="unused", kind="json", expected={"status": "completed"})])
    command = [sys.executable, "-c", "import pathlib,time,os; pathlib.Path('pid').write_text(str(os.getpid())); time.sleep(60)"]
    started = time.monotonic()
    with pytest.raises(TimeoutError):
        runner.execute(command, tmp_path, stage, tmp_path, lambda: None, time.time() + 0.5, [])
    assert time.monotonic() - started < 8
    pid = int((tmp_path / "pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


@pytest.mark.skipif(os.name != "posix", reason="Linux process-group execution contract")
def test_actual_signal_request_drains_before_return(tmp_path):
    stage = runner.Stage(id="stop", command=[sys.executable], timeoutSeconds=10,
                         artifacts=[runner.ArtifactCheck(path="unused", kind="json", expected={"status": "completed"})])
    stop = []

    def guard():
        if (tmp_path / "pid").exists():
            stop.append(15)

    command = [sys.executable, "-c", "import pathlib,time,os; pathlib.Path('pid').write_text(str(os.getpid())); time.sleep(60)"]
    with pytest.raises(InterruptedError):
        runner.execute(command, tmp_path, stage, tmp_path, guard, time.time() + 10, stop)
    with pytest.raises(ProcessLookupError):
        os.kill(int((tmp_path / "pid").read_text()), 0)
