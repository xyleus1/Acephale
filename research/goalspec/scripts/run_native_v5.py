"""Prepare an immutable v5 stage, then dispatch that exact plan once."""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
import dotenv
dotenv.load_dotenv = lambda *args, **kwargs: False
from goalspec.experiment_v5 import prepare, dispatch
from goalspec.source_freeze import file_digest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("prepare")
    for name in ("manifest", "records", "memory", "configuration", "budget-report", "budget-directory", "output", "plan-directory"):
        setup.add_argument("--" + name, type=Path, required=True)
    setup.add_argument("--stage", choices=("training", "development", "confirmation"), required=True)
    setup.add_argument("--development-directory", type=Path)
    setup.add_argument("--seed", type=int, default=20260919)
    run = commands.add_parser("dispatch")
    run.add_argument("--plan", type=Path, required=True)
    run.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        plan = prepare(args.manifest, args.records, args.memory, args.configuration, args.budget_report,
            args.budget_directory, args.output, args.plan_directory, args.stage,
            development_directory=args.development_directory, seed=args.seed)
        print(json.dumps({"path": str(args.plan_directory / "plan.json"), "sha256": file_digest(args.plan_directory / "plan.json"),
            "trials": len(plan["design"]["trials"]), "reservedUsd": plan["design"]["reserved_usd"], "paidCalls": 0}))
    else:
        print(json.dumps(dispatch(args.plan, args.expected_sha256), indent=2))
