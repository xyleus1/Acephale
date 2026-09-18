"""Native mock integration, with a scripted Node actor and zero provider calls."""
# Native-environment path bootstrap must precede the adapter imports.
# ruff: noqa: E402
import json
import os
import secrets
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))

from tau2.agent.base_agent import HalfDuplexAgent
from tau2.data_model.message import AssistantMessage, ToolCall, UserMessage
from tau2.domains.mock.environment import get_environment, get_tasks
from tau2.evaluator.evaluator import EvaluationType, evaluate_simulation
from tau2.orchestrator.orchestrator import Orchestrator
from tau2.user.user_simulator import UserSimulator
from tau2.user.user_simulator_base import UserState

from goalspec.adapters.step_gateway import StepBroker, server
from goalspec.adapters.tau_external_agent import ExternalGoalSpecAgent


class ScriptedUser(UserSimulator):
    def __init__(self):
        super().__init__(llm="unused-no-provider")

    def get_init_state(self, message_history=None):
        return UserState(system_messages=[], messages=[])

    def generate_next_message(self, message, state):
        text = "Create a task called Important Meeting for user_1." if not state.messages else "###STOP###"
        response = UserMessage(role="user", content=text)
        state.messages.append(response)
        return response, state


class ScriptedActor(HalfDuplexAgent[int]):
    def get_init_state(self, message_history=None):
        return 0

    def generate_next_message(self, message, state):
        if state == 0:
            return AssistantMessage(role="assistant", tool_calls=[ToolCall(id="create-1", name="create_task", arguments={"user_id": "user_1", "title": "Important Meeting"})]), 1
        return AssistantMessage(role="assistant", content="The task was created successfully."), state + 1


def run(agent_factory):
    environment = get_environment()
    task = get_tasks()[0]
    actor = agent_factory(environment)
    orchestrator = Orchestrator(domain="mock", agent=actor, user=ScriptedUser(), environment=environment, task=task, max_steps=10, seed=17)
    simulation = orchestrator.run()
    reward = evaluate_simulation(simulation, task, EvaluationType.ENV, False, "mock")
    observations = [m.model_dump(exclude={"timestamp", "turn_idx"}) for m in simulation.messages if m.role == "tool"]
    return {"observations": observations, "state_hash": environment.get_db_hash(), "termination": simulation.termination_reason.value, "reward": reward.reward}


def main():
    direct = run(lambda env: ScriptedActor(env.get_tools(), env.get_policy()))
    broker = StepBroker()
    token = secrets.token_hex(32)
    gateway = server(broker, token)
    thread = threading.Thread(target=gateway.serve_forever, daemon=True)
    thread.start()
    process = subprocess.Popen(["node", "--import", "tsx", "scripts/goalspec-native-fixture-worker.ts"], cwd=ROOT,
                               env={**os.environ, "GOALSPEC_GATEWAY_URL": f"http://127.0.0.1:{gateway.server_port}", "GOALSPEC_GATEWAY_TOKEN": token})
    try:
        external = run(lambda env: ExternalGoalSpecAgent(env.get_tools(), env.get_policy(), broker, "parity"))
        if process.wait(timeout=20) != 0:
            raise RuntimeError("Node fixture worker failed")
        assert direct == external, (direct, external)
        assert direct["reward"] == 1
        print(json.dumps({"label": "native mock gateway parity, not research performance", "passed": True, "checks": ["observations", "state", "termination", "native_environment_reward"], "model_calls": 0}))
    finally:
        broker.close()
        gateway.shutdown()
        gateway.server_close()
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)


if __name__ == "__main__":
    main()
