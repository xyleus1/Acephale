"""Publish immutable live-trial or frozen-prediction reports."""
import argparse
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from goalspec.evaluation_v1 import TrialResult, publish_live_report
from goalspec.prediction_v1 import FrozenGoal, publish_prediction_report, replay_predictions
from goalspec.requested_replay import prepare_requested_replay, publish_requested_report
from goalspec.schemas import Trajectory


def read_jsonl(path, contract):
    with Path(path).open(encoding="utf-8") as stream:
        return [contract.model_validate_json(line) for line in stream if line.strip()]


def publish_prediction_analysis_report(rows, provenance, output, *, requested_metrics=None):
    """Correct attached-reference reporting without changing frozen replay calculations."""
    if output.exists():
        raise FileExistsError(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".prediction-report-", dir=output.parent) as temporary:
        staged = Path(temporary) / "report"
        publish_prediction_report(rows, provenance, staged, requested_metrics=requested_metrics)
        if requested_metrics is not None:
            summary_path = staged / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["goalLabelLimitation"] = (
                "Endpoint-goal labels support endpoint classification and an oracle-endpoint "
                "diagnostic only. A separate automated requested-goal assessment is attached "
                "under requestedGoalAccuracy, with its checkpoint coverage and failures. "
                "Its references use visible user messages and public policy, not endpoint "
                "labels; they are not human ground truth."
            )
            summary_path.write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n", encoding="utf-8")
            manifest_path = staged / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files"]["summary.json"] = hashlib.sha256(summary_path.read_bytes()).hexdigest()
            manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        staged.rename(output)


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    live = commands.add_parser("live")
    live.add_argument("--results", type=Path, required=True)
    live.add_argument("--design", type=Path, required=True)
    live.add_argument("--output", type=Path, required=True)
    replay = commands.add_parser("prediction")
    replay.add_argument("--training", type=Path, required=True)
    replay.add_argument("--heldout", type=Path, required=True)
    replay.add_argument("--goal-cache", type=Path)
    replay.add_argument("--requested-goal-report", type=Path)
    replay.add_argument("--output", type=Path, required=True)
    queue = commands.add_parser("prepare-requests")
    queue.add_argument("--training", type=Path, required=True)
    queue.add_argument("--heldout", type=Path, required=True)
    queue.add_argument("--output", type=Path, required=True)
    requested = commands.add_parser("requested-goals")
    requested.add_argument("--queue", type=Path, required=True)
    requested.add_argument("--predictions", type=Path, required=True)
    requested.add_argument("--annotations", type=Path, required=True)
    requested.add_argument("--grades", type=Path, required=True)
    requested.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "live":
        design = json.loads(args.design.read_text(encoding="utf-8"))
        publish_live_report(read_jsonl(args.results, TrialResult), args.output, expected=design["trials"])
    elif args.command == "prediction":
        rows, provenance = replay_predictions(
            read_jsonl(args.training, Trajectory), read_jsonl(args.heldout, Trajectory),
            frozen_goals=read_jsonl(args.goal_cache, FrozenGoal) if args.goal_cache else None,
        )
        publish_prediction_analysis_report(rows, provenance, args.output,
                                           requested_metrics=json.loads(args.requested_goal_report.read_text(encoding="utf-8")) if args.requested_goal_report else None)
    elif args.command == "prepare-requests":
        prepare_requested_replay(read_jsonl(args.training, Trajectory), read_jsonl(args.heldout, Trajectory), args.output)
    else:
        publish_requested_report(args.queue, args.predictions, args.annotations, args.grades, args.output)
    artifact = "queue.jsonl" if args.command == "prepare-requests" else "report.md"
    artifact_key = "queue" if args.command == "prepare-requests" else "report"
    print(json.dumps({"status": "complete", artifact_key: str(args.output / artifact)}))


if __name__ == "__main__":
    main()
