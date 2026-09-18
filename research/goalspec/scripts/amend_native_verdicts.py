"""Uniform offline verifier correction. Never reruns actors or replaces failed tasks."""
# ruff: noqa: E402
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))

from tau2.data_model.message import AssistantMessage, ToolMessage, UserMessage

from goalspec.fresh_tasks import VERIFIER_VERSION, native_environment, verify_outcome


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def amend(source, fixtures, output):
    rows = [json.loads(line) for line in (source / "outcomes.jsonl").read_text(encoding="utf-8").splitlines() if line]
    design = json.loads((source / "design.json").read_text(encoding="utf-8"))
    if len(rows) != len(design["trials"]) or len({row["runId"] for row in rows}) != len(rows):
        raise ValueError("Complete frozen cohort required before uniform amendment")
    tasks = {task["taskId"]: task for task in json.loads(fixtures.read_text(encoding="utf-8"))["tasks"]}
    output.mkdir(exist_ok=False, parents=True)
    for name in ["design.json", "service-manifest.json", "public-contexts.json"]:
        (output / name).write_bytes((source / name).read_bytes())
    amended, differences = [], []
    classes = {"assistant": AssistantMessage, "user": UserMessage, "tool": ToolMessage}
    for row in rows:
        path = source / f"{row['runId']}.json"
        artifact = json.loads(path.read_text(encoding="utf-8"))
        record = tasks[row["taskId"]]
        environment = native_environment(record)
        environment.tools.db = type(environment.tools.db).model_validate(artifact["finalDatabase"])
        messages = [classes[message["role"]].model_validate(message) for message in artifact["simulation"]["messages"]]
        verdict = verify_outcome(record, artifact["independentCheck"], environment, messages)
        if row["budget_terminated"] or not row["nativeStopObserved"]:
            verdict["success"] = False
        updated = {**row, "success": verdict["success"], "constraintViolations": verdict["constraintViolations"], "verifierVersion": VERIFIER_VERSION,
                   "originalArtifactHash": file_hash(path), "originalVerdictVersion": artifact["verdict"].get("verifierVersion", artifact["independentCheck"]["evaluatorVersion"])}
        if (row["success"], row["constraintViolations"]) != (updated["success"], updated["constraintViolations"]):
            differences.append({"runId": row["runId"], "previousSuccess": row["success"], "success": updated["success"],
                                "previousViolations": row["constraintViolations"], "violations": updated["constraintViolations"]})
        write(output / path.name, {**artifact, "record": updated, "verdict": verdict, "originalVerdict": artifact["verdict"], "originalArtifactUri": str(path.resolve())})
        amended.append(updated)
    with (output / "outcomes.jsonl").open("x", encoding="utf-8") as stream:
        stream.write("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in amended))
    amendment = {"schemaVersion": 1, "verifierVersion": VERIFIER_VERSION, "verifierCodeHash": file_hash(ROOT / "research/goalspec/src/goalspec/fresh_tasks.py"),
                 "originalOutcomesHash": file_hash(source / "outcomes.jsonl"), "originalSource": str(source.resolve()), "cohortSize": len(rows),
                 "reason": "Narrow denial parsing so affirmative consent containing 'no longer needed', 'no apartment', or other non-refusal restrictions is not incorrectly denied.",
                 "actorReruns": 0, "taskReplacements": 0, "uniformAllTrials": True, "changes": differences}
    write(output / "amendment.json", amendment)
    summary = json.loads((source / "summary.json").read_text(encoding="utf-8"))
    write(output / "summary.json", {**summary, "successes": sum(row["success"] for row in amended), "verifierVersion": VERIFIER_VERSION,
                                    "originalSummaryHash": file_hash(source / "summary.json"), "verdictChanges": len(differences)})
    return amendment


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(amend(args.source, args.fixtures, args.output), indent=2))
