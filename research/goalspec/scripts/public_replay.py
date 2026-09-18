"""Recreate the frozen public four-domain replay corpus without provider keys.

uv run python scripts/public_replay.py --native-root .benchmarks/tau3 \
    --output runs/public-pilot-20260911 --source-cache runs/public-source-audit

This prepares the corpus and split only. Fit/replay are separate commands so
source, labels and settings can be frozen before inspecting experiment results.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from collections import Counter
from pathlib import Path

from goalspec.adapters.public_tau import PublicCatalog, import_public_tau
from goalspec.adapters.tau import TAU_REVISION
from goalspec.adapters.tau_worker import verify_checkout
from goalspec.annotations import AnnotationReport, annotate_tasks
from goalspec.splits import make_splits
from goalspec.storage import content_hash, file_hash, write_json, write_trajectories

S3 = "https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions"
SOURCE_ROWS = (
    ("airline", "gpt-5-2_sierra_2026-02-26", "gpt-5.2_high_airline_gpt-5.2_4trials.json",
     "308a133d880def1326ea60a2e0a946e0992c2f9e54b8e4711c2947f24b26c9fb"),
    ("retail", "gpt-5-2_sierra_2026-02-26", "gpt-5.2_high_retail_gpt-5.2_4trials.json",
     "76ad0d0a0c9b7f96cd07e8ab7efda68a266ef6d9fda74620abdad57de64e0449"),
    ("telecom", "gpt-5-2_sierra_2026-02-26", "gpt-5.2_high_telecom_gpt-5.2_4trials.json",
     "8c33f26a3032182d39a12511db9d45a2cbd9aa5c33d99a462cc23c836eb95176"),
    ("banking_knowledge", "gpt-5-6-sol_sierra_2026-08-04", "banking_knowledge_results.json",
     "614cdc47ae910fb97936c839e59cf43ec087f9c3c548af395159ea751759c292"),
)


def prepare(native_root: Path, output: Path, source_cache: Path | None) -> None:
    native_root, output = native_root.resolve(), output.resolve()
    verify_checkout(native_root)
    if output.exists():
        raise ValueError("Choose a new output directory; prepared corpora are immutable")
    if source_cache is not None:
        source_cache = source_cache.resolve()
    python = native_root / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    exporter = Path(__file__).resolve().parents[1] / "src/goalspec/adapters/public_tau_catalog.py"
    if not python.exists():
        raise ValueError("Install the pinned benchmark environment before preparing public replay")
    sources = output / "sources"
    sources.mkdir(parents=True)
    corpus, inventory = [], []
    for domain, submission_id, name, expected_hash in SOURCE_ROWS:
        url = f"{S3}/{submission_id}/trajectories/{name}"
        raw_path = sources / f"{domain}-results.json"
        cache_name = "gpt-5-6-sol-banking-fast.json" if domain == "banking_knowledge" else name
        cached = source_cache / cache_name if source_cache else None
        if cached is not None and cached.exists():
            shutil.copyfile(cached, raw_path)
        else:
            with urllib.request.urlopen(url, timeout=120) as response, raw_path.open("xb") as dest:
                shutil.copyfileobj(response, dest)
        if file_hash(raw_path) != expected_hash:
            raise ValueError(f"Official release content changed for {domain}; requires a new audited cohort")
        submission_path = sources / f"{domain}-submission.json"
        source_submission = native_root / "web/leaderboard/public/submissions" / submission_id / "submission.json"
        shutil.copyfile(source_submission, submission_path)
        catalog_path = sources / f"{domain}-catalog.json"
        cached_catalog = source_cache / catalog_path.name if source_cache else None
        if cached_catalog is not None and cached_catalog.exists():
            shutil.copyfile(cached_catalog, catalog_path)
        else:
            subprocess.run([str(python), str(exporter), domain, str(catalog_path)],
                           cwd=native_root, check=True)
        catalog = PublicCatalog.model_validate_json(catalog_path.read_text(encoding="utf-8"))
        if catalog.source_revision != TAU_REVISION:
            raise ValueError("Cached catalog source revision differs from audited checkout")
        for source_name, expected in catalog.source_hashes.items():
            source_file = (native_root / source_name).resolve()
            if not source_file.is_relative_to(native_root) or file_hash(source_file) != expected:
                raise ValueError("Cached catalog source hashes differ from audited checkout")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
        cached_annotations = source_cache / f"{domain}-endpoint-audit.json" if source_cache else None
        if cached_annotations is not None and cached_annotations.exists():
            annotations = AnnotationReport.model_validate_json(cached_annotations.read_text(encoding="utf-8"))
            if annotations.task_source_hash != content_hash(raw["tasks"]):
                raise ValueError("Cached annotation audit does not match published task definitions")
        else:
            annotations = annotate_tasks(raw["tasks"], domain)
        labels_path = sources / f"{domain}-endpoint-labels.json"
        write_json(labels_path, annotations.labels)
        write_json(sources / f"{domain}-endpoint-audit.json", annotations)
        traces, audit = import_public_tau(raw_path, catalog_path, submission_path, labels_path,
                                         source_url=url)
        write_json(sources / f"{domain}-source-audit.json", audit)
        write_trajectories(output / f"{domain}-corpus.jsonl", traces)
        corpus.extend(traces)
        calls = Counter(event.tool for trace in traces for event in trace.events
                        if event.kind == "tool_request")
        names = {tool.name for tool in traces[0].initial_tools}
        inventory.append({
            "domain": domain, "source_url": url, "source_sha256": expected_hash,
            "submission_id": submission_id, "native_revision": audit.native_revision,
            "tasks": len(raw["tasks"]), "trajectories": len(traces),
            "actor_model": traces[0].provenance.actor_model,
            "catalog_tools": len(names), "tool_calls": sum(calls.values()),
            "out_of_catalog_calls": {name: n for name, n in calls.items() if name not in names},
            "failure_reasons": dict(Counter(trace.outcome.native_termination_reason for trace in traces)),
            "source_audit": audit.model_dump(mode="json"),
        })
        print(json.dumps({"domain": domain, "trajectories": len(traces)}), flush=True)
    write_trajectories(output / "corpus.jsonl", corpus)
    finalize_prediction_cohort(output, corpus, inventory)


def finalize_prediction_cohort(output: Path, corpus: list, inventory: list) -> None:
    """Apply the existing five-family rule before fitting or viewing metrics."""
    domains = {trace.domain for trace in corpus}
    families = {domain: {trace.group_id for trace in corpus if trace.domain == domain}
                for domain in domains}
    excluded = {domain for domain, groups in families.items() if len(groups) < 5}
    prediction_corpus = [trace for trace in corpus if trace.domain not in excluded]
    write_trajectories(output / "prediction-corpus.jsonl", prediction_corpus)
    split = make_splits(prediction_corpus, seed=42, expected_trials=4)
    write_json(output / "split.json", split)
    write_json(output / "public-cohort-manifest.json", {
        "schema_version": 1, "benchmark": "tau3-public-replay",
        "catalog_source_revision": TAU_REVISION,
        "native_capture_gate_eligible": False,
        "annotation_status": "automatic_semantic_proxy_requires_review",
        "domains": inventory, "trajectories": len(corpus), "trial_count": 4,
        "corpus_sha256": file_hash(output / "corpus.jsonl"),
        "prediction_trajectories": len(prediction_corpus),
        "prediction_corpus_sha256": file_hash(output / "prediction-corpus.jsonl"),
        "prediction_exclusions": [{
            "domain": domain, "independent_families": len(families[domain]),
            "tasks": len({trace.task_id for trace in corpus if trace.domain == domain}),
            "trajectories": sum(trace.domain == domain for trace in corpus),
            "reason": "Fewer than five independent request families; existing split criterion.",
        } for domain in sorted(excluded)],
        "exclusion_before_fitting_or_metrics": True,
        "all_domains_retained_for_descriptive_actor_outcomes": True,
        "split_sha256": file_hash(output / "split.json"),
        "source_freeze_before_fit": True,
    })
    print(json.dumps({"output": str(output), "trajectories": len(corpus),
                      "prediction_trajectories": len(prediction_corpus),
                      "partitions": dict(Counter(split.assignments.values()))}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-cache", type=Path)
    args = parser.parse_args()
    prepare(args.native_root, args.output, args.source_cache)
