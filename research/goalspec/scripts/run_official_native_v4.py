"""Verify or consume one immutable official-task v4 paired cohort plan."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from goalspec.official_native_v4 import run_plan, verify_plan
from goalspec.source_freeze import file_digest
from goalspec.study_v2 import read

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if file_digest(args.plan) != args.expected_sha256:
        raise SystemExit("Exact dispatch plan SHA256 required")
    if args.verify_only:
        verify_plan(read(args.plan), args.plan.parent)
        print(json.dumps({"verified": True, "providerCalls": 0}))
    else:
        if not sys.flags.utf8_mode:
            raise SystemExit("Use the pinned native interpreter with -X utf8")
        print(json.dumps(run_plan(args.plan, args.expected_sha256)))
