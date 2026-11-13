from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from acephale import experiment_runner as runner
from acephale import windows_process as windows

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Actual Windows Job Object ownership contract")


def await_file(path: Path):
    deadline = time.monotonic() + 10
    while not path.exists():
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Fixture did not create {path.name}")
        time.sleep(0.025)
    return path.read_text()


def held_processes(ids):
    import _winapi

    return [_winapi.OpenProcess(0x100000, False, pid) for pid in ids]


def assert_drained(handles):
    import _winapi

    try:
        assert all(_winapi.WaitForSingleObject(handle, 5000) == 0 for handle in handles)
    finally:
        for handle in handles:
            _winapi.CloseHandle(handle)


def tree_command(root: Path, *, parent_exits=False):
    # Each child starts another generation. Only the oldest process is assigned
    # explicitly; job membership must cover its child and grandchild by inheritance.
    path = root / "tree.py"
    path.write_text(
        "import json,os,pathlib,subprocess,sys,time\n"
        "root=pathlib.Path(__file__).parent\n"
        "level=int(sys.argv[1])\n"
        "(root/f'pid-{level}').write_text(str(os.getpid()))\n"
        "if level < 2: subprocess.Popen([sys.executable,__file__,str(level+1)])\n"
        "while not (root/'release-parent').exists() or level != 0: time.sleep(.025)\n"
    )
    if not parent_exits:
        # No release is written in this case, so every generation remains alive.
        assert not (root / "release-parent").exists()
    return [sys.executable, str(path), "0"]


def tree_handles(root: Path):
    return held_processes([int(await_file(root / f"pid-{level}")) for level in range(3)])


def test_actual_hidden_launch_preserves_argv_logs_and_exit_259(tmp_path):
    command = [sys.executable, "-c", "import ctypes,sys; assert ctypes.windll.kernel32.GetConsoleWindow()==0; print(sys.argv[1:],flush=True); ctypes.windll.kernel32.ExitProcess(259)",
               "space value", 'quoted"value', "trailing\\"]
    with (tmp_path / "out.log").open("x") as log:
        process = windows.WindowsProcess(command, cwd=tmp_path, stdout=log)
        try:
            assert process.wait() == 259
            assert process.poll() == 259
        finally:
            process.drain()
    output = (tmp_path / "out.log").read_text()
    assert "space value" in output and 'quoted"value' in output


def test_actual_job_drains_child_and_grandchild_after_parent_exits(tmp_path):
    with (tmp_path / "out.log").open("x") as log:
        process = windows.WindowsProcess(tree_command(tmp_path, parent_exits=True), cwd=tmp_path, stdout=log)
        try:
            handles = tree_handles(tmp_path)
            # Virtualenv launchers can introduce extra owned redirector processes.
            assert process.active_processes() >= 3
            (tmp_path / "release-parent").touch()
            assert process.wait() == 0
            process.drain()
            assert_drained(handles)
        finally:
            process.drain()


def test_actual_owner_crash_closes_noninherited_job_and_drains_tree(tmp_path):
    command = tree_command(tmp_path)
    owner_script = (
        "import json,os,pathlib,time; from acephale.windows_process import WindowsProcess; "
        f"root=pathlib.Path({str(tmp_path)!r}); log=(root/'tree.log').open('x'); "
        f"child=WindowsProcess({command!r},cwd=root,stdout=log)\n"
        "while not (root/'crash-owner').exists(): time.sleep(.025)\n"
        "os._exit(73)\n"
    )
    owner = subprocess.Popen([sys.executable, "-c", owner_script], creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        handles = tree_handles(tmp_path)
        (tmp_path / "crash-owner").touch()
        assert owner.wait(timeout=10) == 73
        assert_drained(handles)
    finally:
        if owner.poll() is None:
            owner.kill()
        owner.wait(timeout=10)


def test_failed_assignment_never_runs_unowned_code(tmp_path, monkeypatch):
    import _winapi

    api, handles = windows.kernel(), []

    class RejectAssignment:
        def __getattr__(self, name):
            return getattr(api, name)

        def AssignProcessToJobObject(self, _job, process):
            # Retain the exact suspended process handle to check its termination.
            current = _winapi.GetCurrentProcess()
            handles.append(_winapi.DuplicateHandle(current, process, current, 0x100000, False, 0))
            ctypes.set_last_error(5)
            return False

    monkeypatch.setattr(windows, "kernel", RejectAssignment)
    with (tmp_path / "out.log").open("x") as log, pytest.raises(OSError):
        windows.WindowsProcess([sys.executable, "-c", "import pathlib; pathlib.Path('unowned').touch()"], cwd=tmp_path, stdout=log)
    assert len(handles) == 1
    assert_drained(handles)
    assert not (tmp_path / "unowned").exists()


def test_only_declared_standard_handles_are_inherited(tmp_path):
    api = windows.kernel()
    api.CreateEventW.argtypes = [ctypes.c_void_p, windows.w.BOOL, windows.w.BOOL, windows.w.LPCWSTR]
    api.CreateEventW.restype = windows.w.HANDLE
    unrelated = api.CreateEventW(None, True, False, None)
    windows.check(unrelated)
    os.set_handle_inheritable(unrelated, True)
    try:
        with (tmp_path / "out.log").open("x") as log:
            original_flag = os.get_handle_inheritable(__import__("msvcrt").get_osfhandle(log.fileno()))
            script = ("import ctypes; k=ctypes.WinDLL('kernel32'); k.SetEvent.argtypes=[ctypes.c_void_p]; "
                      f"k.SetEvent({unrelated})")
            process = windows.WindowsProcess([sys.executable, "-c", script], cwd=tmp_path, stdout=log)
            try:
                assert process.wait() == 0
                assert os.get_handle_inheritable(__import__("msvcrt").get_osfhandle(log.fileno())) == original_flag
                assert os.get_handle_inheritable(unrelated)
                assert api.WaitForSingleObject(unrelated, 0) == 0x102
            finally:
                process.drain()
    finally:
        api.CloseHandle(unrelated)


def test_stop_raised_by_predispatch_guard_never_creates_windows_process(tmp_path, monkeypatch):
    stopped = []
    stage = runner.Stage(id="stop", command=[sys.executable], timeoutSeconds=10,
                         artifacts=[runner.ArtifactCheck(path="unused", kind="json", expected={"status": "completed"})])
    monkeypatch.setattr(windows, "WindowsProcess", lambda *_args, **_kwargs: pytest.fail("Stopped stage cannot launch"))
    with pytest.raises(InterruptedError, match="before dispatch"):
        runner.execute([sys.executable], tmp_path, stage, tmp_path, lambda: stopped.append(15), time.time() + 10, stopped)


@pytest.mark.parametrize("reason", ["timeout", "stop", "guard"])
def test_actual_runner_drains_tree_on_timeout_stop_and_guard_error(tmp_path, reason):
    stage = runner.Stage(id="native", command=[sys.executable], timeoutSeconds=10,
                         artifacts=[runner.ArtifactCheck(path="unused", kind="json", expected={"status": "completed"})])
    command, stopped, handles = tree_command(tmp_path), [], []
    deadline = time.time() + (1 if reason == "timeout" else 10)

    def guard():
        if (tmp_path / "pid-2").exists() and not handles:
            handles.extend(tree_handles(tmp_path))
            if reason == "stop":
                stopped.append(15)
            elif reason == "guard":
                raise ValueError("Frozen input changed")

    expected = {"timeout": TimeoutError, "stop": InterruptedError, "guard": ValueError}[reason]
    with pytest.raises(expected):
        runner.execute(command, tmp_path, stage, tmp_path, guard, deadline, stopped)
    assert len(handles) == 3
    assert_drained(handles)


def test_actual_windows_sequence_verifies_artifacts(tmp_path, monkeypatch):
    frozen = tmp_path / "input.json"
    frozen.write_text("{}")
    producer = tmp_path / "producer.py"
    producer.write_text("import json,pathlib,sys; p=pathlib.Path(sys.argv[1]); p.mkdir(); (p/'result.json').write_text(json.dumps({'status':'completed'}))")
    value = {"schemaVersion": 1, "kind": "acephale-experiment", "experimentId": "windows-proof",
             "source": str(tmp_path), "sourceCommit": "a" * 40,
             "inputs": {"data": {"path": str(frozen), "sha256": runner.file_hash(frozen)}},
             "stages": [{"id": "local", "command": [sys.executable, str(producer), "{output}"], "timeoutSeconds": 10,
                         "artifacts": [{"path": "result.json", "kind": "json", "expected": {"status": "completed"}}]}],
             "deadline": time.time() + 30, "maximumSeconds": 30}
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps(value))
    monkeypatch.setattr(runner, "verify_source", lambda *_: None)
    result = runner.run(manifest, tmp_path / "run")
    assert result["status"] == "completed"
    assert runner.run(manifest, tmp_path / "run", resume=True) == result
