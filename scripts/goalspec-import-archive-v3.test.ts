import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical } from "../src/lib/goalspec/canonical";
import { guardedArchiveDatabaseUrl, validateArchive } from "./goalspec-import-archive-v3";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-archive-v3-"));
  const raw = '{ "number": 10000000000000000001 }\r\n', cohortId = hash("cohort"), sourceId = hash("source");
  const tables = { cohort_manifest: [{ cohort_id: cohortId, contract: "official-native-v3-archive", run_ids: ["run-a"], arms: ["base"] }],
    artifact_file: [{ source_id: sourceId, cohort_id: cohortId, original_bytes: Buffer.byteLength(raw), original_sha256: hash(raw), records: 1 }],
    artifact_record: [{ source_id: sourceId, source_row: 0, cohort_id: cohortId, run_id: "run-a:user", arm: null, event_type: "worker_event", raw_utf8: raw }] };
  const files: object[] = [];
  for (const [table, rows] of Object.entries(tables)) for (const format of ["canonical-jsonl", "parquet"]) {
    const filename = `${table}.${format === "parquet" ? "parquet" : "jsonl"}`;
    // Parquet decoding is the Python exporter's responsibility; importer verifies
    // its exact bytes/hash and exporter receipt. This fixture exercises that limit.
    const bytes = format === "parquet" ? Buffer.from("offline hash fixture") : Buffer.from(rows.map(row => canonical(row)).join("\n") + "\n");
    writeFileSync(join(directory, filename), bytes); files.push({ table, filename, format, rows: rows.length, bytes: bytes.length, sha256: hash(bytes) });
  }
  const manifest = { schemaVersion: 1, archiveId: "fixture-archive", exporterVersion: "goalspec-native-artifact-export-v3", status: "complete",
    contract: "official-native-v3-archive", parquetRoundTripVerified: true, originalSourceRoundTripVerified: true, files };
  writeFileSync(join(directory, "manifest.json"), canonical(manifest) + "\n");
  return { directory, manifest, sha: () => hash(readFileSync(join(directory, "manifest.json"))), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

test("archive database guard rejects remote, application and query-redirected databases", () => {
  assert.match(guardedArchiveDatabaseUrl("postgresql://u:p@127.0.0.1:5432/goalspec_archive"), /127.0.0.1/);
  for (const value of ["postgresql://u:p@example.com/goalspec_archive", "postgresql://u:p@localhost/goalspec_archive",
    "postgresql://u:p@127.0.0.1/production", "postgresql://u:p@127.0.0.1/goalspec_archive?host=remote"]) assert.throws(() => guardedArchiveDatabaseUrl(value));
  assert.throws(() => guardedArchiveDatabaseUrl("postgresql://u:p@127.0.0.1/goalspec_archive", "postgresql://app:p@localhost/goalspec_archive"), /application/);
});

test("archive offline verification preserves original numeric text, CRLF and auxiliary worker indexes", async () => {
  const value = fixture();
  try {
    const result = await validateArchive(value.directory, value.sha());
    assert.equal(result.manifest.archiveId, "fixture-archive"); assert.equal(result.files.artifact_record.rows, 1);
    await assert.rejects(validateArchive(value.directory, hash("different")), /manifest hash/);
    writeFileSync(join(value.directory, "artifact_record.jsonl"), "{}\n");
    await assert.rejects(validateArchive(value.directory, value.sha()));
  } finally { value.cleanup(); }
});

test("archive preflight rejects a forged original source digest even when table hashes match", async () => {
  const value = fixture();
  try {
    const path = join(value.directory, "artifact_file.jsonl"), row = JSON.parse(readFileSync(path, "utf8"));
    row.original_sha256 = hash("wrong original");
    const bytes = Buffer.from(canonical(row) + "\n"); writeFileSync(path, bytes);
    const declared = value.manifest.files.find(file => (file as { filename: string }).filename === "artifact_file.jsonl") as { sha256: string; bytes: number };
    declared.sha256 = hash(bytes); declared.bytes = bytes.length;
    writeFileSync(join(value.directory, "manifest.json"), canonical(value.manifest) + "\n");
    await assert.rejects(validateArchive(value.directory, value.sha()), /reconstruct original/);
  } finally { value.cleanup(); }
});
