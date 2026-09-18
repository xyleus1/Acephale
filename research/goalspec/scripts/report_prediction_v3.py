from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from goalspec.prediction_report_v3 import write_report

parser = argparse.ArgumentParser(description="Offline closed v3 prediction replay confidence intervals")
parser.add_argument("replay_directory")
parser.add_argument("new_output_directory")
parser.add_argument("--samples", type=int, default=5000)
parser.add_argument("--seed", type=int, default=20260915)
args = parser.parse_args()
report = write_report(args.replay_directory, args.new_output_directory, samples=args.samples, seed=args.seed)
print(json.dumps({"output": str(Path(args.new_output_directory).resolve()), "decisions": report["decisions"],
                  "taskFamilies": report["taskFamilies"], "paidApiCalls": 0, "ledgerOpened": False}))
