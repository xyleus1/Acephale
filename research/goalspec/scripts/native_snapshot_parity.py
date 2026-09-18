"""Run in the pinned native venv; no provider calls or task-success claims."""
# ruff: noqa: E402
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))

from tau2.agent.base_agent import HalfDuplexAgent
from tau2.data_model.message import AssistantMessage, ToolCall, UserMessage
from tau2.domains.airline.environment import get_environment as airline
from tau2.domains.airline.environment import get_tasks as airline_tasks
from tau2.domains.retail.environment import get_environment as retail
from tau2.domains.retail.environment import get_tasks as retail_tasks
from tau2.evaluator.evaluator import EvaluationType, evaluate_simulation
from tau2.orchestrator.orchestrator import Orchestrator
from tau2.user.user_simulator import UserSimulator
from tau2.user.user_simulator_base import UserState

from goalspec.adapters.tau_snapshot import NativeSnapshotEnvironment


class FixtureUser(UserSimulator):
    def __init__(self):
        super().__init__(llm="unused-no-provider")

    def get_init_state(self, message_history=None):
        return UserState(system_messages=[], messages=[])

    def generate_next_message(self, message, state):
        response = UserMessage(role="user", content="List available options." if not state.messages else "###STOP###")
        state.messages.append(response)
        return response, state


class FixtureActor(HalfDuplexAgent[int]):
    def __init__(self, environment, listing):
        super().__init__(environment.get_tools(), environment.get_policy())
        self.listing = listing

    def get_init_state(self, message_history=None):
        return 0

    def generate_next_message(self, message, state):
        response = (AssistantMessage(role="assistant", tool_calls=[ToolCall(id="native-real-call", name=self.listing, arguments={})])
                    if state == 0 else AssistantMessage(role="assistant", content="Here are the options."))
        return response, state + 1


def orchestration(factory, tasks, listing, wrapped):
    environment = factory()
    if wrapped:
        environment = NativeSnapshotEnvironment(environment)
    task = tasks()[0]
    actor = FixtureActor(environment, listing)
    simulation = Orchestrator(domain=environment.domain_name, agent=actor, user=FixtureUser(),
                              environment=environment, task=task, max_steps=10, seed=17).run()
    reward = evaluate_simulation(simulation, task, EvaluationType.ENV, False, environment.domain_name)
    return {"observations": [m.model_dump(exclude={"timestamp", "turn_idx"}) for m in simulation.messages if m.role == "tool"],
            "state": environment.get_db_hash(), "termination": simulation.termination_reason.value, "reward": reward.reward}


def verify(factory, listing):
    direct = factory()
    wrapped = NativeSnapshotEnvironment(factory())
    user_id = next(iter(direct.tools.db.users))
    cases = [(listing, {}), ("get_user_details", {"user_id": user_id}),
             ("get_user_details", {"user_id": "nonexistent-fixture-user"})]
    for index, (tool, arguments) in enumerate(cases):
        call = ToolCall(id=f"real-call-{index}", name=tool, arguments=arguments)
        before = wrapped.get_db_hash()
        read = wrapped.read(tool, arguments)
        promoted = wrapped.consume(call, read["lease"])
        native = direct.get_response(call)
        assert promoted.model_dump(exclude={"timestamp"}) == native.model_dump(exclude={"timestamp"})
        assert before == wrapped.get_db_hash() == direct.get_db_hash()
    stale = wrapped.read(listing, {})
    call = ToolCall(id="staged-real-id", name=listing, arguments={})
    wrapped.stage(AssistantMessage(role="assistant", tool_calls=[call]), {call.id: stale["lease"]})
    wrapped.reads.authoritative(lambda: None)
    result = wrapped.get_response(call)
    assert result.content == direct.get_response(call).content
    assert wrapped.promotion_events[-1] == {"call_id": call.id, "status": "stale_fallback"}
    stale = wrapped.read(listing, {})
    mixed = AssistantMessage(role="assistant", tool_calls=[call, ToolCall(id="side-effect", name="transfer_to_human_agents", arguments={"summary": "fixture"})])
    wrapped.stage(mixed, {call.id: stale["lease"]})
    assert not wrapped._staged
    try:
        wrapped.validate(stale["lease"], listing, {})
    except ValueError:
        pass
    else:
        raise AssertionError("Mixed batch retained promotable evidence")
    stale = wrapped.read(listing, {})
    wrapped.get_response(ToolCall(id="authoritative", name=listing, arguments={}))
    try:
        wrapped.validate(stale["lease"], listing, {})
    except ValueError:
        pass
    else:
        raise AssertionError("Authoritative boundary did not invalidate lease")
    try:
        wrapped.read("transfer_to_human_agents", {"summary": "denied"})
    except ValueError:
        pass
    else:
        raise AssertionError("Side effect admitted")
    # An out-of-band database change must also fail freshness checks.
    stale = wrapped.read(listing, {})
    wrapped.tools.db.users.pop(user_id)
    try:
        wrapped.validate(stale["lease"], listing, {})
    except ValueError:
        pass
    else:
        raise AssertionError("External database mutation was not detected")
    return {"domain": direct.domain_name, "native_observation_cases": len(cases), "passed": True}


if __name__ == "__main__":
    for factory, tasks, listing in [(retail, retail_tasks, "list_all_product_types"), (airline, airline_tasks, "list_all_airports")]:
        assert orchestration(factory, tasks, listing, False) == orchestration(factory, tasks, listing, True)
    print(json.dumps({"label": "native snapshot parity, not benchmark performance", "model_calls": 0,
                      "orchestration_parity": ["observations", "state", "termination", "native_environment_reward"],
                      "checks": [verify(retail, "list_all_product_types"), verify(airline, "list_all_airports")]}))
