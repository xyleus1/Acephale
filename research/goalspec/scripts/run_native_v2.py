"""Claim and run one precommitted v2 stage; claims remain consumed after failure."""
# ruff: noqa: E402
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.native_live import run_phase
from goalspec.study_v2 import STAGES, claim_stage, complete_stage, load_study

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--stage", choices=STAGES, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--budget-directory", type=Path, required=True)
    parser.add_argument("--budget-report", type=Path, required=True)
    parser.add_argument("--runtime-freeze", type=Path)
    parser.add_argument("--concurrency", type=int, choices=[3], default=3)
    args = parser.parse_args()
    study = load_study(args.study)
    fixtures, design = claim_stage(args.study, args.stage, args.output, args.budget_report, args.runtime_freeze)
    run_phase(fixtures, args.output, "heldout" if args.stage == "confirmation" else "development", args.budget_directory,
              Path(study["frozenLibrary"]["recordsPath"]), None, study["maxSteps"], study["seed"], args.concurrency,
              frozen_design_path=design)
    print(json.dumps(complete_stage(args.study, args.stage)))
