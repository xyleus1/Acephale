"""Preflight all v2 candidate fixtures and freeze the bounded study before paid work."""
# ruff: noqa: E402
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.study_v2 import prepare_study

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260916)
    args = parser.parse_args()
    study = prepare_study(args.output.resolve(), args.study_id, args.records.resolve(), args.seed)
    print(json.dumps({"studyId": study["studyId"], "studyHash": study["studyHash"], "fixtures": study["fixtures"], "paidCalls": 0}))
