"""No-provider parity checks for the actual pinned user and assertion evaluator methods."""
# ruff: noqa: E402
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
import dotenv

dotenv.load_dotenv = lambda *args, **kwargs: False

from tau2.agent.llm_agent import AGENT_INSTRUCTION
from tau2.data_model.message import AssistantMessage
from tau2.data_model.tasks import Task
from tau2.evaluator.evaluator_nl_assertions import NLAssertionsEvaluator
from tau2.registry import registry
from tau2.user.user_simulator import UserSimulator

from goalspec import official_native
from goalspec.fresh_tasks import digest
from goalspec.live_design import MODELS


class Broker:
    def __init__(self, response):
        self.calls, self.response = [], response

    def exchange(self, worker, payload):
        self.calls.append((worker, payload))
        return dict(self.response)


class NativeProtocolParity(unittest.TestCase):
    def setUp(self):
        self.task = Task.model_validate({"id": "offline-control", "user_scenario": {"persona": "Be concise", "instructions": "Ask for help."},
            "evaluation_criteria": {"reward_basis": ["NL_ASSERTION"], "nl_assertions": ["Agent explained the answer"]}})

    def test_user_runs_identical_native_method_prompt_and_stop(self):
        broker = Broker({"role": "user", "content": "Thanks. ###STOP###"})
        actual, _ = official_native.native_ports(broker, "offline", self.task, MODELS)
        native = UserSimulator(llm=MODELS["user"], instructions=str(self.task.user_scenario), tools=None, llm_args={"temperature": 0.0})
        greeting = AssistantMessage(role="assistant", content="The work is complete.")
        with patch("tau2.user.user_simulator.generate", return_value=AssistantMessage(role="assistant", content=broker.response["content"], cost=0.0)) as call:
            expected_message, expected_state = native.generate_next_message(greeting, native.get_init_state())
        actual_message, actual_state = actual.generate_next_message(greeting, actual.get_init_state())
        self.assertIs(actual._generate_next_message.__func__.__code__, UserSimulator._generate_next_message.__code__)
        self.assertEqual(actual_message.model_dump(), expected_message.model_dump())
        self.assertEqual(actual_state.model_dump(), expected_state.model_dump())
        prompt = call.call_args.kwargs["messages"]
        self.assertEqual(broker.calls[0], ("offline:user", {"policy": prompt[0].content,
            "messages": [{"role": message.role, "content": message.content or ""} for message in prompt[1:]], "tools": []}))
        self.assertTrue(actual.is_stop(actual_message))
        self.assertNotIn("Conversation completion clarification", actual.system_prompt)

    def test_evaluator_preserves_native_prompt_parser_and_reward(self):
        response = json.dumps({"results": [{"expectedOutcome": "Agent explained the answer", "reasoning": "Explanation is present", "metExpectation": True}]})
        broker = Broker({"role": "assistant", "content": response})
        _, evaluator = official_native.native_ports(broker, "offline", self.task, MODELS)
        local = evaluator.__globals__["NLAssertionsEvaluator"]
        trajectory = [AssistantMessage(role="assistant", content="Here is the answer.")]
        with patch("tau2.evaluator.evaluator_nl_assertions.generate", return_value=AssistantMessage(role="assistant", content=response, cost=0.0)) as call:
            expected = NLAssertionsEvaluator.calculate_reward(self.task, trajectory)
        actual = local.calculate_reward(self.task, trajectory)
        self.assertIs(local.evaluate_nl_assertions.__func__.__code__, NLAssertionsEvaluator.evaluate_nl_assertions.__func__.__code__)
        self.assertEqual(actual.model_dump(), expected.model_dump())
        prompt = call.call_args.kwargs["messages"]
        self.assertEqual(broker.calls[0], ("offline:evaluator", {"policy": prompt[0].content,
            "messages": [{"role": "user", "content": prompt[1].content}], "tools": []}))
        invalid = Broker({"role": "assistant", "content": "not valid JSON"})
        _, bad_evaluator = official_native.native_ports(invalid, "offline", self.task, MODELS)
        with self.assertRaises(json.JSONDecodeError):
            bad_evaluator.__globals__["NLAssertionsEvaluator"].calculate_reward(self.task, trajectory)

    def test_actor_transport_change_preserves_policy_instruction(self):
        result = official_native.api_actor_instruction(AGENT_INSTRUCTION)
        self.assertIn("Try to be helpful and always follow the policy.", result)
        self.assertIn("You cannot do both at the same time.", result)
        self.assertNotIn("valid JSON only", result)
        self.assertIn("function tool calls", result)

    def test_process_creation_failure_retains_every_untimed_slot(self):
        base = ROOT / "research/goalspec/runs"
        with tempfile.TemporaryDirectory(prefix="v3-offline-bootstrap-test-", dir=base) as temp:
            folder = Path(temp)
            for domain in ("retail", "airline"):
                path = folder / f"data/tau2/domains/{domain}"
                path.mkdir(parents=True)
                (path / "tasks.json").write_text("[]", encoding="utf-8")
            records = folder / "records.json"
            records.write_text(json.dumps([{"pattern": {"snapshotId": "offline-only"}}]), encoding="utf-8")
            study = {"upstreamRoot": str(folder), "frozenLibrary": {"recordsPath": str(records)},
                "frozenExperienceMemory": {"path": str(folder / "unused-memory.json")}, "studyId": "offline",
                "studyHash": "a" * 64, "maxSteps": 200, "label": "offline fixture", "upstreamRevision": "offline", "models": MODELS}
            trials = [{"family": "retail:official:fake", "taskId": "fake", "domain": "retail", "variant": 0,
                "trial": 0, "seed": 1, "arm": arm, "reserved_usd": 1.25} for arm in ("base", "paste", "salesforce", "goalspec")]
            design = {"studyStage": "development-1", "phase": "development", "trials": trials, "families": ["retail:official:fake"]}
            design["designHash"] = digest(design)
            class Environment:
                def get_policy(self):
                    return "public policy"
                def get_tools(self):
                    return []
            with patch.object(official_native, "verify_claim", return_value=(study, design, {})), patch.object(official_native, "service_manifest_hash", return_value="0" * 64), patch.object(registry, "get_env_constructor", return_value=lambda **kwargs: Environment()), patch.object(official_native.subprocess, "Popen", side_effect=OSError("offline simulated spawn failure")):
                result = official_native.run_stage(folder, folder / "unused-design.json", folder / "output", folder)
            rows = [json.loads(line) for line in (folder / "output/outcomes.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(rows), 4)
            self.assertEqual(result["successes"], 0)
            self.assertTrue(all(row["termination"] == "service_startup_error" and row["latencyMs"] is None for row in rows))


if __name__ == "__main__":
    unittest.main()
