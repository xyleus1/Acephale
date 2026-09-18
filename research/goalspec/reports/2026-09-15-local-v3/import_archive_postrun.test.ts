import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "../../../../src/lib/goalspec/canonical";
import { boundedLines, boundedJsonBatches, selectReadbackRows, safeFailure, verifyOriginalImporter,
  ORIGINAL_IMPORTER_SHA256, validateArchive, verifyStoredRow } from "./import_archive_postrun";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const root = fileURLToPath(new URL("../../runs/local-v3-import-overlay-tests-20260915/", import.meta.url));
mkdirSync(root, { recursive: true });
async function* values<T>(items: T[]) { for (const item of items) yield item; }
async function collect<T>(stream: AsyncIterable<T>) { const result: T[] = []; for await (const item of stream) result.push(item); return result; }

test("line reader applies pull backpressure before consuming later chunks", async () => {
  let pulled = 0;
  async function* input() {
    pulled++; yield Buffer.from("one\ntwo\n");
    pulled++; yield Buffer.from("three\n");
  }
  const iterator = boundedLines(input());
  assert.equal((await iterator.next()).value?.toString(), "one\n");
  assert.equal(pulled, 1);
  assert.equal((await iterator.next()).value?.toString(), "two\n");
  assert.equal(pulled, 1);
  assert.equal((await iterator.next()).value?.toString(), "three\n");
  assert.equal(pulled, 2);
  assert.equal((await iterator.next()).done, true);
});

test("line reader preserves UTF8 and CRLF bytes across every chunk boundary", async () => {
  const raw = Buffer.from('Türkçe: "🔎"\r\nnext\n');
  const result = await collect(boundedLines(values([...raw].map(byte => Uint8Array.of(byte)))));
  assert.deepEqual(Buffer.concat(result), raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].at(-2), 13);
});

test("line reader rejects truncated and oversized rows rather than dropping bytes", async () => {
  await assert.rejects(collect(boundedLines(values([Buffer.from("abc")]))), /final newline/);
  await assert.rejects(collect(boundedLines(values([Buffer.from("abc\n")]), 3)), /byte limit/);
  assert.deepEqual(await collect(boundedLines(values([Buffer.from("abc\n")]), 4)), [Buffer.from("abc\n")]);
  await assert.rejects(collect(boundedLines(values([Buffer.from("\n")]), 0)), /limit/);
});

test("JSON batches preserve exact row order and bound encoded UTF8 bytes", async () => {
  const rows = [{ n: 0, text: "ççç" }, { n: 1 }, { n: 2, text: "x".repeat(100) }, { n: 3 }, { n: 4 }];
  const batches = await collect(boundedJsonBatches(values(rows), { maxRows: 2, maxBytes: 35 }));
  assert.deepEqual(batches.flatMap(batch => JSON.parse(batch.json)), rows);
  for (const batch of batches) {
    assert.equal(batch.bytes, Buffer.byteLength(batch.json));
    assert.equal(batch.rows, JSON.parse(batch.json).length);
    assert.ok(batch.rows <= 2);
    if (batch.bytes > 35) { assert.equal(batch.rows, 1); assert.equal(batch.oversizedSingleRow, true); }
    else assert.equal(batch.oversizedSingleRow, false);
  }
  assert.equal(batches.filter(batch => batch.oversizedSingleRow).length, 1);
});

test("JSON row cap yields without draining future input", async () => {
  let pulled = 0;
  async function* input() { for (let n = 0; n < 20; n++) { pulled++; yield { n }; } }
  const iterator = boundedJsonBatches(input(), { maxRows: 2, maxBytes: 1000 });
  const first = await iterator.next();
  assert.equal(first.value?.rows, 2);
  assert.equal(pulled, 2);
  await iterator.return(undefined);
});

test("readback selection bounds bytes and admits a single oversized row", () => {
  const rows = [10n, 20n, 100n].map((encoded_bytes, i) => ({ row_index: BigInt(i + 5), encoded_bytes }));
  assert.equal(selectReadbackRows(rows, 5, { maxRows: 8, maxBytes: 30 }), 2);
  assert.equal(selectReadbackRows(rows, 5, { maxRows: 1, maxBytes: 30 }), 1);
  assert.equal(selectReadbackRows([{ row_index: 0n, encoded_bytes: 999n }], 0, { maxRows: 8, maxBytes: 30 }), 1);
  assert.throws(() => selectReadbackRows([{ row_index: 1n, encoded_bytes: 1n }], 0), /order/);
  assert.throws(() => selectReadbackRows([{ row_index: 0n, encoded_bytes: -1n }], 0), /sizes/);
  assert.throws(() => selectReadbackRows([{ row_index: 0n, encoded_bytes: 9007199254740993n }], 0), /sizes/);
  assert.throws(() => selectReadbackRows([], 0), /missing/);
});

test("safe failure retains code fields but never messages URLs or parameters", () => {
  const secret = "postgresql://fake-user:fake-password@example.invalid/private";
  const error = Object.assign(new Error(secret), { code: "P2010", meta: { code: "53200", message: secret }, cause: { code: "ECONNRESET", message: secret }, query: secret, parameters: [secret] });
  const result = safeFailure(error, "readback.artifact_record");
  assert.deepEqual(result, { errorClass: "Error", errorCode: "P2010", databaseCode: "53200", causeCode: "ECONNRESET", phase: "readback.artifact_record" });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(safeFailure({ code: secret, meta: { code: secret }, cause: { code: secret } }, secret).phase, "unknown");
  assert.equal(safeFailure({ code: secret }, "safe").errorCode, null);
});

test("database row verification preserves raw numeric spelling and rejects tampering", () => {
  const raw = '{ "number": 10000000000000000001 }\r\n';
  const text = canonical({ raw_utf8: raw });
  const row = { row_index: 0n, canonical_utf8: text, row_sha256: hash(text), raw_utf8: raw };
  assert.equal(verifyStoredRow(row, 0, "artifact_record"), text + "\n");
  assert.throws(() => verifyStoredRow({ ...row, raw_utf8: raw.trim() }, 0, "artifact_record"), /content mismatch/);
  assert.throws(() => verifyStoredRow({ ...row, row_sha256: hash("wrong") }, 0, "artifact_record"), /content mismatch/);
  assert.throws(() => verifyStoredRow(row, 1, "artifact_record"), /content mismatch/);
});

test("postrun overlay pins the unchanged original importer", () => {
  assert.equal(verifyOriginalImporter(), ORIGINAL_IMPORTER_SHA256);
  const directory = mkdtempSync(join(root, "pin-")), path = join(directory, "changed.ts");
  writeFileSync(path, "changed source\n");
  assert.throws(() => verifyOriginalImporter(path), /identity changed/);
});

function fixture() {
  const directory = mkdtempSync(join(root, "fixture-"));
  const raw = '{ "number": 10000000000000000001 }\r\n', cohortId = hash("cohort"), sourceId = hash("source");
  const tables = { cohort_manifest: [{ cohort_id: cohortId, contract: "official-native-v3-archive", run_ids: ["run-a"], arms: ["base"] }],
    artifact_file: [{ source_id: sourceId, cohort_id: cohortId, original_bytes: Buffer.byteLength(raw), original_sha256: hash(raw), records: 1 }],
    artifact_record: [{ source_id: sourceId, source_row: 0, cohort_id: cohortId, run_id: "run-a:user", arm: null, event_type: "worker_event", raw_utf8: raw }] };
  const files: { table: string; filename: string; format: string; rows: number; bytes: number; sha256: string }[] = [];
  for (const [table, rows] of Object.entries(tables)) for (const format of ["canonical-jsonl", "parquet"]) {
    const filename = `${table}.${format === "parquet" ? "parquet" : "jsonl"}`;
    // The importer verifies Parquet bytes and the exporter's roundtrip receipt;
    // this tiny unit fixture does not claim to exercise a Parquet decoder.
    const bytes = format === "parquet" ? Buffer.from("offline hash fixture") : Buffer.from(rows.map(row => canonical(row)).join("\n") + "\n");
    writeFileSync(join(directory, filename), bytes); files.push({ table, filename, format, rows: rows.length, bytes: bytes.length, sha256: hash(bytes) });
  }
  const manifest = { schemaVersion: 1, archiveId: "fixture-archive", exporterVersion: "goalspec-native-artifact-export-v3", status: "complete",
    contract: "official-native-v3-archive", parquetRoundTripVerified: true, originalSourceRoundTripVerified: true, files };
  const save = () => writeFileSync(join(directory, "manifest.json"), canonical(manifest) + "\n");
  save();
  return { directory, manifest, save, sha: () => hash(readFileSync(join(directory, "manifest.json"))) };
}

test("bounded archive inspection preserves source bytes and rejects altered files", async () => {
  const value = fixture();
  const result = await validateArchive(value.directory, value.sha());
  assert.equal(result.files.artifact_record.rows, 1);
  await assert.rejects(validateArchive(value.directory, hash("different")), /manifest hash/);
  writeFileSync(join(value.directory, "artifact_record.jsonl"), "{}\n");
  await assert.rejects(validateArchive(value.directory, value.sha()));
});

test("bounded archive inspection rejects forged source digest with matching table hashes", async () => {
  const value = fixture();
  const path = join(value.directory, "artifact_file.jsonl"), row = JSON.parse(readFileSync(path, "utf8"));
  row.original_sha256 = hash("wrong original");
  const bytes = Buffer.from(canonical(row) + "\n"); writeFileSync(path, bytes);
  const declared = value.manifest.files.find(file => file.filename === "artifact_file.jsonl")!;
  declared.sha256 = hash(bytes); declared.bytes = bytes.length; value.save();
  await assert.rejects(validateArchive(value.directory, value.sha()), /reconstruct original/);
});
