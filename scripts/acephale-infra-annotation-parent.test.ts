import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { INFRA_MODEL_PINS } from "../src/lib/acephale/infra-manifest";
import { multiCohortFixture } from "./test-fixtures/native-parent";
import { verifyInfraAnnotationSource } from "./acephale-infra-annotation-source";
import { expandInfraAnnotationCohort } from "./acephale-infra-grade";

function writeBundle(directory: string, declaration: unknown, rows: unknown[]) {
  mkdirSync(directory, { recursive: true });
  const files: Record<string, unknown> = {};
  for (const [name, text] of [["pilot.json", canonical(declaration)],
    ["annotation-inputs.jsonl", rows.map(row => canonical(row) + "\n").join("")]]) {
    writeFileSync(join(directory, name), text);
    files[name] = { sha256: createHash("sha256").update(text).digest("hex"), rows: name.endsWith("jsonl") ? rows.length : null };
  }
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "acephale-infra-data-v1", files, bundle_hash: hash(files) }));
}

function fixture() {
  const source = multiCohortFixture();
  const row = source.publicRows[0];
  const inputs = [{ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, request_revision: row.request_revision, input: row.input }];
  const declaration = { schema_version: "acephale-infra-data-v1", pilot_count: 1, audit_count: 1,
    checkpoints: inputs.map(row => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash })),
    audit: [{ checkpoint_id: row.checkpoint_id, reason: "predeclared-method-audit" }],
    source_dataset_hash: source.parent.bundleHash, source_split_hash: hash(source.parent.split) };
  const pilot = join(source.directory, "original-pilot");
  writeBundle(pilot, declaration, inputs);
  return { ...source, pilot, inputs, declaration };
}

test("an original audit may use a verified aggregate without rewriting its pilot or public bytes", () => {
  const f = fixture(), before = readFileSync(join(f.pilot, "pilot.json"));
  const result = verifyInfraAnnotationSource(f.pilot, f.directory);
  assert.equal(result.originalAuditSource?.sourceDatasetHash, f.parent.bundleHash);
  assert.equal(result.originalAuditSource?.publicSha256, f.parent.manifest.files["public.jsonl"].sha256);
  assert.deepEqual(result.declaration.audit, f.declaration.audit);
  assert.deepEqual(readFileSync(join(f.pilot, "pilot.json")), before);
  assert.deepEqual(result.rows, f.inputs);
});

test("parent reuse rejects reserialized original bytes, changed split and unrelated development prefixes", () => {
  const changed = fixture();
  changed.put("public.jsonl", null, changed.lines.map(line => canonical(JSON.parse(line)) + "\n").join("")); changed.seal();
  assert.throws(() => verifyInfraAnnotationSource(changed.pilot, changed.directory), /binding mismatch/);
  const split = fixture();
  writeBundle(split.pilot, { ...split.declaration, source_split_hash: hash("different split") }, split.inputs);
  assert.throws(() => verifyInfraAnnotationSource(split.pilot, split.directory), /binding mismatch/);
  const other = fixture(), row = other.publicRows[2];
  const inputs = [{ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, request_revision: row.request_revision, input: row.input }];
  writeBundle(other.pilot, { ...other.declaration, checkpoints: inputs.map(row => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash })) }, inputs);
  assert.throws(() => verifyInfraAnnotationSource(other.pilot, other.directory), /training family/);
});

test("expanded grading cohort records and revalidates the original parent proof and unchanged audit", () => {
  const f = fixture(), predictions = join(f.directory, "predictions"); mkdirSync(predictions);
  const rows = f.publicRows.map(row => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash,
    family_id: row.family_id, split: row.split, status: "not_dispatched" }));
  const manifest = { kind: "uncalibrated_prediction_replay", executionAllowed: false, inferGoals: true,
    sourceDatasetHash: JSON.parse(readFileSync(join(f.directory, "manifest.json"), "utf8")).bundle_hash,
    model: INFRA_MODEL_PINS.predictor, memoryHash: hash("memory"), predictorContractHash: hash("prompt"),
    candidateCompilerHash: hash("compiler"), retrievalHash: hash("retrieval"), rowIds: rows.map(row => row.checkpoint_id) };
  writeFileSync(join(predictions, "manifest.json"), canonical({ ...manifest, contentHash: hash(manifest) }));
  writeFileSync(join(predictions, "predictions.jsonl"), rows.map(row => canonical(row) + "\n").join(""));
  writeFileSync(join(predictions, "receipt.json"), canonical({ declared: rows.length, completed: 0, failed: rows.length,
    liveActorExecuted: false, toolExecutionPerformed: false }));
  const output = join(f.directory, "expanded");
  const result = expandInfraAnnotationCohort({ bundle: f.directory, pilot: f.pilot, predictions, output });
  assert.equal(result.addedCount, 1);
  const verified = verifyInfraAnnotationSource(output, f.directory);
  assert.deepEqual(verified.declaration.audit, f.declaration.audit);
  assert.deepEqual(verified.originalAuditSource, verified.declaration.expansion?.originalAuditSource);
  const declaration = JSON.parse(readFileSync(join(output, "pilot.json"), "utf8"));
  declaration.expansion.originalAuditSource.publicSha256 = hash("changed raw source");
  writeBundle(output, declaration, verified.rows);
  assert.throws(() => verifyInfraAnnotationSource(output, f.directory), /parent proof changed/);
});
