"""Freeze ID-only official task subsets and source provenance without provider calls."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.study_v3 import prepare_study

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--memory", type=Path, default=ROOT / "research/goalspec/runs/local-memory-v3-20260915/artifact.json")
    parser.add_argument("--prior-outcomes", type=Path, action="append", default=[])
    parser.add_argument("--seed", type=int, default=20260917)
    args = parser.parse_args()
    study = prepare_study(args.output.resolve(), args.study_id, args.records.resolve(), args.prior_outcomes, args.seed, memory=args.memory)
    print(json.dumps({"studyId": study["studyId"], "studyHash": study["studyHash"], "taskPoolAudit": study["taskPoolAudit"], "providerCalls": 0}))
