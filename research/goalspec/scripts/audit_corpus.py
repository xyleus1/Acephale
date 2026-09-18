"""Audit immutable corpus files without altering their existing split assignments."""
import argparse
import json
from pathlib import Path

from goalspec.corpus_audit import audit


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--threshold", type=float, default=0.8)
    args = parser.parse_args()
    report = audit(args.source, args.destination, args.threshold)
    print(json.dumps({key: value for key, value in report.items() if key != "cross_split_examples"}, indent=2))


if __name__ == "__main__":
    main()
