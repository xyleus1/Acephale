"""Audit a complete measured cohort and reproduce the prior case-cluster bootstrap."""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
STATISTICS_PATH = ROOT / "analysis-code" / "publication_statistics.py"
EXPECTED_COMMIT = "7e23ff685bc88b3427e236d94e5463bae01a6304"
EXPECTED_DATABASES = {"graph-small": "derya_main_benchmark_resume", "graph-medium": "derya_main_benchmark_resume", "graph-large": "derya_main_benchmark_large_retry"}
EXTENSIONS_PATH = ROOT / "analysis-code" / "publication_extensions.py"
STATISTICS_SHA256 = "cfeb9608e3f5837c5bed29533939d0459273f20a6ff9733a40f46876c9674d25"
EXTENSIONS_SHA256 = "127c615cc14d97fa9b7392c7db657d465afdb91f14f2fb198415fc9b4918d41d"


def statistics_module():
    spec = importlib.util.spec_from_file_location("publication_statistics", STATISTICS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("The copied publication statistics implementation is unavailable.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require(condition, message):
    if not condition:
        raise ValueError(message)


def audit_cohort(module, rows, unmeasured, summary, expected_commit):
    require(not unmeasured, "The cohort contains failed, skipped, or unmeasured rows.")
    require(len(rows) == 30_000, "Expected exactly 30,000 completed executions.")
    module.validate_publication_measurement(rows, summary, False)
    runs = summary.get("runs", [])
    require(len(runs) == 150, "Expected exactly 150 completed system/pass summaries.")
    observed = Counter()
    source_records = set()
    rows_by_run = Counter(row["run_id"] for row in rows)
    global_configurations = set()
    profile_configurations = {profile: set() for profile in module.PROFILE_ORDER}
    for run in runs:
        config = run["configuration"]
        require(config.get("status") == "completed", "Every run summary must be completed.")
        require(config.get("databaseLabel") == EXPECTED_DATABASES.get(run["profile"]), "A run belongs to a different benchmark database/cohort.")
        for key, value in {
            "topK": 20, "runCount": 10, "warmupPassCount": 3,
            "concurrency": 4, "queryCount": 200, "queryOrderSeed": 42,
            "postgresStatementTimeout": "10min",
        }.items():
            require(config.get(key) == value, f"Unexpected {key}: {config.get(key)!r}")
        profile = run["profile"]
        system = run["systemName"]
        observed[(profile, system, config["runIndex"])] += 1
        require(rows_by_run[run["runId"]] == 200, "Each run must have exactly 200 measured rows.")
        require(config["corpusSize"] == module.PROFILE_SIZES[profile], "Wrong profile corpus size.")
        fingerprint = config.get("sourceTreeFingerprint", "")
        require(len(fingerprint) == 64, "Missing SHA-256 source fingerprint.")
        source_records.add((config.get("commitSha"), fingerprint, config.get("workingTreeDirty")))
        if expected_commit:
            require(config.get("commitSha") == expected_commit, "The measured commit differs from the frozen commit.")
            require(config.get("workingTreeDirty") is False, "The measured checkout was dirty.")
        vector = config.get("vectorIndex") or {}
        require(vector.get("modelId") == "Xenova/all-MiniLM-L6-v2", "Unexpected embedding model.")
        require(vector.get("modelRevision") == "cb3d680149bf9a3209564e1b27ab3bb355b65707", "Unpinned embeddings.")
        require(vector.get("dimensions") == 384 and vector.get("modelDtype") == "q8", "Wrong vector dimensions or dtype.")
        require(vector.get("runtimeVersion") == "4.2.0", "Unexpected embedding runtime.")
        global_configurations.add(json.dumps({
            key: config.get(key) for key in (
                "branch", "commitSha", "sourceTreeFingerprint", "hardwareLabel", "runtimeLabel",
                "postgresVersion", "postgresStatementTimeout", "prismaPoolConfiguration", "embeddingModel",
            )
        }, sort_keys=True))
        profile_configurations[profile].add(json.dumps({
            "timestamp": config.get("timestamp"), "vectorIndex": vector,
        }, sort_keys=True))
    expected = {
        (profile, system, index)
        for profile in module.PROFILE_ORDER
        for system in module.EXPECTED_SYSTEM_ORDER
        for index in range(1, 11)
    }
    require(set(observed) == expected and set(observed.values()) == {1}, "Incomplete or duplicate run grid.")
    require(len(source_records) == 1, "Cohort source changed between runs or profiles.")
    require(len(global_configurations) == 1, "Runtime or measurement configuration changed across the cohort.")
    require(all(len(values) == 1 for values in profile_configurations.values()), "Profile cohort was spliced.")
    require(all(row.get("tenant_leak_count") == 0 and row.get("unrouted_leak_count") == 0 for row in rows), "Tenant or unrouted leakage was measured.")
    groups = module.group_rows(rows)
    safety = []
    for (profile, system), group in groups.items():
        record = {"profile": profile, "system": system, "validator": "executed" if system == "DERYA_HOT" else "modeled_no_validator"}
        for label, column in (
            ("stale", "strict_stale_detected"),
            ("unrelated", "false_conflict"),
        ):
            applicable = [row for row in group if row.get(column) is not None]
            require(len(applicable) == 200, f"Wrong {label} execution count in {profile}/{system}.")
            require(len({row["case_id"] for row in applicable}) == 20, f"Wrong {label} unique-case count.")
            require(all(row[column] in (0, 1) for row in applicable), "Safety outcomes must be binary.")
            record[f"{label}_executions"] = len(applicable)
            record[f"{label}_unique_cases"] = 20
        record["stale_detected"] = sum(row["strict_stale_detected"] for row in group if row.get("strict_stale_detected") is not None)
        record["stale_escaped"] = sum(row["stale_escape"] for row in group if row.get("stale_escape") is not None)
        record["false_conflicts"] = sum(row["false_conflict"] for row in group if row.get("false_conflict") is not None)
        validations = [row["validation_ms"] for row in group if row.get("validation_ms") is not None]
        require(len(validations) == (400 if system == "DERYA_HOT" else 0), "Unexpected executed-validation count.")
        record["validation_samples"] = len(validations)
        record["validation_p50_ms"] = module.nearest_rank(validations, 0.5)
        record["validation_p95_ms"] = module.nearest_rank(validations, 0.95)
        safety.append(record)
    return {"runs": len(runs), "executions": len(rows), "source": list(source_records)[0], "safety": safety}


def audit_composition_provenance(module, summary, results_path, summary_path):
    status = json.loads((ROOT / "composition-status.json").read_text(encoding="utf-8"))
    require(status.get("status") == "completed" and status.get("kind") == "complete_profile_composition", "Composition did not complete.")
    require(status.get("sourceCommit") == EXPECTED_COMMIT and status.get("runs") == 150 and status.get("executions") == 30000, "Wrong composition source or grid.")
    require(results_path.resolve() == (ROOT / "results/results.csv").resolve() and summary_path.resolve() == (ROOT / "results/summary.json").resolve(), "Analysis must use this audited composition's exact artifacts.")
    for artifact in status["artifacts"]:
        filename = (ROOT / artifact["path"]).resolve()
        require(filename.is_relative_to(ROOT), "Composition artifact escapes its root.")
        require(filename.stat().st_size == artifact["bytes"] and module.sha256_file(filename) == artifact["sha256"], "Composition artifact changed after validation.")
    provenance = json.loads((ROOT / "profile-provenance.json").read_text(encoding="utf-8"))
    require(provenance.get("kind") == "complete_profile_composition" and provenance.get("sourceCommit") == EXPECTED_COMMIT, "Wrong profile provenance.")
    profiles = {entry["profile"]: entry for entry in provenance["profiles"]}
    require(len(provenance["profiles"]) == 3 and set(profiles) == set(EXPECTED_DATABASES), "Missing or duplicate profile provenance.")
    excluded = set(provenance["interruptedRunIdsExcluded"])
    require(len(excluded) == 45, "Missing excluded interrupted-run identities.")
    for artifact in provenance["originalArtifacts"]:
        filename = (ROOT / artifact["path"]).resolve()
        require(filename.is_relative_to(ROOT), "Source artifact escapes the composition root.")
        require(filename.stat().st_size == artifact["bytes"] and module.sha256_file(filename) == artifact["sha256"], "An original profile artifact changed.")
    for profile, entry in profiles.items():
        require(entry["database"] == EXPECTED_DATABASES[profile] and entry["runs"] == 50 and entry["executions"] == 10000, "Wrong profile source or counts.")
        require(entry["fingerprint"] == provenance["sourceTreeFingerprint"], "Profile fingerprint differs.")
        selected = [run for run in summary["runs"] if run["profile"] == profile]
        require(len(selected) == 50 and len(set(entry["runIds"])) == 50 and {run["runId"] for run in selected} == set(entry["runIds"]), "Run IDs differ from accepted whole profile.")
        start = datetime.fromisoformat(entry["stage"]["startedAt"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(entry["stage"]["completedAt"].replace("Z", "+00:00"))
        require(entry["stage"]["exitCode"] == 0 and entry["stage"]["infrastructureInterrupted"] is False and entry["stage"]["ownedChildTerminated"] is False, "Selected stage was interrupted.")
        for run in selected:
            require(run["runId"] not in excluded, "An interrupted 250K run was included.")
            configured = datetime.fromisoformat(run["configuration"]["timestamp"].replace("Z", "+00:00"))
            began = datetime.fromisoformat(run["startedAt"].replace("Z", "+00:00"))
            finished = datetime.fromisoformat(run["completedAt"].replace("Z", "+00:00"))
            require(start <= configured <= end and start <= began <= finished <= end, "Run falls outside its selected profile's launch window.")
    return provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, default=ROOT / "results" / "results.csv")
    parser.add_argument("--summary", type=Path, default=ROOT / "results" / "summary.json")
    parser.add_argument("--output", type=Path, default=ROOT / "analysis")
    parser.add_argument("--expected-commit", default=EXPECTED_COMMIT)
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    require(arguments.expected_commit == EXPECTED_COMMIT, "Only the frozen resume-cohort source is accepted.")
    module = statistics_module()
    require(module.sha256_file(STATISTICS_PATH) == STATISTICS_SHA256, "Canonical statistics bytes changed.")
    require(module.sha256_file(EXTENSIONS_PATH) == EXTENSIONS_SHA256, "Original statistics extension bytes changed.")
    extension_spec = importlib.util.spec_from_file_location("publication_extensions", EXTENSIONS_PATH)
    extension = importlib.util.module_from_spec(extension_spec)
    extension_spec.loader.exec_module(extension)
    extension.install_extended_confidence_intervals(module)
    if arguments.self_test:
        module.run_self_test()
        print(json.dumps({"ok": True, "mode": "statistics-self-test"}))
        return
    output = arguments.output.resolve()
    require(output.is_relative_to(ROOT), "Analysis output must stay within the new benchmark root.")
    require(not (output / "findings.json").exists(), "Refusing to overwrite a completed analysis.")
    rows, unmeasured = module.load_completed_results(arguments.results)
    summary = json.loads(arguments.summary.read_text(encoding="utf-8"))
    provenance = audit_composition_provenance(module, summary, arguments.results, arguments.summary)
    audit = audit_cohort(module, rows, unmeasured, summary, arguments.expected_commit)
    module.OUTPUT_ROOT = output
    module.DATA_DIR = output / "data"
    module.FIGURES_DIR = output / "figures"
    module.LINKEDIN_DIR = output / "linkedin"
    module.NOTES_DIR = output / "notes"
    module.CONTACT_SHEET_DIR = output / "contact-sheet"
    artifacts = module.generate_data_outputs(arguments.results.resolve(), arguments.summary.resolve(), False)
    analysis_data_hashes = {
        f"data/{name}": module.sha256_file(module.DATA_DIR / name)
        for name in ("figure_data.csv", "confidence_intervals.csv")
    }
    analyzed = json.loads((module.DATA_DIR / "benchmark_summary.json").read_text(encoding="utf-8"))
    aggregates = [row for row in analyzed["aggregates"] if row["query_type"] == "ALL"]
    comparisons = [row for row in analyzed["confidenceIntervals"] if row.get("comparison_system") and row["query_type"] == "ALL"]
    findings = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "audit": audit,
        "statistics": analyzed["analysis"],
        "sourceArtifacts": analyzed["sourceArtifacts"],
        "statisticsCodeSha256": module.sha256_file(STATISTICS_PATH),
        "statisticsExtensionCodeSha256": module.sha256_file(EXTENSIONS_PATH),
        "analysisDataHashes": analysis_data_hashes,
        "profileProvenance": provenance,
        "compositionKind": "complete_profile_composition",
        "excludedCohorts": [
            {"directory": "derya-memory-benchmark-resume-20260908", "profile": "graph-large", "reason": "Every interrupted 250K run excluded; only its earlier complete 10K/50K profile snapshots are accepted."},
            {"directory": "derya-memory-benchmark-20260908", "reason": "Preliminary fixture-hash and app-timeout setup mismatch; retained separately."},
            {"directory": "derya-memory-benchmark-final-20260908", "reason": "Lid-triggered Modern Standby interrupted the incomplete cohort; retained separately."},
        ],
        "systems": aggregates,
        "pairedComparisons": comparisons,
        "projectionAmortization": analyzed["projectionAmortization"],
        "caveats": [
            "Main executor latency excludes separately measured semantic validation of seeded immutable-read fixtures.",
            "Each timed validation fixture has one dependency; do not generalize these timings to large production dependency manifests.",
            "This complete 150-run result set composes separately completed profiles; it is not one uninterrupted cohort and contains no partial-pass splicing.",
            "RAG baselines receive office/company scope, while Derya also receives exact operational scope; this is an architecture comparison, not identical-input retrieval ranking.",
            "The deliberately stale and matching-state fixture classes each contain 20 unique cases, repeated over ten passes.",
            "Deliberately stale fixtures substitute synthetic dependency version and value hashes before immutable-read insertion; no operational state mutation occurs after the read.",
            "Matching-state fixtures retain live dependency hashes. Other unrelated facts are seeded before all reads, so these checks do not measure tolerance of post-read unrelated changes.",
            "Only Derya Hot invokes the validator; other systems' validation outcomes are modeled no-validator controls.",
            "No action sends are performed. The raw stale_escape and false_conflict field names are retained for compatibility, not evidence of observed escaped actions or unrelated-change tolerance.",
            "Retrieval-only baseline zeros for typed facts/state reflect output capability, not absence of information in prose.",
            "No RSS, heap, retained-memory, or RAM-use measurement is present in these trials.",
            "Profiles run sequentially; cross-profile latency is not a causal scaling law.",
            "Both the preliminary setup-mismatch cohort and the interrupted standby-affected cohort are excluded, preserved separately, and not spliced into this cohort.",
        ],
    }
    findings["stageDurations"] = [profile["stage"] for profile in provenance["profiles"]]
    (output / "findings.json").write_text(json.dumps(findings, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines = ["# Measured cohort findings", "", "All numbers below come from three complete measured profiles, explicitly composed across separate launches.", ""]
    lines += ["| Corpus | System | Evidence Recall@20 | p50 ms | p95 ms | Gold evidence/s |", "| --- | --- | ---: | ---: | ---: | ---: |"]
    for row in sorted(aggregates, key=lambda row: (row["corpus_size"], module.EXPECTED_SYSTEM_ORDER.index(row["system"]))):
        lines.append(f"| {row['corpus_size']:,} | {row['system_label']} | {row['evidence_recall_at_20'] * 100:.2f}% | {row['latency_p50_ms']:.2f} | {row['latency_p95_ms']:.2f} | {row['evidence_bandwidth_per_second']:.4f} |")
    lines += ["", "Paired Derya Hot minus Strong Hybrid recall differences, using 10,000 benchmark-case-cluster bootstrap resamples:", ""]
    for row in comparisons:
        if row["comparison_system"] == "STRONG_HYBRID_RAG" and row["metric"] == "evidence_recall_at_20_difference":
            lines.append(f"- {row['corpus_size']:,} records: {row['estimate'] * 100:+.2f} percentage points; paired 95% CI {row['ci_low'] * 100:+.2f} to {row['ci_high'] * 100:+.2f} points.")
    lines += ["", "Derya Hot checks of seeded immutable-read fixtures:", ""]
    for row in sorted(audit["safety"], key=lambda row: row["profile"]):
        if row["system"] == "DERYA_HOT":
            lines.append(f"- {row['profile']}: {row['stale_detected']:.0f}/200 deliberately stale validation fixtures rejected; matching-state checks {row['unrelated_executions'] - row['false_conflicts']:.0f}/200 accepted and {row['false_conflicts']:.0f}/200 rejected; validation p50/p95 {row['validation_p50_ms']:.2f}/{row['validation_p95_ms']:.2f} ms.")
    lines += ["", "Interpretation limits:", ""] + [f"- {caveat}" for caveat in findings["caveats"]]
    (output / "findings.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "executions": len(rows), "runs": len(summary["runs"]), "bootstrapSamples": module.BOOTSTRAP_SAMPLES, "findings": str(output / "findings.json"), "artifacts": [str(path) for path in artifacts]}, indent=2))


if __name__ == "__main__":
    main()
