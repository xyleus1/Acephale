"""Prepare a reviewed, frozen plan, or dispatch its exact hash through the shared ledger."""
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
from goalspec.native_live_v4 import prepare_plan, run_plan
from goalspec.source_freeze import file_digest

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare")
    for name in ("manifest", "records", "memory", "configuration", "budget-report", "budget-directory", "output", "plan-directory"):
        prepare.add_argument("--" + name, type=Path, required=True)
    prepare.add_argument("--development", type=Path)
    prepare.add_argument("--seed", type=int, default=20260918)
    dispatch = sub.add_parser("dispatch")
    dispatch.add_argument("--plan", type=Path, required=True)
    dispatch.add_argument("--expected-sha256", required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        result = prepare_plan(args.manifest, args.records, args.memory, args.configuration, args.budget_report,
                              args.budget_directory, args.output, args.plan_directory, args.development, args.seed)
        print(json.dumps({"plan": str((args.plan_directory / "plan.json").resolve()), "sha256": file_digest(args.plan_directory / "plan.json"),
                          "trials": len(result["design"]["trials"]), "reservedUsd": result["design"]["reserved_usd"], "paidCalls": 0}))
    else:
        print(json.dumps(run_plan(args.plan, args.expected_sha256), indent=2))
