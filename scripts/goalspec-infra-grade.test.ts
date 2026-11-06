import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Response } from "openai/resources/responses/responses";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import type { GoalSet } from "../src/lib/goalspec/contracts/generated";
import { INFRA_MODEL_PINS } from "../src/lib/goalspec/infra-manifest";
import { RESEARCH_MODELS, ResponsesModelPort } from "../src/lib/goalspec/model";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { bindTeacherDraft, type TeacherFactory } from "./goalspec-infra-annotate";
import { verifyInfraAnnotationSource } from "./goalspec-infra-annotation-source";
import { compileInfraGrade, expandInfraAnnotationCohort, runInfraGoalGrading, verifyInfraGoalReplay } from "./goalspec-infra-grade";

function bundle(directory: string, values: Record<string, unknown>) {
  mkdirSync(directory, { recursive: true });
  const files: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    writeFileSync(join(directory, name), name.endsWith(".jsonl") ? (value as unknown[]).map(row => canonical(row) + "\n").join("") : canonical(value));
    files[name] = { sha256: createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"), rows: name.endsWith(".jsonl") ? (value as unknown[]).length : null };
  }
  const bundleHash = hash(files);
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "goalspec-infra-data-v1", files, bundle_hash: bundleHash }));
  return bundleHash;
}
function fixture(count = 3) {
  const directory = mkdtempSync(join(tmpdir(), "infra-grades-"));
  const publicRows = Array.from({ length: count + 1 }, (_, index) => {
    const request = `Find order ${index}`;
    const input = { policy: "Read only", tools: [], sources: [{ id: "policy", kind: "policy", value: "Read only" },
      { id: "event:0", kind: "user", value: request }], events: [{ seq: 0, kind: "message", role: "user", content: request }] };
    return { schema_version: "goalspec-infra-data-v1", checkpoint_id: hash(index), input_hash: hash(input), request_revision: "r1",
      input, episode_id: `ep-${index}`, family_id: index === count ? "dev" : "train", split: index === count ? "development" : "train",
      domain: "retail", through_seq: 0, environment_version: "fixture", tool_schema_hash: hash([]),
      scope: { tenant_id: "tenant", principal_id: "principal", authorization_revision: "r1" } };
  });
  const metadata = publicRows.map(row => ({ episode_id: row.episode_id, family_id: row.family_id, verification_tier: "source_reported" }));
  const split = { schema_version: "goalspec-infra-data-v1", families: { train: "train", dev: "development" },
    episodes: Object.fromEntries(metadata.map(row => [row.episode_id, row.family_id])),
    metadata_hash: hash([...metadata].sort((a, b) => a.episode_id.localeCompare(b.episode_id))) };
  const dataset = join(directory, "dataset"), pilot = join(directory, "pilot"), predictionsDirectory = join(directory, "predictions");
  const datasetHash = bundle(dataset, { "public.jsonl": publicRows, "metadata.jsonl": metadata, "split.json": split,
    "labels.jsonl": [{ privateOutcome: "FUTURE_OUTCOME_SENTINEL" }] });
  const first = publicRows[0], annotationInputs = [{ checkpoint_id: first.checkpoint_id, input_hash: first.input_hash, request_revision: first.request_revision, input: first.input }];
  const declaration = { schema_version: "goalspec-infra-data-v1", pilot_count: 1, audit_count: 1,
    checkpoints: annotationInputs.map(row => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash })),
    audit: [{ checkpoint_id: first.checkpoint_id, reason: "original-selection" }], source_dataset_hash: datasetHash, source_split_hash: hash(split) };
  bundle(pilot, { "pilot.json": declaration, "annotation-inputs.jsonl": annotationInputs });
  const predictions = publicRows.map((row, index) => {
    const goals: GoalSet = { schemaVersion: 1, hypotheses: [{ id: "goal", probability: 1, objective: `Find order ${index}`,
      sources: [{ sourceId: "event:0", path: [] }], constraints: [] }], unknown: 0, revisionHash: hash([]) };
    return { checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, family_id: row.family_id, split: row.split, status: "completed" as const, goals };
  });
  const predictionManifest = { version: 1, kind: "uncalibrated_prediction_replay", executionAllowed: false, inferGoals: true,
    sourceDatasetHash: datasetHash, model: INFRA_MODEL_PINS.predictor, memoryHash: hash("memory"), predictorContractHash: hash("prompt"),
    candidateCompilerHash: hash("compiler"), rowIds: predictions.map(row => row.checkpoint_id) };
  mkdirSync(predictionsDirectory);
  writeFileSync(join(predictionsDirectory, "manifest.json"), canonical({ ...predictionManifest, contentHash: hash(predictionManifest) }));
  writeFileSync(join(predictionsDirectory, "predictions.jsonl"), predictions.map(row => canonical(row) + "\n").join(""));
  writeFileSync(join(predictionsDirectory, "receipt.json"), canonical({ declared: predictions.length, completed: predictions.length, failed: 0, liveActorExecuted: false, toolExecutionPerformed: false }));
  const annotations = publicRows.slice(0, count).map((row, index) => bindTeacherDraft({ unknown_probability: 0,
    goals: [{ action: "retrieve", object_type: "order", objective: `Find order ${index}`, confidence: 1,
      sources: [{ source_id: "event:0", pointer: "" }], constraints: [] }] }, row, ["policy", "event:0"]));
  const annotationPath = join(directory, "annotations.jsonl");
  writeFileSync(annotationPath, annotations.map(row => canonical(row) + "\n").join(""));
  const ledgerPath = join(directory, "budget.jsonl"), ledger = new DurableBudget(ledgerPath);
  ledger.ledger.reserve("existing-unknown", "heldout", 10_000); ledger.close();
  const options = { bundle: dataset, predictions: predictionsDirectory, annotations: annotationPath, ledgerPath,
    output: join(directory, "grades"), expectedPredictionManifestHash: hash(predictionManifest), expectedAnnotationsHash: hash(annotations) };
  return { directory, options, pilot, publicRows, predictions, annotations };
}

const grade = { agreed: true, missing_constraints: [], contradictions: [], reason: "Full requested intent matches" };
const model: TeacherFactory = (ledger, record) => new ResponsesModelPort(async params => ({ model: params.model, status: "completed",
  output: [], output_text: canonical(grade), usage: { input_tokens: 20, output_tokens: 20 } }) as unknown as Promise<Response>, ledger, () => 100, record);

test("expanded annotation cohort preserves original audit exactly and covers all training predictions", () => {
  const fixtureData = fixture();
  try {
    const { options, pilot } = fixtureData, output = join(fixtureData.directory, "expanded");
    const result = expandInfraAnnotationCohort({ bundle: options.bundle, predictions: options.predictions, pilot, output });
    assert.equal(result.addedCount, 2); assert.equal(result.totalCount, 3); assert.equal(result.paidCalls, 0);
    const verified = verifyInfraAnnotationSource(output, options.bundle);
    assert.deepEqual(verified.declaration.audit, JSON.parse(readFileSync(join(pilot, "pilot.json"), "utf8")).audit);
    assert.deepEqual(verified.rows.map(row => row.checkpoint_id), fixtureData.publicRows.slice(0, 3).map(row => row.checkpoint_id));
    assert.throws(() => expandInfraAnnotationCohort({ bundle: options.bundle, predictions: options.predictions, pilot, output }), /new/);
  } finally { rmSync(fixtureData.directory, { recursive: true, force: true }); }
});

test("grading prompt is blind to future labels and bounded with frozen model and no retry", () => {
  const f = fixture();
  try {
    const request = compileInfraGrade(f.publicRows[0], f.predictions[0], f.annotations[0], "grade");
    assert.equal(request.model, RESEARCH_MODELS.teacher); assert.equal(request.retries, 0);
    assert.equal(request.allocation, "preparation");
    assert(!canonical(request).includes("FUTURE_OUTCOME_SENTINEL"));
    assert(!canonical(request.input).includes("family_id"));
    assert(canonical(request.input).includes("Find order 0"));
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("grading closes the full training cohort and preserves original unresolved costs", async () => {
  const f = fixture();
  try {
    const result = await runInfraGoalGrading(f.options, model);
    assert.equal(result.retained, 3); assert.equal(result.completed, 3); assert.equal(result.agreed, 3);
    assert.equal(result.knownMicrodollars, 300); assert.equal(result.closed, true);
    const grades = readFileSync(join(f.options.output, "grades.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert(grades.every((row, i) => row.predictionGoalHash === hash(f.predictions[i].goals) && row.annotationHash === hash(f.annotations[i])));
    const ledger = new DurableBudget(f.options.ledgerPath);
    assert.equal(ledger.ledger.snapshot().find(row => row.id === "existing-unknown")?.actual, undefined);
    ledger.close();
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("transport and malformed grades remain false without retries or cost release", async () => {
  const f = fixture(); let calls = 0;
  try {
    const factory: TeacherFactory = (ledger, record) => new ResponsesModelPort(async params => {
      calls++;
      if (calls === 1) throw new Error("fixture unknown transport");
      return { model: params.model, status: "completed", output: [], output_text: canonical(calls === 2 ? { ...grade, missing_constraints: ["missing date"] } : grade), usage: { input_tokens: 20, output_tokens: 20 } } as unknown as Response;
    }, ledger, () => 100, record);
    const result = await runInfraGoalGrading(f.options, factory);
    assert.equal(calls, 3); assert.equal(result.retained, 3); assert.equal(result.agreed, 1); assert.equal(result.unresolvedRequests, 1);
    const ledger = new DurableBudget(f.options.ledgerPath);
    assert.equal(ledger.ledger.snapshot().find(row => row.id.startsWith("goalspec-infra-grade-v1:") && !row.parentId)?.actual, undefined);
    ledger.close();
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("incomplete annotation coverage and tampered replay refuse provider construction", async () => {
  const f = fixture(); let called = false;
  try {
    writeFileSync(f.options.annotations, canonical(f.annotations[0]) + "\n");
    await assert.rejects(runInfraGoalGrading({ ...f.options, expectedAnnotationsHash: hash([f.annotations[0]]) }, () => { called = true; throw new Error("unexpected"); }), /Every declared/);
    assert.equal(called, false);
    writeFileSync(join(f.options.predictions, "receipt.json"), "{}");
    assert.throws(() => verifyInfraGoalReplay(f.options.bundle, f.options.predictions), /receipt/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("failed predictions retain a bound false grade without a grading request", async () => {
  const f = fixture(); let calls = 0;
  try {
    const rows = f.predictions.map((row, index) => index === 0 ? { ...row, goals: undefined, status: "failed" } : row);
    writeFileSync(join(f.options.predictions, "predictions.jsonl"), rows.map(row => JSON.stringify(row) + "\n").join(""));
    writeFileSync(join(f.options.predictions, "receipt.json"), canonical({ declared: rows.length, completed: rows.length - 1,
      failed: 1, liveActorExecuted: false, toolExecutionPerformed: false }));
    const factory: TeacherFactory = (ledger, record) => {
      const port = model(ledger, record);
      return { complete(request) { calls++; return port.complete(request); } };
    };
    const result = await runInfraGoalGrading(f.options, factory);
    const first = JSON.parse(readFileSync(join(f.options.output, "grades.jsonl"), "utf8").split("\n")[0]);
    assert.equal(result.retained, 3); assert.equal(calls, 2);
    assert.equal(first.predictionGoalHash, null); assert.equal(first.agreed, false); assert.equal(first.status, "prediction_miss");
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("annotation expansion enforces unchanged cap without silently dropping rows", () => {
  const f = fixture(140);
  try {
    assert.throws(() => expandInfraAnnotationCohort({ bundle: f.options.bundle, predictions: f.options.predictions, pilot: f.pilot,
      output: join(f.directory, "expanded") }), /five-dollar cap/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
