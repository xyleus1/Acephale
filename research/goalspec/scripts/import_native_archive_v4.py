"""Inspect a closed v4 archive or import it through the installed Prisma bridge."""
# ruff: noqa: E402
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from goalspec.archive_import_v4 import verify_archive


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("inspect", "import"))
    parser.add_argument("archive", type=Path)
    parser.add_argument("manifest_sha256")
    parser.add_argument("receipt", type=Path, nargs="?")
    args = parser.parse_args()
    if args.command == "inspect":
        print(json.dumps(verify_archive(args.archive, args.manifest_sha256)))
        return
    if args.receipt is None:
        parser.error("import requires a new receipt path")
    # The bridge invokes this same verifier in inspect mode before constructing
    # PrismaClient. URL remains solely in the inherited environment.
    result = subprocess.run(["node", "--import", "tsx", str(ROOT / "scripts/goalspec-import-archive-v4.ts"),
                             "import", str(args.archive.resolve()), args.manifest_sha256, str(args.receipt.resolve())], cwd=ROOT, check=False)
    if result.returncode:
        raise SystemExit(result.returncode)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Driver errors and malformed archival values may contain private data.
        print("Archive verification/import failed; no private values or database diagnostics were logged.", file=sys.stderr)
        raise SystemExit(1)
