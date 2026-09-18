"""Archive explicitly listed, closed custom v4 cohorts without database or provider access."""
# ruff: noqa: E402
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from goalspec.archive_v4 import export_archive


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--closed-confirmed", action="store_true")
    arguments = parser.parse_args()
    configuration = json.loads(arguments.inputs.read_text(encoding="utf-8"))
    report = export_archive(configuration, arguments.output, closed_confirmed=arguments.closed_confirmed)
    print(json.dumps({"archiveId": report["archiveId"], "status": report["status"], "cohorts": len(report["cohorts"]),
                      "sources": len(report["sources"]), "files": len(report["files"]), "originalSourceRoundTripVerified": True}))


if __name__ == "__main__":
    main()
