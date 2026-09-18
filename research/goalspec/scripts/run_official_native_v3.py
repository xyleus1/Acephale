"""Consume one bounded official-task stage and retain every declared trial outcome."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.official_native import retain_stage_failure, run_stage
from goalspec.study_v3 import STAGES, claim_stage, complete_stage

if __name__ == "__main__":
    if not sys.flags.utf8_mode:
        raise SystemExit("Use the pinned native interpreter with -X utf8 to preserve upstream prompt bytes on Windows")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--stage", choices=STAGES, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--budget-directory", type=Path, required=True)
    parser.add_argument("--budget-report", type=Path, required=True)
    parser.add_argument("--runtime-freeze", type=Path, required=True)
    parser.add_argument("--runtime-config", type=Path, required=True)
    args = parser.parse_args()
    design = claim_stage(args.study, args.stage, args.output, args.budget_report, args.runtime_freeze, args.runtime_config)
    aborted = False
    try:
        run_stage(args.study, design, args.output, args.budget_directory)
    except Exception as error:
        aborted = True
        retain_stage_failure(args.study, design, args.output, args.budget_directory, error)
    print(json.dumps(complete_stage(args.study, args.stage)))
    if aborted:
        raise SystemExit(1)
