"""Archive the v3 runtime and immutable stage inputs before any paid dispatch."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
from goalspec.source_freeze_v3 import freeze_stage
from goalspec.study_v3 import STAGES

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--stage", choices=STAGES, required=True)
    parser.add_argument("--runtime-config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = freeze_stage(ROOT, args.output, args.study, args.stage, args.runtime_config)
    print(json.dumps({"sourceTreeHash": manifest["sourceTreeHash"], "stage": args.stage, "providerCalls": 0}))
