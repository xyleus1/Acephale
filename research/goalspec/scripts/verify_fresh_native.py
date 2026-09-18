"""Independent-check falsification fixtures; no provider calls."""
# ruff: noqa: E402
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))

from tau2.data_model.message import AssistantMessage, ToolCall, UserMessage

from goalspec.fresh_tasks import build_tasks, native_environment, preflight, verify_outcome


def verify():
    tasks = build_tasks()
    count = 0
    for record in tasks:
        if not record["referenceActions"]:
            environment = native_environment(record)
            check = preflight(record)
            assert not verify_outcome(record, check, environment, [])['success']
            count += 1
            continue
        environment = native_environment(record)
        check = preflight(record)
        assert not verify_outcome(record, check, environment, [])['success']
        # Actual fixture mutations without user consent must fail independently.
        calls = [ToolCall(id=f"actual-{index}", **reference) for index, reference in enumerate(record["referenceActions"])]
        messages = []
        for call in calls:
            environment.get_response(call)
            messages.append(AssistantMessage(role="assistant", tool_calls=[call]))
        without_consent = verify_outcome(record, check, environment, messages)
        assert not without_consent["success"] and without_consent["constraintViolations"] == len(calls)
        consent = [AssistantMessage(role="assistant", content="Please confirm these exact requested changes and their stated costs."),
                   UserMessage(role="user", content="Yes, I confirm the proposed changes."), *messages]
        with_consent = verify_outcome(record, check, environment, consent)
        assert with_consent["stateMatch"] and with_consent["constraintViolations"] == 0
        denied = [AssistantMessage(role="assistant", content="Please confirm these exact requested changes and their stated costs."),
                  UserMessage(role="user", content="I do not confirm. Do not proceed."), *messages]
        assert verify_outcome(record, check, environment, denied)["constraintViolations"] == len(calls)
        count += 1
    return {"tasksChecked": count, "providerCalls": 0, "checks": ["untouched state cannot satisfy mutation", "silence cannot satisfy information", "missing confirmation fails", "denial is not consent"]}


if __name__ == "__main__":
    print(json.dumps(verify()))
