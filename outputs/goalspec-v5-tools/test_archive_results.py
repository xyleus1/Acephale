import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import archive_results as archive


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="goalspec-v5-archive-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "outputs").mkdir()
        (self.root / "research/goalspec/runs").mkdir(parents=True)
        self.source = self.root / "outputs/source.jsonl"
        self.source.write_bytes('{"unknown":null,"unicode":"é"}\r\n{"failed":true}\n'.encode())
        self.plan = {"version": "goalspec-v5-archive-plan-v1", "archiveId": "test-v5", "closed": True,
                     "files": [{"path": "outputs/source.jsonl", "role": "failed-attempt", "sha256": archive.digest(self.source)}],
                     "externalInputs": [{"name": "mock dependency", "pin": "fixture-only", "reason": "not a deployed artifact"}]}
        self.plan_path = self.root / "outputs/plan.json"

    def freeze(self):
        self.plan_path.write_text(json.dumps(self.plan), encoding="utf8")

    def test_lossless_export_and_deterministic_package(self):
        self.freeze()
        directory = self.root / "research/goalspec/runs/archive"
        proof = archive.export(self.root, self.plan_path, directory)
        self.assertEqual(proof["files"], 1)
        first = archive.pack(self.root, self.plan_path, directory, proof["manifestSha256"], self.root / "outputs/one.zip")
        second = archive.pack(self.root, self.plan_path, directory, proof["manifestSha256"], self.root / "outputs/two.zip")
        self.assertEqual(first["zipSha256"], second["zipSha256"])
        self.assertTrue(first["zipRoundtripVerified"])

    def test_source_changes_and_credential_paths_are_rejected(self):
        self.source.write_text("changed", encoding="utf8")
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)
        for name in ("../escape", ".env", "outputs/credentials.json", "outputs/key.pem", "research/goalspec/.benchmarks/tau3/data.json"):
            with self.assertRaises(ValueError): archive.located(self.root, name)

    def test_private_content_rejected_without_redaction(self):
        self.source.write_bytes(("sk-" + "x" * 40).encode())
        self.plan["files"][0]["sha256"] = archive.digest(self.source)
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)

    def test_closed_failure_logs_are_preserved_and_receive_the_same_content_guard(self):
        log = self.root / "outputs/service.log"
        log.write_text("Fixture startup failure: TimeoutError\n", encoding="utf8")
        self.plan["files"] = [{"path": "outputs/service.log", "role": "failed-attempt", "sha256": archive.digest(log)}]
        self.assertEqual(archive.collect(self.root, self.plan)[0]["outputs/service.log"]["bytes"], log.stat().st_size)
        log.write_text("postgresql://fixture:password@127.0.0.1/db", encoding="utf8")
        self.plan["files"][0]["sha256"] = archive.digest(log)
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)

    def test_synthetic_url_review_is_source_and_literal_hash_bound(self):
        from collections import Counter
        literal = "postgresql://fixture:" + "password@"
        self.source.write_text('const example = "' + literal + '127.0.0.1/test";\n', encoding="utf8")
        original = archive.digest(self.source)
        item = {"path": "outputs/source.jsonl", "role": "source", "sha256": original,
                "syntheticUrlReview": {"sourceSha256": original, "reason": "Synthetic source-only unit-test URL",
                    "literalSha256Counts": dict(Counter({archive.hashlib.sha256(literal.encode()).hexdigest(): 1}))}}
        self.plan["files"] = [item]
        archive.collect(self.root, self.plan)
        self.source.write_text('changed "' + literal + '127.0.0.1/test"\n', encoding="utf8")
        item["sha256"] = archive.digest(self.source)
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)
        item["syntheticUrlReview"]["sourceSha256"] = item["sha256"]
        self.source.write_text('changed "' + literal.replace("fixture", "changed") + '127.0.0.1/test"\n', encoding="utf8")
        item["sha256"] = item["syntheticUrlReview"]["sourceSha256"] = archive.digest(self.source)
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)

    def test_synthetic_source_exception_cannot_apply_to_events_or_ledgers(self):
        literal = "postgresql://fixture:" + "password@"
        self.source.write_text(json.dumps({"fixture": literal + "127.0.0.1/test"}) + "\n", encoding="utf8")
        value = archive.digest(self.source)
        for role, chain in [("provider-events", "plain-jsonl"), ("ledger", "budget"), ("failed-attempt", None)]:
            self.plan["files"] = [{"path": "outputs/source.jsonl", "role": role, "chain": chain, "sha256": value,
                "syntheticUrlReview": {"sourceSha256": value, "reason": "Attempted forbidden reuse of fixture exception",
                    "literalSha256Counts": {archive.hashlib.sha256(literal.encode()).hexdigest(): 1}}}]
            with self.assertRaises(ValueError): archive.collect(self.root, self.plan)

    def test_parquet_or_manifest_tampering_is_rejected(self):
        self.freeze(); directory = self.root / "research/goalspec/runs/archive"
        proof = archive.export(self.root, self.plan_path, directory)
        with (directory / "artifact_record.parquet").open("ab") as stream: stream.write(b"tamper")
        with self.assertRaises(ValueError): archive.inspect(directory, proof["manifestSha256"])

    def test_previous_archives_are_hash_protected(self):
        self.plan["preserveArchives"] = [{"path": "outputs/source.jsonl", "sha256": "f" * 64}]
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)

    def test_hash_chained_ledger_rejects_missing_or_changed_records(self):
        body = {"sequence": 0, "previous": "0" * 64, "version": 2, "changes": []}
        row = {"body": body, "hash": archive.hash_v1(body)}
        self.source.write_text(json.dumps(row) + "\n", encoding="utf8")
        self.assertEqual(archive.check_chain(self.source, "budget")["records"], 1)
        body["sequence"] = 1
        self.source.write_text(json.dumps(row) + "\n", encoding="utf8")
        with self.assertRaises(ValueError): archive.check_chain(self.source, "budget")

    def test_large_file_exception_is_explicit_and_only_for_the_full_budget_chain(self):
        size = lambda item: archive.file_size_limit(item, default_limit=16, ledger_limit=32)
        self.assertEqual(size({"role": "ledger", "chain": "budget"}), 16)
        self.assertEqual(size({"role": "ledger", "chain": "budget", "maximumFileBytes": 32}), 32)
        for item in ({"role": "provider-events", "chain": "events", "maximumFileBytes": 32},
                     {"role": "verification", "maximumFileBytes": 32},
                     {"role": "ledger", "chain": "plain-jsonl", "maximumFileBytes": 32},
                     *({"role": "ledger", "chain": "budget", "maximumFileBytes": value} for value in (15, 33, True, 32.0))):
            with self.assertRaises(ValueError): size(item)

    def test_small_real_journal_uses_injected_bounds_without_allocating_large_fixture(self):
        body = {"sequence": 0, "previous": "0" * 64, "version": 2, "changes": []}
        self.source.write_text(json.dumps({"body": body, "hash": archive.hash_v1(body)}) + "\n", encoding="utf8")
        length = self.source.stat().st_size
        item = {"path": "outputs/source.jsonl", "role": "ledger", "chain": "budget", "sha256": archive.digest(self.source)}
        self.plan["files"] = [item]
        bounded = archive.file_size_limit
        with patch.object(archive, "file_size_limit", side_effect=lambda source: bounded(source, default_limit=length - 1, ledger_limit=length + 1)):
            with self.assertRaises(ValueError): archive.collect(self.root, self.plan)
            item["maximumFileBytes"] = length + 1
            files, _ = archive.collect(self.root, self.plan)
            self.assertEqual(files[item["path"]]["chainVerification"]["records"], 1)
            self.assertEqual(files[item["path"]]["bytes"], length)

    def test_checkpoint_is_hash_bound_to_preserved_full_journal_without_duplicate_spending(self):
        body = {"sequence": 0, "previous": "0" * 64, "version": 2, "changes": []}
        row = {"body": body, "hash": archive.hash_v1(body)}
        raw = (json.dumps(row) + "\n").encode(); self.source.write_bytes(raw)
        values = {"version": 1, "journalPathHash": archive.hash_v1(str(self.source)), "prefixBytes": len(raw),
                  "prefixSha256": archive.digest(self.source), "nextSequence": 1, "lastChainHash": row["hash"],
                  "entries": [], "entriesHash": archive.hash_v1([])}
        sidecar = self.root / "outputs/checkpoint.json"
        sidecar.write_text(json.dumps({**values, "contentHash": archive.hash_v1(values)}), encoding="utf8")
        pointer = self.root / "outputs/pointer.json"
        pointer.write_text(json.dumps({"version": 1, "checkpointFile": sidecar.name, "sha256": archive.digest(sidecar)}), encoding="utf8")
        self.plan["files"] = [{"path": "outputs/source.jsonl", "role": "ledger", "chain": "budget", "sha256": archive.digest(self.source)},
                              *({"path": "outputs/" + path.name, "role": "verification", "sha256": archive.digest(path)} for path in (pointer, sidecar))]
        self.plan["budgetCheckpointBindings"] = [{"journal": "outputs/source.jsonl", "pointer": "outputs/pointer.json",
                                                  "checkpoint": "outputs/checkpoint.json", "originalJournalPath": str(self.source)}]
        files, _ = archive.collect(self.root, self.plan)
        proof = files["outputs/source.jsonl"]["checkpointVerification"][0]
        self.assertTrue(proof["fullJournalPreserved"] and proof["prefixHashVerified"])
        self.assertFalse(proof["independentLedger"] or proof["checkpointStateReplayed"])
        self.plan["files"][2]["role"] = "ledger"
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)
        self.plan["files"][2]["role"] = "verification"
        self.plan["budgetCheckpointBindings"][0]["originalJournalPath"] = "different journal"
        with self.assertRaises(ValueError): archive.collect(self.root, self.plan)

    def test_closed_failed_native_slots_are_required_and_run_associations_cannot_swap(self):
        trials = [{"arm": "base", "domain": "retail", "family": f"family-{i}", "variant": 0, "trial": 0, "seed": 1, "taskId": f"task-{i}"} for i in range(2)]
        design = {"version": "goalspec-experiment-v5", "studyId": "test", "studyStage": "training", "trials": trials}
        design["designHash"] = archive.native_hash(design)
        ids = [f"v5-{archive.native_hash('test')[:10]}-training-{i:04d}-{archive.native_hash([design['designHash'], trial])[:12]}" for i, trial in enumerate(trials)]
        rows = [{**trial, "runId": run, "success": False, "termination": "stage_setup_or_dispatch_error"} for run, trial in zip(ids, trials)]
        values = {"design.json": design, "manifest.json": {"runs": [{**trial, "runId": run} for run, trial in zip(ids, trials)]}}
        values.update({f"{run}.json": {"record": row} for run, row in zip(ids, rows)})
        files = {}
        for name, value in values.items():
            path = self.root / "outputs" / name; path.write_text(json.dumps(value), encoding="utf8"); files[name] = {"file": path}
        path = self.root / "outputs/outcomes.jsonl"; path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf8")
        files["outcomes.jsonl"] = {"file": path, "role": "native-outcomes"}
        specification = {"closed": True, "design": "design.json", "serviceManifest": "manifest.json", "outcomes": "outcomes.jsonl", "traces": {run: f"{run}.json" for run in ids}}
        self.assertEqual(archive.cohort(specification, files)["outcomes"], 2)
        rows[0]["runId"], rows[1]["runId"] = rows[1]["runId"], rows[0]["runId"]
        path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf8")
        with self.assertRaises(ValueError): archive.cohort(specification, files)


if __name__ == "__main__": unittest.main()
