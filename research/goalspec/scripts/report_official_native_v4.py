"""Produce a new offline report from a closed official-task v4 paired cohort."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from goalspec.report_official_v4 import write_report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--events", type=Path, action="append", default=[])
    parser.add_argument("--bootstrap-samples", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20260916)
    args = parser.parse_args()
    report = write_report(args.run_directory, args.output, args.events, samples=args.bootstrap_samples, seed=args.seed)
    print(json.dumps({"output": str(args.output.resolve()), "trials": len(report["trials"]), "version": report["version"]}))
