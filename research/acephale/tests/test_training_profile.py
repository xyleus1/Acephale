from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from types import SimpleNamespace

import pytest

from acephale import training_profile as profile
from acephale.training_data import hashed, write_new


def test_profile_selects_longest_distinct_fit_rows_without_changing_order():
    rows = [{"id": f"row-{index:02}", "partition": "weight_fit"} for index in range(20)]
    tokens = [{"input_ids": list(range(index + 1))} for index in range(20)]
    selected = profile.longest_fitting_batch(rows, tokens)
    assert selected == list(range(19, 3, -1))
    assert [row["id"] for row in rows] == [f"row-{index:02}" for index in range(20)]
    rows[-1]["partition"] = "calibration"
    with pytest.raises(ValueError, match="fitting"):
        profile.longest_fitting_batch(rows, tokens)
    rows[-1]["partition"] = "weight_fit"
    rows[-1]["id"] = rows[0]["id"]
    with pytest.raises(ValueError, match="repeat"):
        profile.longest_fitting_batch(rows, tokens)
    with pytest.raises(ValueError, match="sixteen"):
        profile.longest_fitting_batch(rows[:15], tokens[:15])


def test_profile_cannot_consume_smoke_allowance(monkeypatch, tmp_path):
    monkeypatch.setattr(profile, "validate_training_lease", lambda path: {"version": 2, "trainingKind": "smoke"})
    with pytest.raises(ValueError, match="never the smoke"):
        profile._fit_lease(tmp_path / "lease")


@pytest.fixture
def plan(monkeypatch, tmp_path):
    monkeypatch.setattr(profile, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(profile, "verify_dataset", lambda path: {"contentHash": "dataset"})
    monkeypatch.setattr(profile, "_fit_lease", lambda path: {"version": 2, "trainingKind": "fit", "deadline": time.time() + 1000})
    # Keep the lease identity stable across checks.
    lease = profile._fit_lease(tmp_path)
    monkeypatch.setattr(profile, "_fit_lease", lambda path: lease)
    return tmp_path / "dataset", tmp_path / "model", tmp_path / "profile", tmp_path / "lease"


def successful_attempt(command, log, deadline):
    from pathlib import Path

    micro = int(command[command.index("--micro-batch") + 1])
    output = Path(command[command.index("--output") + 1])
    output.mkdir()
    write_new(output / "measurement.json", hashed({"status": "completed", "microBatch": micro, "datasetManifestHash": "dataset"}))
    return 0


def test_profile_freezes_first_successful_largest_batch(monkeypatch, plan):
    attempts = []

    def run(command, log, deadline):
        attempts.append(command)
        return successful_attempt(command, log, deadline)

    monkeypatch.setattr(profile, "_run_attempt", run)
    result = profile.profile(*plan)
    assert result["microBatch"] == 4 and result["gradientAccumulation"] == 4
    assert len(attempts) == 1 and result["requiresFreshMainSeeds"] == [17, 29]
    assert result["weightsExported"] is False


def test_only_an_explicit_cuda_oom_can_select_a_smaller_batch(monkeypatch, plan):
    from pathlib import Path

    attempts = []

    def run(command, log, deadline):
        micro = int(command[command.index("--micro-batch") + 1])
        attempts.append(micro)
        if micro == 4:
            output = Path(command[command.index("--output") + 1])
            output.mkdir()
            write_new(output / "failure.json", {"kind": "cuda_out_of_memory"})
            return 2
        return successful_attempt(command, log, deadline)

    monkeypatch.setattr(profile, "_run_attempt", run)
    assert profile.profile(*plan)["microBatch"] == 2
    assert attempts == [4, 2]


@pytest.mark.parametrize("code", [1, 2])
def test_other_errors_and_unproven_oom_do_not_fallback(monkeypatch, plan, code):
    attempts = []
    monkeypatch.setattr(profile, "_run_attempt", lambda *args: attempts.append(args) or code)
    with pytest.raises(RuntimeError, match="may not be replaced"):
        profile.profile(*plan)
    assert len(attempts) == 1
    assert not (plan[2] / "selection.json").exists()


def test_foreign_dataset_measurement_is_rejected(monkeypatch, plan):
    def run(command, log, deadline):
        successful_attempt(command, log, deadline)
        path = plan[2] / "micro-4/measurement.json"
        path.write_text(json.dumps(hashed({"status": "completed", "microBatch": 4, "datasetManifestHash": "other"})))
        return 0

    monkeypatch.setattr(profile, "_run_attempt", run)
    with pytest.raises(ValueError, match="differs"):
        profile.profile(*plan)


@pytest.mark.skipif(os.name != "posix", reason="Linux GPU owner uses process groups")
def test_profile_attempt_timeout_is_bounded(tmp_path):
    started = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        profile._run_attempt([sys.executable, "-c", "import time; time.sleep(30)"], tmp_path / "attempt.log", time.time() + 0.1)
    assert time.monotonic() - started < 5


@pytest.mark.skipif(os.name != "posix", reason="Linux GPU owner uses process groups")
def test_profile_sigterm_drains_child_and_grandchild(tmp_path):
    import signal
    from pathlib import Path

    pid_file = tmp_path / "pids.json"
    child = ("import json,os,subprocess,sys,time; "
             "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
             f"open({str(pid_file)!r},'w').write(json.dumps([os.getpid(),p.pid])); time.sleep(30)")
    owner = ("from pathlib import Path; import sys,time; "
             "from acephale.training_profile import _run_attempt; "
             f"_run_attempt([sys.executable,'-c',{child!r}],Path({str(tmp_path / 'owned.log')!r}),time.time()+20)")
    process = subprocess.Popen([sys.executable, "-c", owner], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True, text=True)
    owned = []

    def alive(pid):
        try:
            return Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1].split()[0] not in {"Z", "X"}
        except FileNotFoundError:
            return False

    try:
        deadline = time.monotonic() + 8
        while not pid_file.exists() and time.monotonic() < deadline:
            assert process.poll() is None
            time.sleep(0.02)
        assert pid_file.exists()
        owned = json.loads(pid_file.read_text())
        assert all(alive(pid) for pid in owned)
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=5)
        assert process.returncode != 0 and "Profile attempt cancelled" in stderr
        deadline = time.monotonic() + 3
        while any(alive(pid) for pid in owned) and time.monotonic() < deadline:
            time.sleep(0.02)
        assert not any(alive(pid) for pid in owned)
    finally:
        for group in ([owned[0]] if owned else []) + [process.pid]:
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=5)
