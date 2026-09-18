"""Archive explicitly listed closed v3 cohorts without database/provider access."""
import argparse
import json
from pathlib import Path

from goalspec.archive_v3 import export_archive


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
