import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Response } from "openai/resources/responses/responses";
import { canonical, hash } from "../src/lib/acephale/canonical";
import type { GoalSet } from "../src/lib/acephale/contracts/generated";
import { INFRA_MODEL_PINS } from "../src/lib/acephale/infra-manifest";
import { RESEARCH_MODELS, ResponsesModelPort } from "../src/lib/acephale/model";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { bindTeacherDraft, type TeacherFactory } from "./acephale-infra-annotate";
import { verifyInfraAnnotationSource } from "./acephale-infra-annotation-source";
import { compileInfraGrade, expandInfraAnnotationCohort, runInfraGoalGrading, verifyInfraGoalReplay } from "./acephale-infra-grade";

function bundle(directory: string, values: Record<string, unknown>) {
  mkdirSync(directory, { recursive: true });
  const files: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    writeFileSync(join(directory, name), name.endsWith(".jsonl") ? (value as unknown[]).map(row => canonical(row) + "\n").join("") : canonical(value));
    files[name] = { sha256: createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"), rows: name.endsWith(".jsonl") ? (value as unknown[]).length : null };
  }
  const bundleHash = hash(files);
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "acephale-infra-data-v1", files, bundle_hash: bundleHash }));
  return bundleHash;
}
function fixture(count = 3, trainingFamilies?: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "infra-grades-"));
  const publicRows = Array.from({ length: count + 1 }, (_, index) => {
    const request = `Find order ${index}`;
    const input = { policy: "Read only", tools: [], sources: [{ id: "policy", kind: "policy", value: "Read only" },
      { id: "event:0", kind: "user", value: request }], events: [{ seq: 0, kind: "message", role: "user", content: request }] };
    return { schema_version: "acephale-infra-data-v1", checkpoint_id: hash(index), input_hash: hash(input), request_revision: "r1",
      input, episode_id: `ep-${index}`, family_id: index === count ? "dev" : trainingFamilies?.[index] ?? "train", split: index === count ? "development" : "train",
      domain: "retail", through_seq: 0, environment_version: "fixture", tool_schema_hash: hash([]),
      scope: { tenant_id: "tenant", principal_id: "principal", authorization_revision: "r1" } };
  });
  const metadata = publicRows.map(row => ({ episode_id: row.episode_id, family_id: row.family_id, verification_tier: "source_reported" }));
  const split = { schema_version: "acephale-infra-data-v1", families: Object.fromEntries(publicRows.map(row => [row.family_id, row.split])),
    episodes: Object.fromEntries(metadata.map(row => [row.episode_id, row.family_id])),
    metadata_hash: hash([...metadata].sort((a, b) => a.episode_id.localeCompare(b.episode_id))) };
  const dataset = join(directory, "dataset"), pilot = join(directory, "pilot"), predictionsDirectory = join(directory, "predictions");
  const datasetHash = bundle(dataset, { "public.jsonl": publicRows, "metadata.jsonl": metadata, "split.json": split,
    "labels.jsonl": [{ privateOutcome: "FUTURE_OUTCOME_SENTINEL" }] });
  const first = publicRows[0], annotationInputs = [{ checkpoint_id: first.checkpoint_id, input_hash: first.input_hash, request_revision: first.request_revision, input: first.input }];
  const declaration = { schema_version: "acephale-infra-data-v1", pilot_count: 1, audit_count: 1,
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
    candidateCompilerHash: hash("compiler"), retrievalHash: hash("retrieval"), rowIds: predictions.map(row => row.checkpoint_id) };
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

function trainedReplay(f: ReturnType<typeof fixture>, calibrationFamilies: string[]) {
  const weights = hash("derived weights"), body = { schemaVersion: 1, kind: "acephale-trained-predictor",
    base: INFRA_MODEL_PINS.predictor, adapterHash: hash("adapter"), mergedWeightsHash: weights,
    tokenizerHash: hash("tokenizer"), chatTemplateHash: hash("template"), trainingManifestHash: hash("training"),
    weightFitFamilies: ["fit"], calibrationFamilies, protocol: "rank_binary_v1", binaryTokenIds: { zero: 15, one: 16 },
    servedModel: `acephale-predictor-${weights.slice(0, 12)}` };
  const path = join(f.options.predictions, "manifest.json");
  const { contentHash: _previousHash, ...manifest } = JSON.parse(readFileSync(path, "utf8"));
  manifest.model = { ...INFRA_MODEL_PINS.predictor, trainedPredictor: { ...body, contentHash: hash(body) } };
  f.options.expectedPredictionManifestHash = hash(manifest);
  writeFileSync(path, canonical({ ...manifest, contentHash: hash(manifest) }));
}

const grade = { agreed: true, missing_constraints: [], contradictions: [], reason: "Full requested intent matches" };
const model: TeacherFactory = (ledger, record) => new ResponsesModelPort(async params => ({ model: params.model, status: "completed",
  output: [], output_text: canonical(grade), usage: { input_tokens: 20, output_tokens: 20 } }) as unknown as Promise<Response>, ledger, () => 100, record);

function retainedResponses(f: ReturnType<typeof fixture>) {
  const directory = f.options.predictions;
  const { contentHash: _oldHash, ...manifest } = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  manifest.responseRetentionVersion = 1;
  f.options.expectedPredictionManifestHash = hash(manifest);
  writeFileSync(join(directory, "manifest.json"), canonical({ ...manifest, contentHash: hash(manifest) }));
  const records = f.predictions.map((row, index) => {
    const continuation = [{ role: "assistant", content: canonical(row.goals) }];
    const body = { version: 1, requestId: `goal-${index}`, inputHash: hash(["input", index]),
      requestContractHash: hash("goal contract"), continuation, responseHash: hash(continuation) };
    const response = { ...body, contentHash: hash(body) };
    Object.assign(row, { audit: { events: [{ type: "model_response_retained", requestId: body.requestId,
      inputHash: body.inputHash, requestContractHash: body.requestContractHash,
      responseHash: body.responseHash, responsePayloadHash: response.contentHash }] } });
    return { checkpoint_id: row.checkpoint_id, publicInputHash: row.input_hash, response };
  });
  writeFileSync(join(directory, "predictions.jsonl"), f.predictions.map(row => canonical(row) + "\n").join(""));
  const receipt = JSON.parse(readFileSync(join(directory, "receipt.json"), "utf8"));
  receipt.responsePayloads = { version: 1, file: "model-responses.jsonl", count: records.length, sha256: "" };
  const reseal = () => {
    writeFileSync(join(directory, "model-responses.jsonl"), records.map(row => canonical(row) + "\n").join(""));
    receipt.responsePayloads.sha256 = createHash("sha256").update(readFileSync(join(directory, "model-responses.jsonl"))).digest("hex");
    writeFileSync(join(directory, "receipt.json"), canonical(receipt));
  };
  reseal();
  return { records, receipt, reseal };
}

test("goal grading accepts and verifies retained response receipts", async () => {
  const f = fixture();
  try {
    retainedResponses(f);
    assert.equal(verifyInfraGoalReplay(f.options.bundle, f.options.predictions).evidenceHashes.size, 2);
    const result = await runInfraGoalGrading(f.options, model);
    assert.equal(result.retained, 3); assert.equal(result.agreed, 3);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

for (const defect of ["version", "file", "count", "outer_hash", "inner_hash", "checkpoint_order", "request", "audit", "missing_declaration"]) {
  test(`goal grading rejects retained-response ${defect} tampering before dispatch`, async () => {
    const f = fixture(); let called = false;
    try {
      const r = retainedResponses(f);
      if (defect === "version") r.receipt.responsePayloads.version = 2;
      if (defect === "file") r.receipt.responsePayloads.file = "../model-responses.jsonl";
      if (defect === "count") r.receipt.responsePayloads.count++;
      if (defect === "inner_hash") r.records[0].response.continuation[0].content = "changed";
      if (defect === "checkpoint_order") r.records.reverse();
      if (defect === "request") {
        const response = r.records[0].response;
        response.requestId = "another-request";
        const { contentHash: _oldHash, ...body } = response;
        response.contentHash = hash(body);
      }
      r.reseal();
      if (defect === "outer_hash") writeFileSync(join(f.options.predictions, "model-responses.jsonl"), "{}\n");
      if (defect === "audit") {
        writeFileSync(join(f.options.predictions, "predictions.jsonl"), f.predictions.map(row => {
          const { audit: _audit, ...body } = row as typeof row & { audit: unknown }; return canonical(body) + "\n";
        }).join(""));
      }
      if (defect === "missing_declaration") {
        delete r.receipt.responsePayloads;
        writeFileSync(join(f.options.predictions, "receipt.json"), canonical(r.receipt));
      }
      await assert.rejects(runInfraGoalGrading(f.options, () => { called = true; return model({} as never, () => {}); }), /[Rr]etained/);
      assert.equal(called, false);
    } finally { rmSync(f.directory, { recursive: true, force: true }); }
  });
}

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
    assert.equal(ledger.ledger.snapshot().find(row => row.id.startsWith("acephale-infra-grade-v1:") && !row.parentId)?.actual, undefined);
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

test("trained goal replay and annotation expansion select calibration families only", async () => {
  const f = fixture(4, ["fit", "cal-a", "cal-b", "fit"]);
  try {
    const base = verifyInfraGoalReplay(f.options.bundle, f.options.predictions);
    assert.equal(base.training.length, 4);
    trainedReplay(f, ["cal-a", "cal-b"]);
    const replay = verifyInfraGoalReplay(f.options.bundle, f.options.predictions);
    assert.deepEqual(replay.training.map(row => row.checkpoint_id), f.predictions.slice(1, 3).map(row => row.checkpoint_id));
    const output = join(f.directory, "expanded");
    const expanded = expandInfraAnnotationCohort({ bundle: f.options.bundle, predictions: f.options.predictions, pilot: f.pilot, output });
    assert.equal(expanded.addedCount, 2);
    assert.deepEqual(verifyInfraAnnotationSource(output, f.options.bundle).rows.map(row => row.checkpoint_id),
      f.publicRows.slice(0, 3).map(row => row.checkpoint_id));
    const grades = await runInfraGoalGrading(f.options, model);
    assert.equal(grades.retained, 2);
    assert.equal(grades.completed, 2);
    assert.equal(grades.knownMicrodollars, 200);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("trained goal replay requires every calibration family and retains failed calibration rows", async () => {
  const f = fixture(3, ["fit", "cal-a", "cal-b"]);
  try {
    trainedReplay(f, ["cal-a", "missing-calibration"]);
    assert.throws(() => verifyInfraGoalReplay(f.options.bundle, f.options.predictions), /every.*calibration family/);
    trainedReplay(f, ["cal-a", "cal-b"]);
    const rows = f.predictions.map((row, index) => {
      if (index !== 2) return row;
      const { goals: _goals, ...prefix } = row;
      return { ...prefix, status: "not_dispatched" };
    });
    writeFileSync(join(f.options.predictions, "predictions.jsonl"), rows.map(row => canonical(row) + "\n").join(""));
    writeFileSync(join(f.options.predictions, "receipt.json"), canonical({ declared: rows.length,
      completed: rows.length - 1, failed: 1, liveActorExecuted: false, toolExecutionPerformed: false }));
    const replay = verifyInfraGoalReplay(f.options.bundle, f.options.predictions);
    assert.equal(replay.training.length, 2);
    assert.equal(replay.training[1].status, "not_dispatched");
    const grades = await runInfraGoalGrading(f.options, model);
    assert.equal(grades.retained, 2);
    assert.equal(grades.completed, 1);
    assert.equal(grades.agreed, 1);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
