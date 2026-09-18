"""Generate a new immutable report from explicitly selected, closed local cohorts."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from goalspec.report_v4 import write_report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    report = write_report(args.plan, args.output, args.expected_sha256)
    print(json.dumps({"output": args.output, "cohorts": len(report["cohorts"]), "version": report["version"]}))


if __name__ == "__main__":
    main()
