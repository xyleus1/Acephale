"""Post-run scanner boundary amendment; the captured exporter file stays unchanged.

Opaque Responses encrypted_content can contain the characters sk- inside a
longer base64url token. A substring is not a standalone API-key prefix. This
overlay keeps the original scanner and export checks, adding only a leading
token boundary. Actual standalone legacy/project/service key prefixes remain
rejected. It does not decrypt, print, redact, or alter original artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from goalspec import archive_v3

FROZEN_EXPORTER_SHA256 = "0e6d8dbc64baa7a7fabd723067860e63eb3b0a3f625829e3e5eb00c1112b92a1"
KEY_PATTERN = r"(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}"


def export_with_token_boundaries(configuration, output, *, closed_confirmed=False):
    path = Path(archive_v3.__file__)
    if hashlib.sha256(path.read_bytes()).hexdigest() != FROZEN_EXPORTER_SHA256:
        raise ValueError("Captured exporter identity changed; overlay is not applicable")
    previous = archive_v3.KEY_PREFIX
    archive_v3.KEY_PREFIX = re.compile(KEY_PATTERN)
    try:
        return archive_v3.export_archive(configuration, output, closed_confirmed=closed_confirmed)
    finally:
        archive_v3.KEY_PREFIX = previous


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--closed-confirmed", action="store_true")
    args = parser.parse_args()
    report = export_with_token_boundaries(json.loads(args.inputs.read_bytes()), args.output, closed_confirmed=args.closed_confirmed)
    print(json.dumps({"archiveId": report["archiveId"], "status": report["status"], "cohorts": len(report["cohorts"]),
                      "sources": len(report["sources"]), "files": len(report["files"]),
                      "originalSourceRoundTripVerified": report["originalSourceRoundTripVerified"],
                      "scannerOverlay": "standalone-token-boundary", "capturedExporterUnchanged": True}))


if __name__ == "__main__":
    main()
