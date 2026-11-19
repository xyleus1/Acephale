"""Offline tests: controlled local Python children stand in for Node inspection."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace

import pytest

HERE = Path(__file__).resolve().parent


@pytest.fixture
def budget(tmp_path):
    spec = importlib.util.spec_from_file_location('budget_progress_control', HERE / 'control.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.ROOT = tmp_path
    plan = {'studyLedgerPath': 'local-test-journal', 'studyCheckpointPath': 'local-test-checkpoint',
            'studyCheckpointHash': 'a' * 64, 'infrastructureLedgerPath': 'local-test-slice'}
    return module, plan


def real_child(module, monkeypatch, program, *, clock=None, ignore_terminate=False):
    children, requests = [], []

    class Child:
        def __init__(self, command, **kwargs):
            assert command[:4] == ['node', '--import', 'tsx', 'scripts/acephale-aws-budget.ts']
            assert kwargs == {'cwd': module.ROOT, 'text': True, 'stdout': subprocess.PIPE,
                              'stderr': subprocess.PIPE, 'shell': False}
            requests.append(json.loads(Path(command[4]).read_bytes()))
            self.real = subprocess.Popen([sys.executable, '-u', '-c', program], **kwargs)
            self.events = []
            children.append(self)

        @property
        def returncode(self):
            return self.real.returncode

        def poll(self):
            return self.real.poll()

        def terminate(self):
            self.events.append('terminate')
            if not ignore_terminate:
                self.real.terminate()

        def kill(self):
            self.events.append('kill')
            self.real.kill()

        def communicate(self, timeout):
            self.events.append(('communicate', timeout))
            draining = 'kill' in self.events or ('terminate' in self.events and not ignore_terminate)
            try:
                result = self.real.communicate(timeout=timeout if draining else min(timeout, 0.025))
            except subprocess.TimeoutExpired:
                if clock is not None:
                    clock[0] += timeout
                raise
            self.events.append('drained')
            return result

    proxy = SimpleNamespace(Popen=Child, PIPE=subprocess.PIPE, TimeoutExpired=subprocess.TimeoutExpired,
                            SubprocessError=subprocess.SubprocessError, CompletedProcess=subprocess.CompletedProcess)
    monkeypatch.setattr(module, 'subprocess', proxy)
    if clock is not None:
        monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    return children, requests


def assert_drained(children):
    assert len(children) == 1
    child = children[0]
    assert child.poll() is not None
    assert child.real.stdout.closed and child.real.stderr.closed
    assert child.events[-1] == 'drained'


def test_default_reservation_request_and_subprocess_options_unchanged(budget, monkeypatch):
    module, plan = budget
    seen = []

    def run(command, **kwargs):
        seen.append((json.loads(Path(command[-1]).read_bytes()), kwargs))
        return subprocess.CompletedProcess(command, 0, '{"accepted": true}', '')

    monkeypatch.setattr(module, 'subprocess', SimpleNamespace(run=run, SubprocessError=subprocess.SubprocessError))
    result = module.study_budget(plan, 'reserve', {'id': 'local-id', 'reservedMicrodollars': 123})
    assert result == {'accepted': True}
    request, options = seen[0]
    assert request['operation'] == 'reserve' and request['reservationId'] == 'lambda-infra:local-id'
    assert request['maximumMicrodollars'] == 123 and request['requireNewReservation'] is True
    assert options == {'cwd': module.ROOT, 'text': True, 'capture_output': True,
                       'timeout': 180, 'check': False, 'shell': False}


@pytest.mark.parametrize('operation,callback', [('reserve', lambda: None), ('bind', lambda: None), ('inspect', False)])
def test_progress_rejects_non_inspection_or_non_callable_before_spawn(budget, operation, callback):
    module, _ = budget
    with pytest.raises(ValueError, match='only for study-budget inspection'):
        module.study_budget({}, operation, progress=callback)


def test_real_child_progress_same_thread_and_complete_outputs(budget, monkeypatch):
    module, plan = budget
    program = "import json,sys,time; time.sleep(.08); sys.stderr.write('e'*200000); print(json.dumps({'value':'x'*200000}))"
    children, requests = real_child(module, monkeypatch, program)
    calls = []
    result = module.study_budget(plan, 'inspect', progress=lambda: calls.append(threading.get_ident()))
    assert result == {'value': 'x' * 200000}
    assert len(calls) >= 3 and set(calls) == {threading.get_ident()}
    assert requests[0]['operation'] == 'inspect'
    assert not any(key in requests[0] for key in ('reservationId', 'requireNewReservation'))
    assert_drained(children)
    assert 'terminate' not in children[0].events


@pytest.mark.parametrize('error', [RuntimeError('cancelled'), KeyboardInterrupt(), SystemExit(7),
                                  OSError('callback error'), subprocess.TimeoutExpired('callback', 1)])
def test_callback_error_identity_preserved_and_child_drained(budget, monkeypatch, error):
    module, plan = budget
    children, _ = real_child(module, monkeypatch, 'import time; time.sleep(60)')
    calls = []

    def progress():
        calls.append(1)
        if len(calls) == 2:
            raise error

    with pytest.raises(type(error)) as caught:
        module.study_budget(plan, 'inspect', progress=progress)
    assert caught.value is error
    assert_drained(children)
    assert 'terminate' in children[0].events


def test_failure_before_spawn_starts_no_process(budget, monkeypatch):
    module, plan = budget
    children, _ = real_child(module, monkeypatch, "print('{}')")
    error = RuntimeError('cancel before spawn')

    def progress():
        raise error

    with pytest.raises(RuntimeError) as caught:
        module.study_budget(plan, 'inspect', progress=progress)
    assert caught.value is error and not children


def test_work_deadline_is_fixed_180_seconds_and_does_not_reset(budget, monkeypatch):
    module, plan = budget
    clock = [0.0]
    children, _ = real_child(module, monkeypatch, 'import time; time.sleep(60)', clock=clock)
    callbacks = []
    with pytest.raises(RuntimeError, match='uncertain; reservations retained'):
        module.study_budget(plan, 'inspect', progress=lambda: callbacks.append(clock[0]))
    assert callbacks == list(range(0, 180, 15))
    child = children[0]
    before_termination = child.events[:child.events.index('terminate')]
    assert before_termination == [('communicate', 15)] * 12
    assert_drained(children)


def test_callback_time_counts_and_no_second_wait_after_deadline(budget, monkeypatch):
    module, plan = budget
    clock = [0.0]
    children, _ = real_child(module, monkeypatch, 'import time; time.sleep(60)', clock=clock)
    count = [0]

    def progress():
        count[0] += 1
        if count[0] == 2:
            clock[0] += 170

    with pytest.raises(RuntimeError, match='uncertain; reservations retained'):
        module.study_budget(plan, 'inspect', progress=progress)
    assert children[0].events[:children[0].events.index('terminate')] == [('communicate', 15)]
    assert_drained(children)


def test_last_wait_clips_to_remaining_deadline(budget, monkeypatch):
    module, plan = budget
    clock = [0.0]
    children, _ = real_child(module, monkeypatch, 'import time; time.sleep(60)', clock=clock)
    count = [0]

    def progress():
        count[0] += 1
        if count[0] == 2:
            clock[0] = 179.5

    with pytest.raises(RuntimeError, match='uncertain; reservations retained'):
        module.study_budget(plan, 'inspect', progress=progress)
    assert children[0].events[:children[0].events.index('terminate')] == [('communicate', 15), ('communicate', .5)]
    assert_drained(children)


def test_stubborn_owned_child_is_killed_and_drained(budget, monkeypatch):
    module, plan = budget
    children, _ = real_child(module, monkeypatch, 'import time; time.sleep(60)', ignore_terminate=True)
    count = [0]

    def progress():
        count[0] += 1
        if count[0] == 2:
            raise RuntimeError('cancelled')

    with pytest.raises(RuntimeError, match='cancelled'):
        module.study_budget(plan, 'inspect', progress=progress)
    assert_drained(children)
    events = children[0].events
    assert events.index('terminate') < events.index('kill') < events.index('drained')


def test_completion_callback_failure_is_retained_after_drain(budget, monkeypatch):
    module, plan = budget
    children, _ = real_child(module, monkeypatch, "print('{}')")
    error = RuntimeError('completion callback failed')

    def progress():
        if children and children[0].poll() is not None:
            raise error

    with pytest.raises(RuntimeError) as caught:
        module.study_budget(plan, 'inspect', progress=progress)
    assert caught.value is error
    assert_drained(children)


@pytest.mark.parametrize('program,error,match', [
    ("import sys; sys.stderr.write('private error'); sys.exit(2)", RuntimeError, 'rejected; reservations retained'),
    ("print('not json')", json.JSONDecodeError, None)])
def test_child_rejection_and_bad_json_match_existing_semantics(budget, monkeypatch, program, error, match):
    module, plan = budget
    children, _ = real_child(module, monkeypatch, program)
    with pytest.raises(error, match=match):
        module.study_budget(plan, 'inspect', progress=lambda: None)
    assert_drained(children)


def test_spawn_failure_is_sanitized(budget, monkeypatch):
    module, plan = budget

    def fail(*args, **kwargs):
        raise OSError('private child path')

    proxy = SimpleNamespace(Popen=fail, PIPE=subprocess.PIPE, SubprocessError=subprocess.SubprocessError)
    monkeypatch.setattr(module, 'subprocess', proxy)
    with pytest.raises(RuntimeError, match='uncertain; reservations retained') as caught:
        module.study_budget(plan, 'inspect', progress=lambda: None)
    assert 'private' not in str(caught.value)


def test_communicate_error_is_sanitized_after_child_drain(budget, monkeypatch):
    module, plan = budget
    children, _ = real_child(module, monkeypatch, 'import time; time.sleep(60)')
    factory = module.subprocess.Popen

    def start(*args, **kwargs):
        child = factory(*args, **kwargs)
        communicate = child.communicate
        first = [True]

        def fail_once(timeout):
            if first[0]:
                first[0] = False
                raise OSError('private pipe failure')
            return communicate(timeout)

        child.communicate = fail_once
        return child

    module.subprocess.Popen = start
    with pytest.raises(RuntimeError, match='uncertain; reservations retained') as caught:
        module.study_budget(plan, 'inspect', progress=lambda: None)
    assert 'private' not in str(caught.value)
    assert_drained(children)


def test_completion_callback_cannot_extend_work_deadline(budget, monkeypatch):
    module, plan = budget
    clock = [0.0]
    children, _ = real_child(module, monkeypatch, "print('{}')", clock=clock)

    def progress():
        if children and children[0].poll() is not None:
            clock[0] += 180

    with pytest.raises(RuntimeError, match='uncertain; reservations retained'):
        module.study_budget(plan, 'inspect', progress=progress)
    assert_drained(children)
