"""Write the explicit final v4 package selection; never builds the results ZIP."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).absolute().parents[2]
RUNS = "research/goalspec/runs/"
TARGET = ROOT / "outputs/goalspec-local-v4-final.allowlist.json"

# These closed directories are deliberately named. This is not a wildcard crawl
# of the runs directory and does not select test scratch or active lock files.
DIRECTORIES = [
    "local-controller-v4-dataset-20260916", "local-controller-v4-dataset-20260916-b", "local-controller-v4-dataset-20260916-c",
    "local-controller-v4-trained-20260916", "local-controller-v4-trained-20260916-b", "local-controller-v4-action-kind-20260916",
    "local-controller-v4-replay-20260916", "local-controller-v4-policy-parity-20260916", "local-controller-v4-policy-parity-20260916-b",
    "local-v4-candidate-audit-20260916", "local-study-v4-20260916", "local-v4-development-20260916", "local-v4-confirmation-20260916",
    "local-v4-development-analysis-20260916", "local-v4-development-controller-replay-20260916", "local-v4-confirmation-controller-replay-20260916",
    "local-v4-development-host-20260916", "local-v4-confirmation-host-20260916",
    "local-v4-goal-replay-20260916", "local-v4-goal-replay-20260916-b", "local-v4-goal-replay-20260916-c",
    "local-v4-goal-host-20260916", "local-v4-goal-host-20260916-b", "local-v4-goal-host-20260916-c",
    "local-final-accounting-v4-20260916", "local-v4-native-archive-20260916-b", "local-v4-archive-import-20260916",
    "local-v4-package-verification-20260916", "local-v4-package-verification-20260916-b",
    "local-library-v1-20260915", "local-memory-v3-20260915",
]
FILES = [
    "local-v4-budget-before-20260916.json", "local-v4-budget-after-goals-a-20260916.json", "local-v4-budget-after-goals-b-20260916.json",
    "local-v4-budget-after-development-20260916.json", "local-v4-budget-final-20260916.json",
    "local-v4-final-report-20260916.plan.json", "local-v4-final-source-verification-20260916.json", "local-v4-verification-20260916.json",
    "local-v4-confirmation-policy-20260916.json", "local-v4-development-analysis-20260916.plan.json",
    "local-v4-development-controller-replay-20260916-inputs.json", "local-v4-confirmation-controller-replay-20260916-inputs.json",
    "local-v4-goal-replay-plan-20260916.json", "local-v4-goal-replay-plan-20260916-b.json", "local-v4-goal-replay-plan-20260916-b2.json",
    "local-v4-goal-replay-plan-20260916-c.json", "local-v4-native-archive-20260916-inputs.json",
    "local-evaluation-20260914/events-5d3ddf24-7bac-46fb-b9e4-ea81d4dd07cc.jsonl",
    "local-evaluation-20260914/events-4b3d28e6-c8df-487d-9fca-b364bcc2dd15.jsonl",
    "local-v4-confirmation-failure-audit-20260916/diagnostic.json", "local-v4-confirmation-failure-audit-20260916/README.md",
]
OVERLAYS = [
    "docs/AI_HANDOFF.md", "docs/ENGINEERING_LOG.md", "docs/DECISIONS.md", "docs/goalspec/V4_CONTROLLER.md", "docs/goalspec/V4_IMPLEMENTATION.md",
    "scripts/goalspec-controller-dataset.ts", "scripts/goalspec-controller-generate.ts", "scripts/goalspec-controller-benchmark.ts",
    "scripts/goalspec-controller-replay.ts", "scripts/goalspec-controller-action-kind-generate.ts", "scripts/goalspec-controller-native-v4-replay.ts",
    "scripts/goalspec-import-archive-v4.ts", "scripts/goalspec-import-archive-v4.test.ts",
    "research/goalspec/src/goalspec/controller_v4.py", "research/goalspec/src/goalspec/controller_native_v4_report.py",
    "research/goalspec/src/goalspec/archive_v4.py", "research/goalspec/src/goalspec/archive_import_v4.py", "research/goalspec/src/goalspec/report_v4.py",
    "research/goalspec/scripts/train_controller_v4.py", "research/goalspec/scripts/train_action_kind_v4.py", "research/goalspec/scripts/evaluate_controller_v4.py",
    "research/goalspec/scripts/export_native_v4.py", "research/goalspec/scripts/import_native_archive_v4.py", "research/goalspec/scripts/report_native_v4.py",
    "research/goalspec/tests/test_archive_v4.py", "research/goalspec/tests/test_archive_import_v4.py",
    "outputs/goalspec-v4-tools/build_package.py", "outputs/goalspec-v4-tools/test_build_package.py", "outputs/goalspec-v4-tools/prepare_allowlist.py",
    "outputs/goalspec-v4-tools/hash_research_tables.mjs", "outputs/goalspec-v4-tools/verify_final_sources.py", "outputs/goalspec-v4-tools/README.md",
    RUNS + "local-v4-confirmation-failure-audit-20260916/build_audit.py",
]


def main():
    entries = {RUNS + name: "artifact" for name in DIRECTORIES + FILES}
    entries.update({path: "analysis-overlay" for path in OVERLAYS})
    entries["research/goalspec/reports/2026-09-16-local-v4"] = "artifact"
    for stage in ("development", "confirmation"):
        base = RUNS + f"local-v4-{stage}-plan-20260916/"
        entries[base + "source.zip"] = "executed-source-archive"
        entries[base + "plan.json"] = "artifact"
        entries[f"research/goalspec/v4-{stage}.configuration.json"] = "artifact"
    entries["research/goalspec/requirements-controller-v4.txt"] = "analysis-overlay"
    # Raw training and annotation evidence is selected by each immutable input
    # manifest, preserving its original SHA rather than discovering extra runs.
    dependencies = []
    for suffix in ("", "-b", "-c"):
        value = json.loads((ROOT / (RUNS + f"local-controller-v4-dataset-20260916{suffix}/manifest.json")).read_bytes())
        dependencies.extend(value["sources"])
        goal = json.loads((ROOT / (RUNS + f"local-v4-goal-replay-20260916{suffix}/plan.json")).read_bytes())
        dependencies.extend(goal["inputFiles"])
        dependencies.append({"path": goal["inputs"]["closedEventsPath"]})
    for entry in dependencies:
        path = Path(entry["path"])
        relative = path.resolve().relative_to(ROOT).as_posix()
        if entry.get("sha256") and hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("Immutable dependency differs from its original input manifest")
        if any(relative == selected or relative.startswith(selected + "/") for selected in entries):
            continue
        entries[relative] = "artifact"
    missing = [path for path in entries if not (ROOT / path).exists()]
    if missing:
        raise ValueError("Selected package inputs missing: " + ", ".join(missing))
    selection = {"schemaVersion": 1, "entries": [{"path": path, "role": entries[path]} for path in sorted(entries)]}
    with TARGET.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(selection, stream, indent=2)
        stream.write("\n")
    print(json.dumps({"entries": len(entries), "path": TARGET.relative_to(ROOT).as_posix(), "zipBuilt": False}))


if __name__ == "__main__":
    main()
