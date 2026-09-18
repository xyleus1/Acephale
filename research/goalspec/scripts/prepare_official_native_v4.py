"""Create a frozen, fully paired official-task v4 plan without provider calls."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from goalspec.official_native_v4 import prepare_plan
from goalspec.source_freeze import file_digest

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("selection", "previous-dispatch-plan", "previous-service-manifest", "budget-report",
                 "budget-directory", "output", "plan-directory"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--calibration-directory", type=Path, action="append", required=True)
    args = parser.parse_args()
    plan = prepare_plan(args.selection, args.calibration_directory, args.previous_dispatch_plan,
                        args.previous_service_manifest, args.budget_report, args.budget_directory,
                        args.output, args.plan_directory)
    print(json.dumps({"planPath": str((args.plan_directory / "plan.json").resolve()),
                      "planSha256": file_digest(args.plan_directory / "plan.json"),
                      "trials": len(plan["design"]["trials"]), "reservedUsd": plan["design"]["reserved_usd"], "providerCalls": 0}))
