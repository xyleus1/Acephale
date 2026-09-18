"""Bounded native v5 smoke and parity, with scripted HTTP worker and zero providers."""
# ruff: noqa: E402
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ["TAU2_DATA_DIR"] = str(ROOT / "research/goalspec/.benchmarks/tau3/data")
import dotenv
dotenv.load_dotenv = lambda *args, **kwargs: False

from tau2.agent.base_agent import HalfDuplexAgent
from tau2.data_model.message import AssistantMessage, ToolCall
from tau2.data_model.tasks import Task, UserScenario
from tau2.orchestrator.orchestrator import Orchestrator
from goalspec import experiment_v5, native_runner_v5
from goalspec.fresh_tasks import NATIVE_COMMIT, digest, native_environment, verify_outcome
from goalspec.fresh_tasks_v5 import build_tasks, preflight_v5
from goalspec.official_native import native_ports
from goalspec.study_v2 import write
from goalspec.study_v3 import MODELS


class DirectActor(HalfDuplexAgent[int]):
    def __init__(self, environment, fixture):
        super().__init__(environment.get_tools(), environment.get_policy())
        self.fixture = fixture

    def get_init_state(self, message_history=None):
        return 0

    def generate_next_message(self, message, state):
        if state == 0:
            value = AssistantMessage(role="assistant", tool_calls=[ToolCall(id="offline-read", name="get_user_details",
                arguments={"user_id": next(iter(self.fixture["initialDatabase"]["users"]))})])
        elif state == 1:
            value = AssistantMessage(role="assistant", content="Please confirm the exact requested changes and their costs before I proceed.")
        elif state - 2 < len(self.fixture["referenceActions"]):
            value = AssistantMessage(role="assistant", tool_calls=[ToolCall(id=f"offline-write-{state - 2}", **self.fixture["referenceActions"][state - 2])])
        else:
            value = AssistantMessage(role="assistant", content="The requested changes have been completed with the other records unchanged.")
        return value, state + 1


class UserBroker:
    def __init__(self, request):
        self.request, self.index = request, 0

    def exchange(self, worker, payload):
        text = self.request if self.index == 0 else "Yes, please proceed." if self.index == 1 else "Thank you. ###STOP###"
        self.index += 1
        return {"role": "user", "content": text}


def direct(fixture, check):
    environment = native_environment(fixture)
    task = Task(id=fixture["taskId"], user_scenario=UserScenario(instructions=fixture["userInstructions"]))
    user, _ = native_ports(UserBroker(fixture["initialRequest"]), "direct", task, MODELS)
    simulation = Orchestrator(domain=fixture["domain"], agent=DirectActor(environment, fixture), user=user, environment=environment,
        task=task, max_steps=30, max_errors=10, seed=17).run()
    return {"observations": [message.model_dump(exclude={"timestamp", "turn_idx"}) for message in simulation.messages if message.role == "tool"],
        "state": environment.get_db_hash(), "termination": simulation.termination_reason.value,
        "verdict": verify_outcome(fixture, check, environment, simulation.messages)}


class NativeV5Smoke(unittest.TestCase):
    def test_real_http_worker_preserves_two_domain_observations_state_termination_and_verdict(self):
        candidates = build_tasks("offline-v5-smoke", "training")
        fixtures = [next(row for row in candidates if row["familyId"].endswith(suffix) and row["variant"] == 0)
            for suffix in ("swap_two_order_shipping_addresses", "copy_passenger_from_other_booking")]
        checks = {row["taskId"]: preflight_v5(row) for row in fixtures}
        expected = {row["taskId"]: direct(row, checks[row["taskId"]]) for row in fixtures}
        with tempfile.TemporaryDirectory(prefix="native-v5-smoke-", dir=ROOT / "outputs") as temporary:
            folder = Path(temporary)
            write(folder / "fixtures.json", {"generator": "fresh-native-v5", "tasks": fixtures, "checks": checks})
            write(folder / "records.json", [{"pattern": {"snapshotId": "offline-v5"}}])
            write(folder / "legacy.json", {})
            write(folder / "configuration.json", {"legacyConfigurationPath": str(folder / "legacy.json")})
            chosen = [*fixtures, fixtures[0]]
            trials = [{"family": row["familyId"], "domain": row["domain"], "taskId": row["taskId"], "variant": 0,
                "trial": index, "seed": 17, "arm": "base", "reserved_usd": 1.25} for index, row in enumerate(chosen)]
            design = {"studyId": "offline-v5-smoke", "studyStage": "training", "phase": "training", "trials": trials,
                "families": [row["familyId"] for row in fixtures], "maxSteps": 30, "maxErrors": 10, "trialTimeoutSeconds": 30,
                "label": "Offline native parity fixture; no benchmark performance claim"}
            design["designHash"] = digest(design)
            plan = {"design": design, "upstreamRoot": str(ROOT / "research/goalspec/.benchmarks/tau3"), "outputPath": str(folder / "run"),
                "budgetDirectory": str(folder / "no-provider-budget"), "inputs": {name: {"path": str(folder / file)} for name, file in
                    (("manifest", "fixtures.json"), ("configuration", "configuration.json"), ("records", "records.json"), ("memory", "unused.json"))}}
            scripts = [{"request": row["initialRequest"], "userId": next(iter(row["initialDatabase"]["users"])),
                "actions": row["referenceActions"], "fail": index == 2} for index, row in enumerate(chosen)]
            write(folder / "scripts.json", scripts)
            original_popen = subprocess.Popen
            def fixture_process(command, **kwargs):
                if "scripts/goalspec-service.ts" not in command:
                    return original_popen(command, **kwargs)
                kwargs["env"] = {**kwargs["env"], "GOALSPEC_OFFLINE_SCRIPTS": str(folder / "scripts.json")}
                # The fixture worker imports no provider and never opens a budget ledger.
                kwargs["env"].pop("OPENAI_API_KEY", None)
                return original_popen(["node", "--import", "tsx", "outputs/goalspec-v5-tools/native-smoke-worker.ts"], **kwargs)
            with patch.object(native_runner_v5.subprocess, "Popen", side_effect=fixture_process), patch.object(native_runner_v5, "preflight_v5", side_effect=lambda fixture: checks[fixture["taskId"]]) as preflight, patch.object(native_runner_v5, "telemetry", return_value={"billedUsd": 0, "knownUsageSubtotalUsd": 0, "unknownProviderCharge": False, "providerCalls": 0}), patch.object(native_runner_v5, "summarize_costs", return_value={"knownUsageSubtotalUsd": 0}):
                verified = []
                summary = native_runner_v5.run_stage(plan, lambda: verified.append(True))
            rows = [json.loads(line) for line in (folder / "run/outcomes.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(rows), 3)
            self.assertEqual(summary["successes"], 2)
            self.assertEqual(summary["serviceExitCode"], 0)
            self.assertEqual(len(verified), 4)
            self.assertEqual(preflight.call_count, 3)
            self.assertTrue(rows[2]["budget_terminated"])
            self.assertFalse(rows[2]["success"])
            for row in rows[:2]:
                artifact = json.loads((folder / "run" / f"{row['runId']}.json").read_text(encoding="utf-8"))
                wanted = expected[row["taskId"]]
                observed = [{k: v for k, v in message.items() if k not in {"timestamp", "turn_idx"}} for message in artifact["simulation"]["messages"] if message["role"] == "tool"]
                self.assertEqual(observed, wanted["observations"])
                self.assertEqual(artifact["verdict"], wanted["verdict"])
                self.assertEqual(row["termination"], wanted["termination"])
                self.assertTrue(row["success"] and row["serviceDrainSucceeded"])
                self.assertEqual(row["usefulCalls"], 1)
                self.assertEqual(row["speculativeCalls"], 1)
            self.assertFalse((folder / "no-provider-budget/budget.jsonl").exists())

    def test_source_archive_bytes_and_single_use_failure_retention(self):
        with tempfile.TemporaryDirectory(prefix="native-v5-freeze-", dir=ROOT / "outputs") as temporary:
            folder = Path(temporary)
            source = folder / "runtime.ts"
            source.write_bytes(b"export const value = 'exact bytes';\r\n")
            tasks = [{"domain": "retail" if index % 2 else "airline", "taskId": str(index), "familyId": f"family-{index}", "variant": 0} for index in range(4)]
            for task in tasks:
                task["fixtureHash"] = digest(task)
            manifest = {"generator": "fresh-native-v5", "nativeCommit": NATIVE_COMMIT, "studyId": "offline-source-freeze", "studyStage": "development",
                "tasks": tasks, "checks": {task["taskId"]: {"expected": True} for task in tasks}}
            manifest["manifestHash"] = digest(manifest)
            for name, value in {"manifest": manifest, "records": [], "memory": {}, "controller": {}, "legacy": {},
                "configuration": {"legacyConfigurationPath": str(folder / "legacy.json"), "controllerPath": str(folder / "controller.json")},
                "budget-report": {"totalCeilingUsd": 500, "allocations": [{"allocation": "development", "ceilingUsd": 40, "spentOrReservedUsd": 0}]}}.items():
                write(folder / f"{name}.json", value)
            budget = folder / "budget"
            budget.mkdir()
            (budget / "budget.jsonl").write_text("", encoding="utf-8")
            with patch.object(experiment_v5, "ROOT", folder), patch.object(experiment_v5, "collect_sources", return_value={"runtime.ts": source}), patch.object(experiment_v5, "preflight_v5", return_value={"expected": True}), patch.object(experiment_v5.subprocess, "check_output", return_value=NATIVE_COMMIT):
                plan = experiment_v5.prepare(*(folder / f"{name}.json" for name in ("manifest", "records", "memory", "configuration", "budget-report")),
                    budget, folder / "run", folder / "plan", "development")
                with zipfile.ZipFile(folder / "plan/source.zip") as archive:
                    self.assertEqual(archive.read("runtime.ts"), source.read_bytes())
                    self.assertEqual(hashlib.sha256(archive.read("runtime.ts")).hexdigest(), plan["runtimeSources"]["runtime.ts"]["sha256"])
                experiment_v5.verify_plan(plan, folder / "plan")
                with patch.object(native_runner_v5, "run_stage", side_effect=OSError("simulated setup failure")):
                    with self.assertRaises(OSError):
                        experiment_v5.dispatch(folder / "plan/plan.json", experiment_v5.file_digest(folder / "plan/plan.json"))
                rows = [json.loads(line) for line in (folder / "run/outcomes.jsonl").read_text(encoding="utf-8").splitlines()]
                experiment_v5.complete_grid(plan["design"], rows)
                self.assertEqual(len(rows), 16)
                self.assertTrue(all(not row["success"] for row in rows))
                with self.assertRaises(FileExistsError):
                    experiment_v5.dispatch(folder / "plan/plan.json", experiment_v5.file_digest(folder / "plan/plan.json"))
                source.write_bytes(b"changed")
                with self.assertRaisesRegex(ValueError, "runtime changed"):
                    experiment_v5.verify_plan(plan, folder / "plan")


if __name__ == "__main__":
    # Reuse pinned native user prompt, STOP and evaluator reward/parser parity tests.
    spec = importlib.util.spec_from_file_location("native_protocol_parity", ROOT / "research/goalspec/scripts/verify_official_native_v3.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    suite = unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(NativeV5Smoke),
        unittest.defaultTestLoader.loadTestsFromTestCase(module.NativeProtocolParity)])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({"version": "native-v5-offline-smoke", "tests": result.testsRun, "successful": result.wasSuccessful(), "providerCalls": 0}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
