"""Run in the pinned native venv; creates fixtures and validates all reference paths."""
# ruff: noqa: E402
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))

from goalspec.fresh_tasks import write_manifest

if __name__ == "__main__":
    path, manifest = write_manifest(Path(sys.argv[1]).resolve())
    print(json.dumps({"manifest": str(path), "tasks": len(manifest["tasks"]), "referenceChecks": len(manifest["checks"]),
                      "manifestHash": manifest["manifestHash"], "label": manifest["label"]}))
