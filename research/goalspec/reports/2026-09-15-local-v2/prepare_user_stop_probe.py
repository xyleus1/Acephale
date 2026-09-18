"""Prepare six archived development user turns, without provider dispatch."""
from __future__ import annotations

import hashlib
import ast
import inspect
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ["LOGURU_LEVEL"] = "ERROR"
# Native imports normally call load_dotenv. This offline preparation never loads credentials.
import dotenv  # noqa: E402
dotenv.load_dotenv = lambda *args, **kwargs: False

from goalspec.fresh_tasks import digest  # noqa: E402
from goalspec.native_live import build_user_policy  # noqa: E402
from tau2.data_model.message import AssistantMessage, UserMessage  # noqa: E402
from tau2.user.user_simulator import UserSimulator  # noqa: E402

READS = next(ast.literal_eval(node.value) for node in ast.parse(
    (ROOT / "research/goalspec/src/goalspec/training_export.py").read_text(encoding="utf-8")).body
    if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "READS" for target in node.targets))

RUNS = [
    ("v2-df424bd6f3-development-2-0011-085570d010b1", False),
    ("v2-df424bd6f3-development-2-0012-edccac56851d", False),
    ("v2-df424bd6f3-development-2-0017-1ce332c4caa4", False),
    ("v2-df424bd6f3-development-2-0018-cf1aed9cce54", False),
    ("v2-df424bd6f3-development-2-0000-695ee8fa9f3b", True),
    ("v2-df424bd6f3-development-2-0013-6e294418e7bf", True),
]


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def source(path):
    return {"path": path.relative_to(ROOT).as_posix(),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: prepare_user_stop_probe.py NEW_OUTPUT_DIRECTORY")
    output = Path(sys.argv[1]).resolve()
    if output.parent != ROOT / "research/goalspec/runs":
        raise ValueError("Probe output must be a new direct child of research/goalspec/runs")
    fixture_path = ROOT / "research/goalspec/runs/local-study-v2-20260915/development-2-fixtures.json"
    fixtures = read(fixture_path)
    if fixtures["studyStage"] != "development-2" or digest({k: v for k, v in fixtures.items() if k != "manifestHash"}) != fixtures["manifestHash"]:
        raise ValueError("Development fixture provenance mismatch")
    tasks = {r["taskId"]: r for r in fixtures["tasks"]}
    native_dir = ROOT / "research/goalspec/runs/local-v2-development-2-20260915"
    rows, inputs = [], [source(fixture_path)]
    guidance = build_user_policy("", is_v2=True)[2:]
    for position, (run_id, expected_stop) in enumerate(RUNS):
        path = native_dir / f"{run_id}.json"
        native = read(path)
        record, original = native["record"], native["simulation"]["messages"]
        if record["studyStage"] != "development-2" or record["runId"] != run_id or record["success"] != expected_stop:
            raise ValueError("Archived case identity or outcome mismatch")
        target_index = len(original) - 1
        target = UserMessage.model_validate(original[target_index])
        if not UserSimulator.is_stop(target) or "###STOP###" not in (target.content or ""):
            raise ValueError("Case must target the archived final user stop response")
        prefix = original[:target_index]
        history = []
        history_indexes = []
        for index, message in enumerate(prefix):
            if message["role"] == "user":
                history.append(UserMessage.model_validate(message))
                history_indexes.append(index)
            elif message["role"] == "assistant" and not message.get("tool_calls") and message.get("content"):
                history.append(AssistantMessage.model_validate(message))
                history_indexes.append(index)
            elif message["role"] == "tool" and message.get("recipient") == "user":
                raise ValueError("Unexpected user-tool message in a no-tool probe")
        if not history or history[-1].role != "assistant":
            raise ValueError("Probe boundary must follow the assistant's public response")
        writes = [call for message in prefix for call in message.get("tool_calls") or []
                  if call["name"] not in READS[record["domain"]]]
        if (not expected_stop and writes) or (expected_stop and not writes):
            raise ValueError("Pending/completed control does not have the expected write history")
        task = tasks[record["taskId"]]
        simulator = UserSimulator(llm="gpt-4.1-mini-2025-04-14", instructions=task["userInstructions"])
        state = simulator.get_init_state(message_history=history)
        messages = [{"role": item.role, "content": item.content or ""} for item in state.flip_roles()]
        # This independently checks exactly the text and role mapping sent by ExternalUser.
        assert messages == [{"role": "assistant" if item.role == "user" else "user", "content": item.content or ""} for item in history]
        base = simulator.system_prompt
        policy = build_user_policy(base, is_v2=True)
        assert policy == base + "\n\n" + guidance
        boundary = {"messages": messages, "policy": policy, "tools": []}
        row = {"schemaVersion": "user-stop-probe-v1", "id": f"v2-user-stop-probe:{position}:{digest(boundary)[:24]}",
               "sourceRunId": run_id, "familyId": record["familyId"], "sourceArm": record["arm"],
               "sourceOutcomeSuccess": record["success"], "expectedStop": expected_stop,
               "classification": "completed_task_control" if expected_stop else "confirmation_must_continue",
               "sourceRecord": source(path), "fixtureHash": task["fixtureHash"], "taskId": task["taskId"],
               "targetMessageIndex": target_index, "visibleNativeMessageIndexes": history_indexes,
               "sourcePrefixHash": digest(prefix), "archivedTarget": original[target_index],
               "userInstructionsHash": digest(task["userInstructions"]), "basePolicy": base, "basePolicyHash": digest(base),
               "policyHash": digest(policy), "protocol": "v2-user-completion-guidance-v1",
               "boundary": boundary, "boundaryHash": digest(boundary)}
        rows.append(row)
        inputs.append(source(path))
    output.mkdir(parents=False, exist_ok=False)
    cases_path = output / "cases.jsonl"
    with cases_path.open("x", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    manifest = {"schemaVersion": "user-stop-probe-v1", "studyStage": "development-prompt-probe",
                "isNativeCohort": False, "caseCount": 6, "expectedContinue": 4, "expectedStop": 2,
                "selection": "First four dev2 premature-stop failures in native design order; first successful completion in each domain. All selected before probe dispatch; all six retained.",
                "scope": "Previously observed development turns only. Tests termination guidance, not task success or native grading. Original outcomes unchanged.",
                "stateConstruction": "Native UserSimulator.get_init_state over prior user and non-tool assistant messages, followed by state.flip_roles; target response excluded. Native actor tool exchanges are not visible to the user simulator.",
                "guidance": guidance, "guidanceHash": digest(guidance),
                "helperSource": inspect.getsource(build_user_policy),
                "helperSourceHash": digest(inspect.getsource(build_user_policy)),
                "sourceInputs": inputs, "casesSha256": source(cases_path)["sha256"], "casesHash": digest(rows),
                "request": {"model": "gpt-4.1-mini-2025-04-14", "allocation": "development", "maxOutputTokens": 1024,
                            "nativeInputCap": 8192, "nativeInputMargin": 128, "retries": 0, "concurrency": 1},
                "noProviderCallsDuringPreparation": True}
    with (output / "manifest.json").open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"output": str(output), "cases": len(rows), "casesHash": manifest["casesHash"]}))


if __name__ == "__main__":
    main()
