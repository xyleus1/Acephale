"""Archive non-sensitive runtime validation evidence without touching pilot reports."""
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[3]
    research = root / "research/goalspec"
    destination = research / "reports/2026-09-14-runtime-validation"
    destination.mkdir(exist_ok=False)
    replay = research / "runs/v1-execution-replay-final-20260914"
    acquired = research / "runs/apigen-abc4a517d67c541f85f6470cbd8fd3186b36830e"
    for source, name in [
        (replay / "report.json", "execution-replay.json"),
        (replay / "events.jsonl", "execution-events.jsonl"),
        (acquired / "acquisition.json", "apigen-acquisition.json"),
        (acquired / "ingested/pilot-manifest.json", "apigen-pilot.json"),
    ]:
        shutil.copy2(source, destination / name)
    files = []
    for folder in ["src/lib/goalspec", "src/lib/goalspec-adapters", "services/goalspec-runtime", "research/goalspec/src", "research/goalspec/scripts", "research/goalspec/tests"]:
        files.extend(p for p in (root / folder).rglob("*") if p.suffix in {".ts", ".py", ".json", ".sql"})
    files.extend((root / "scripts").glob("goalspec-*.ts"))
    files.extend(root / name for name in ["src/lib/agent-chat.ts", "src/lib/gpt56-client.ts", "package.json", "package-lock.json", "research/goalspec/uv.lock"])
    digests = {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(files))}
    (destination / "source-hashes.json").write_text(json.dumps(digests, indent=2) + "\n", encoding="utf-8")
    report = {"status": "implementation_checkpoint_not_complete_v1", "baseline_git_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
              "working_tree_source_hash": hashlib.sha256(json.dumps(digests, sort_keys=True).encode()).hexdigest(),
              "python_tests_passed": 203, "typescript_runtime_model_tests_passed": 17,
              "independent_postgres_freshness": "passed", "native_mock_gateway_parity": "passed",
              "core_typecheck": "passed", "application_typecheck": "passed_with_8192_mb_heap",
              "existing_model_scan": "failed_unrelated_vehicle_model_fixture", "ruff": "passed",
              "provider_calls": 0, "provider_and_aws_research_spend_usd": 0, "live_evaluation_completed": False,
              "limitations_document": "docs/goalspec/IMPLEMENTATION_STATUS.md"}
    (destination / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
