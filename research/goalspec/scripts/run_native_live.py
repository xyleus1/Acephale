"""Run inside the pinned native Python venv; provider credentials are inherited only."""
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

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phase", choices=["train", "development", "heldout"], required=True)
    parser.add_argument("--budget-directory", type=Path, required=True)
    parser.add_argument("--records", type=Path)
    parser.add_argument("--development", type=Path)
    parser.add_argument("--max-steps", type=int, default=40)
    parser.add_argument("--seed", type=int, default=20260915)
    parser.add_argument("--concurrency", type=int, choices=[1, 2, 3], default=3)
    args = parser.parse_args()
    print(json.dumps(run_phase(args.manifest, args.output, args.phase, args.budget_directory,
                               args.records, args.development, args.max_steps, args.seed, args.concurrency), indent=2))
