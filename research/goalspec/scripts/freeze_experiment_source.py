"""Freeze actual worktree bytes before held-out evaluation; verify after it ends."""
import argparse
import json
from pathlib import Path

from goalspec.source_freeze import freeze_source, verify_source


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    freeze = commands.add_parser("freeze")
    freeze.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    freeze.add_argument("--output", type=Path, required=True)
    freeze.add_argument("--fixtures", type=Path, required=True)
    freeze.add_argument("--records", type=Path, required=True)
    freeze.add_argument("--development-design", type=Path, required=True)
    freeze.add_argument("--development-outcomes", type=Path, required=True)
    freeze.add_argument("--input", action="append", default=[], help="Additional frozen input as label=path; hashed only")
    verify = commands.add_parser("verify")
    verify.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    verify.add_argument("--frozen", type=Path, required=True)
    verify.add_argument("--output", type=Path, required=True, help="New immutable verification report file")
    args = parser.parse_args()
    if args.command == "freeze":
        inputs = {"fixtures": args.fixtures, "records": args.records,
                  "development_design": args.development_design, "development_outcomes": args.development_outcomes}
        for specification in args.input:
            label, separator, path = specification.partition("=")
            if not separator or not label or label in inputs:
                raise ValueError("Extra inputs need unique label=path entries")
            inputs[label] = Path(path)
        result = freeze_source(args.root, args.output, inputs)
        print(json.dumps({"status": "frozen", "sourceFiles": len(result["sources"]), "sourceTreeHash": result["sourceTreeHash"], "calibration": result["developmentCostCalibration"]}, indent=2))
    else:
        result = verify_source(args.root, args.frozen)
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2)
            stream.write("\n")
        print(json.dumps(result, indent=2))
        if not result["passed"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
