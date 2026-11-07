"""Finalize a research database JSONL export with verified Parquet artifacts."""
import argparse
import json
from pathlib import Path

from acephale.artifact_export import convert_export


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--budget", type=Path)
    args = parser.parse_args()
    manifest = convert_export(args.directory, args.budget)
    print(json.dumps({key: manifest[key] for key in ["status", "tables", "tableRows", "parquetRoundTripVerified"]}))


if __name__ == "__main__":
    main()
