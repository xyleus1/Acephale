"""Zero-provider native fixture and independent-verifier integration checks."""
# ruff: noqa: E402
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
import dotenv

dotenv.load_dotenv = lambda *args, **kwargs: False
from tau2.data_model.message import AssistantMessage, ToolCall, UserMessage

from goalspec.fresh_tasks import native_environment, verify_outcome
from goalspec.fresh_tasks_v4 import make_manifest
from goalspec.study_v2 import write


def validate():
    rows = []
    for stage in ("development", "confirmation"):
        manifest = make_manifest("v4-native-preflight-validation", stage)
        for fixture in manifest["tasks"]:
            check = manifest["checks"][fixture["taskId"]]
            environment = native_environment(fixture)
            messages = [AssistantMessage(role="assistant", content="I will perform exactly the requested changes and preserve the other records. Please confirm."),
                        UserMessage(role="user", content="Yes, I confirm those exact changes and costs.")]
            for index, reference in enumerate(fixture["referenceActions"]):
                call = ToolCall(id=f"reference-{index}", **reference)
                messages.append(AssistantMessage(role="assistant", tool_calls=[call]))
                result = environment.get_response(call)
                assert not result.error
            messages.append(AssistantMessage(role="assistant", content=" ".join(fixture["responsePatterns"]) or "All requested changes have been completed."))
            good = verify_outcome(fixture, check, environment, messages)
            assert good["success"], (fixture["taskId"], good)
            missing_confirmation_rejected = None
            if fixture["referenceActions"]:
                denied = verify_outcome(fixture, check, environment, [message for message in messages if message.role != "user"])
                missing_confirmation_rejected = not denied["success"] and denied["constraintViolations"] > 0
                assert missing_confirmation_rejected
            user = next(iter(environment.tools.db.users.values()))
            user.address.address1 = "Unrequested changed protected address"
            wrong_state = verify_outcome(fixture, check, environment, messages)
            assert not wrong_state["success"] and not wrong_state["stateMatch"]
            rows.append({"taskId": fixture["taskId"], "branch": fixture["branch"], "referenceSuccess": True,
                         "missingConfirmationRejected": missing_confirmation_rejected, "unrequestedStateChangeRejected": True})
    return {"version": "goalspec-native-preflight-v4", "paidCalls": 0, "passed": True, "fixtures": rows,
            "cases": len(rows), "limitation": "Verifier integration and reference feasibility only, not actor performance"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = validate()
    if args.output:
        write(args.output, result)
    print(json.dumps(result))
