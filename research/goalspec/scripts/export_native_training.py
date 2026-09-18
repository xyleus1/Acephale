"""Run with the research venv after all training trials have terminal outcomes."""
import argparse
import json
from pathlib import Path

from goalspec.training_export import export_native

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phase", choices=["train", "development", "heldout"], default="train")
    args = parser.parse_args()
    print(json.dumps(export_native(args.source, args.fixtures, args.output, args.phase), indent=2))
