"""Write an offline report from a closed official native cohort to a new directory."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.report_v3 import write_report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--events", type=Path, action="append", default=[], help="Closed native event JSONL file; repeat for separate service logs")
    parser.add_argument("--v2-directory", type=Path, help="Optional, separately labeled historical custom-task cohort")
    parser.add_argument("--bootstrap-samples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20260915)
    args = parser.parse_args()
    result = write_report(args.run_directory, args.output, args.events, samples=args.bootstrap_samples,
                          seed=args.seed, v2_directory=args.v2_directory)
    print(json.dumps({"output": str(args.output.resolve()), "studyId": result["studyId"], "studyStage": result["studyStage"],
                      "trials": len(result["trials"]), "arms": {arm: value["successes"] for arm, value in result["arms"].items()}}))
