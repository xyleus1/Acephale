"""Copy small frozen artifacts verbatim, preserving their original path references."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from goalspec.storage import content_hash, file_hash

REPLAY_OUTPUTS = {"gates.json", "goal-backend.json", "initial-goals.jsonl", "observations.jsonl", "predictions.jsonl"}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def archive(cohort: Path, bundle: Path, runs: list[tuple[str, Path]], output: Path) -> None:
    if output.exists():
        raise ValueError("Choose a new immutable evidence directory")
    split = read_json(cohort / "split.json")
    manifest = read_json(bundle / "manifest.json")
    if manifest["split_hash"] != content_hash(split) or manifest["corpus_hash"] != split["corpus_hash"]:
        raise ValueError("Training bundle/split mismatch")
    sources = [(cohort / "split.json", Path("split.json")),
               (cohort / "public-cohort-manifest.json", Path("public-cohort-manifest.json")),
               (bundle / "manifest.json", Path("training-manifest.json")),
               (bundle / "goals.json", Path("training-goals.json"))]
    for name, expected in manifest["artifact_hashes"].items():
        if file_hash(bundle / name) != expected:
            raise ValueError(f"Training artifact SHA-256 mismatch: {name}")
    omitted = [{"source_path": str((bundle / "patterns.json").resolve()),
                "sha256": manifest["artifact_hashes"]["patterns.json"],
                "reason": "Large trained pattern artifact remains local; reproduce using the fit command."}]
    for label, directory in runs:
        if not label or Path(label).name != label or label in {".", ".."}:
            raise ValueError("Run labels must be plain directory names")
        run, summary = read_json(directory / "run.json"), read_json(directory / "summary.json")
        if run["status"] != "complete" or run["summary_hash"] != file_hash(directory / "summary.json"):
            raise ValueError(f"Run is incomplete or summary changed: {label}")
        if run["corpus_hash"] != split["corpus_hash"] or run["split_hash"] != content_hash(split):
            raise ValueError(f"Run uses a different cohort: {label}")
        if summary["source_hash"] != manifest["source_hash"] or summary["training_manifest_hash"] != content_hash(manifest):
            raise ValueError(f"Run uses a different source/training manifest: {label}")
        if set(summary["output_hashes"]) != REPLAY_OUTPUTS:
            raise ValueError(f"Unexpected replay output artifact set: {label}")
        for name, expected in summary["output_hashes"].items():
            if file_hash(directory / name) != expected:
                raise ValueError(f"Replay output SHA-256 mismatch: {label}/{name}")
        copied = {"run.json", "summary.json", "gates.json", "goal-backend.json", "initial-goals.jsonl"}
        sources.extend((directory / name, Path("runs") / label / name) for name in sorted(copied))
        omitted.extend({"source_path": str((directory / name).resolve()),
                        "sha256": summary["output_hashes"][name],
                        "reason": "Large event-level output remains local; its hash is bound by the archived summary."}
                       for name in sorted(REPLAY_OUTPUTS - copied))
    for partition in ("development", "test"):
        directory = cohort / f"classifier-{partition}"
        capture, backend = read_json(directory / "capture.json"), read_json(directory / "backend.json")
        if capture["status"] != "complete" or backend["cache_sha256"] != file_hash(directory / "capture.json"):
            raise ValueError(f"Classifier is incomplete or cache changed: {partition}")
        if backend["model"] != capture["model"] or capture["split_sha256"] != content_hash(split):
            raise ValueError(f"Classifier model/split mismatch: {partition}")
        sources.extend((directory / name, Path(f"classifier-{partition}") / name) for name in ("capture.json", "backend.json"))
        omitted.append({"source_path": str(directory.resolve()), "reason": "Per-request prompt.txt/events.jsonl remain local; exact hashes are in each capture batch and were verified by classifier_usage.py."})
    if len({relative.as_posix() for _, relative in sources}) != len(sources):
        raise ValueError("Duplicate evidence output path")
    output.mkdir(parents=True)
    mapping = []
    for source, relative in sources:
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        digest = file_hash(source)
        if file_hash(destination) != digest:
            raise ValueError(f"Evidence copy did not preserve bytes: {source}")
        mapping.append({"source_path": str(source.resolve()), "archived_path": relative.as_posix(),
                        "sha256": digest, "bytes": source.stat().st_size})
    (output / "path-mapping.json").write_text(json.dumps({"schema_version": 1, "source_sha256": manifest["source_hash"],
        "copied_without_rewriting": mapping, "omitted_large_artifacts": omitted}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / ".gitattributes").write_text("# Preserve provenance-bound bytes across platform checkouts.\n* -text\n", encoding="utf-8")
    (output / "README.md").write_text(
        "# Frozen replay evidence\n\n"
        "These are byte-for-byte copies of the completed run manifests, summaries, gates, goal-backend records, "
        "initial goal scores, grouped split, training manifest/catalog, and classifier captures/configurations. "
        "`path-mapping.json` records original paths, archived paths, byte counts and SHA-256 hashes. "
        "Absolute paths inside the original JSON were preserved.\n\n"
        "Classifier captures contain the frozen posteriors and per-request usage/hash records. "
        "Their prompt/event transcripts remain in the original local run directories; the classifier usage audit "
        "verified those hashes and native generation outputs before publication. "
        "To use a copied classifier cache elsewhere, create a new backend configuration pointing to its new "
        "location and preserve the cache SHA-256. Do not silently edit this evidence.\n\n"
        "Large source corpora, trained patterns and event-level replay outputs remain local. "
        "Hashes and reproduction commands identify them. These small artifacts support inspection of the reported "
        "numbers and reuse of cached goal posteriors; replaying tool predictions still requires the "
        "source corpus, matching pattern artifact and frozen implementation. "
        "The public replay gate remains ineligible for live scheduling and SOTA claims.\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(output), "copied_files": len(mapping), "copied_bytes": sum(row["bytes"] for row in mapping)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--run", action="append", required=True, help="LABEL=completed-run-directory")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    parsed = []
    for value in args.run:
        label, separator, directory = value.partition("=")
        if not separator:
            parser.error("--run must be LABEL=directory")
        parsed.append((label, Path(directory)))
    archive(args.cohort, args.bundle, parsed, args.output)
