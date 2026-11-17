"""Pinned upstream branch integration; isolated model port, no provider calls."""
import os
import subprocess
from pathlib import Path

import pytest

from acephale.native_common import REVISION


def test_actual_pinned_upstream_additive_mode_preserves_reward_and_budgeted_port():
    source = os.environ.get("ACEPHALE_NATIVE_UPSTREAM")
    interpreter = os.environ.get("ACEPHALE_NATIVE_PYTHON")
    if not source or not interpreter:
        pytest.skip("Set explicit pinned upstream checkout and its locked Python interpreter")
    assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() == REVISION
    package = Path(__file__).resolve().parents[1] / "src"
    script = r'''
import json
from types import SimpleNamespace as NS
import dotenv
dotenv.load_dotenv = lambda *a, **k: False
from tau2.evaluator.evaluator import EvaluationType
from tau2.data_model.simulation import RewardInfo, TerminationReason
from tau2.data_model.message import UserMessage
from acephale.native_common import MODELS, native_ports, clone_with_globals, assess_official_reward

class Broker:
    def __init__(self, met): self.met, self.calls = met, []
    def exchange(self, worker_id, boundary):
        self.calls.append((worker_id, boundary))
        if self.met == "error": raise RuntimeError("fixture teacher transport failure")
        return {"role": "assistant", "content": json.dumps({"results": [{"expectedOutcome": "private fixture assertion", "reasoning": "fixture", "metExpectation": self.met}]})}

class Component:
    @classmethod
    def calculate_reward(cls, **kwargs): return RewardInfo(reward=1, reward_breakdown={})

registry = NS(get_env_constructor=lambda domain: lambda **kwargs: NS(tools=None, user_tools=None))
task = NS(user_scenario="public fixture request", evaluation_criteria=NS(nl_assertions=["private fixture assertion"], reward_basis=["DB", "COMMUNICATE"]))
simulation = NS(termination_reason=TerminationReason.USER_STOP, messages=[UserMessage(role="user", content="public fixture request")])
for met in (True, False):
    broker = Broker(met)
    user, evaluate = native_ports(broker, "fixture", task, MODELS)
    assert "private fixture assertion" not in user.system_prompt
    evaluate = clone_with_globals(evaluate, {"EnvironmentEvaluator": Component, "ActionEvaluator": Component, "CommunicateEvaluator": Component, "registry": registry})
    baseline = evaluate(simulation, task, EvaluationType.ALL, False, "airline")
    assert baseline.reward == 1 and baseline.nl_assertions is None and not broker.calls
    audited = evaluate(simulation, task, EvaluationType.ALL_WITH_NL_ASSERTIONS, False, "airline")
    assert audited.reward == baseline.reward and audited.reward_basis == baseline.reward_basis
    assert len(broker.calls) == 1 and broker.calls[0][0] == "fixture:evaluator"
    assert broker.calls[0][1]["tools"] == []
    assert "private fixture assertion" in json.dumps(broker.calls[0][1])
    verdict = assess_official_reward(task, audited, evaluation_type="ALL_WITH_NL_ASSERTIONS")
    assert verdict["passed"] and verdict["constraintViolations"] == int(not met)
    assert verdict["constraintAudit"]["status"] == "complete"
    # Empty retail constraints cannot manufacture a measured zero or a judge call.
    task.evaluation_criteria = NS(nl_assertions=[], reward_basis=["DB", "NL_ASSERTION"])
    empty = evaluate(simulation, task, EvaluationType.ALL_WITH_NL_ASSERTIONS, False, "retail")
    assert len(broker.calls) == 1
    assert assess_official_reward(task, empty, evaluation_type="ALL_WITH_NL_ASSERTIONS")["constraintViolations"] is None
    task.evaluation_criteria = NS(nl_assertions=["private fixture assertion"], reward_basis=["DB", "COMMUNICATE"])
broker = Broker("error")
_, evaluate = native_ports(broker, "fixture", task, MODELS)
evaluate = clone_with_globals(evaluate, {"EnvironmentEvaluator": Component, "ActionEvaluator": Component, "CommunicateEvaluator": Component, "registry": registry})
try:
    evaluate(simulation, task, EvaluationType.ALL_WITH_NL_ASSERTIONS, False, "airline")
except RuntimeError as error:
    assert "transport failure" in str(error)
else:
    raise AssertionError("Teacher error became a fabricated reward")
assert len(broker.calls) == 1 and broker.calls[0][0] == "fixture:evaluator"
print("pinned upstream additive branch passed")
'''
    result = subprocess.run([interpreter, "-c", script], cwd=source,
                            env={**os.environ, "PYTHONPATH": str(package)}, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr[-6000:]
    assert "pinned upstream additive branch passed" in result.stdout
