"""Preflight all v5 training/development fixtures before any actor execution."""
# ruff: noqa: E402
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ["LOGURU_LEVEL"] = "ERROR"
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
sys.path.insert(0, str(ROOT / "research/goalspec/src"))
import dotenv

dotenv.load_dotenv = lambda *args, **kwargs: False
from goalspec.fresh_tasks import digest
from goalspec.fresh_tasks_v5 import FAMILIES, family_splits, write_manifest

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--study-id", required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    manifests = {}
    for stage in ("training", "development"):
        path, manifest = write_manifest(args.output / stage, args.study_id, stage)
        manifests[stage] = {"path": str(path.resolve()), "manifestHash": manifest["manifestHash"], "tasks": len(manifest["tasks"])}
    study = {"version": "goalspec-custom-study-v5", "studyId": args.study_id, "familySplit": FAMILIES,
             "learningFamilySplit": family_splits(), "fixtures": manifests,
             "userProtocol": "unchanged-upstream-user-simulator", "label": "custom tau-compatible pilot",
             "paidCalls": 0}
    study["studyHash"] = digest(study)
    with (args.output / "study.json").open("x", encoding="utf-8") as stream:
        json.dump(study, stream, indent=2)
        stream.write("\n")
    print(json.dumps(study))
