import argparse
import json
from pathlib import Path

from goalspec.controller_v4 import train_controller

parser = argparse.ArgumentParser()
parser.add_argument("dataset", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--schema", type=Path, default=Path("src/lib/goalspec/contracts/v4-controller.schema.json"))
parser.add_argument("--seed", type=int, default=43117)
args = parser.parse_args()
print(json.dumps(train_controller(args.dataset, args.output, args.schema, args.seed), indent=2))
