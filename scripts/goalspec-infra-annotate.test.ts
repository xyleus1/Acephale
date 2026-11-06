import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Response } from "openai/resources/responses/responses";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { RESEARCH_MODELS, ResponsesModelPort, type ModelRequest } from "../src/lib/goalspec/model";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { bindTeacherDraft, compileTeacherInput, runInfraAnnotations, type InfraAnnotationInput, type TeacherFactory } from "./goalspec-infra-annotate";
import { verifyInfraAnnotationSource } from "./goalspec-infra-annotation-source";

function input(index = 0): InfraAnnotationInput {
  const value = { policy: "Read only. Explicit approval is required for changes.", tools: [], events: [],
    sources: [{ id: "policy", kind: "policy", value: "Read only. Explicit approval is required for changes." }, { id: "event:0", kind: "user", value: `Find document ${index}` }] };
  return { checkpoint_id: hash(["fixture", index]), input_hash: hash(value), request_revision: "r1", input: value };
}
const draft = { unknown_probability: .1, goals: [{ action: "retrieve", object_type: "document", objective: "Find the requested document",
  confidence: .9, sources: [{ source_id: "event:0", pointer: "" }], constraints: [] }] };

function writeBundle(directory: string, documents: Record<string, unknown>) {
  mkdirSync(directory, { recursive: true });
  const files: Record<string, { sha256: string; rows: number | null }> = {};
  for (const [name, value] of Object.entries(documents)) {
    const path = join(directory, name);
    writeFileSync(path, name.endsWith(".jsonl") ? (value as unknown[]).map(row => canonical(row) + "\n").join("") : canonical(value));
    files[name] = { sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), rows: name.endsWith(".jsonl") ? (value as unknown[]).length : null };
  }
  const bundleHash = hash(files);
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "goalspec-infra-data-v1", files, bundle_hash: bundleHash }));
  return bundleHash;
}

function fixture(separate = false) {
  const directory = resolve("research/goalspec/runs", `infra-annotation-test-${randomUUID()}`);
  const pilotDirectory = join(directory, "pilot"); mkdirSync(pilotDirectory, { recursive: true });
  const datasetDirectory = separate ? join(directory, "dataset") : pilotDirectory;
  const rows = [input(0), input(1)];
  const metadata = [{ episode_id: "one", family_id: "fitting", verification_tier: "source_reported" }];
  const split = { schema_version: "goalspec-infra-data-v1", families: { fitting: "train" }, episodes: { one: "fitting" }, metadata_hash: hash(metadata) };
  const datasetDocuments = { "split.json": split, "metadata.jsonl": metadata,
    "public.jsonl": rows.map(row => ({ ...row, schema_version: "goalspec-infra-data-v1", episode_id: "one", family_id: "fitting", split: "train" })) };
  const datasetHash = separate ? writeBundle(datasetDirectory, datasetDocuments) : undefined;
  const declaration = { schema_version: "goalspec-infra-data-v1", pilot_count: 2, audit_count: 1,
    checkpoints: rows.map(row => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash })),
    audit: [{ checkpoint_id: rows[0].checkpoint_id, reason: "seeded_random" }],
    ...(separate ? { source_dataset_hash: datasetHash, source_split_hash: hash(split) } : {}) };
  const pilotDocuments = { ...(separate ? {} : datasetDocuments), "pilot.json": declaration, "annotation-inputs.jsonl": rows };
  const expectedPilotHash = writeBundle(pilotDirectory, pilotDocuments);
  const ledgerPath = join(directory, "budget.jsonl");
  const durable = new DurableBudget(ledgerPath);
  durable.ledger.reserve("historical-unresolved", "heldout", 10_000); durable.close();
  return { pilotDirectory, datasetDirectory, expectedPilotHash, ledgerPath, output: join(directory, "out"), rows, datasetDocuments, pilotDocuments };
}

test("teacher input is prefix-only, bounded and hashes are server-owned", () => {
  const row = input();
  const compiled = compileTeacherInput(row, "test");
  assert.equal(compiled.request.model, RESEARCH_MODELS.teacher);
  assert.equal(compiled.request.maxOutputTokens, 1024);
  assert.equal(compiled.request.retries, 0);
  assert.equal(compiled.request.allocation, "preparation");
  assert(compiled.tokens <= 8192);
  assert(!canonical(compiled.request.input).includes("checkpoint_id"));
  const annotation = bindTeacherDraft(draft, row, compiled.selectedSourceIds);
  assert.equal(annotation.goals[0].sources[0].value_hash, hash("Find document 0"));
  assert.equal(annotation.input_hash, row.input_hash);
  assert.equal(annotation.request_revision, "r1");
  assert.throws(() => bindTeacherDraft({ ...draft, goals: [{ ...draft.goals[0], sources: [{ source_id: "future", pointer: "" }] }] }, row, compiled.selectedSourceIds), /schema/);
  assert.throws(() => bindTeacherDraft({ ...draft, unknown_probability: .8 }, row, compiled.selectedSourceIds), /probability/);
});

test("teacher rejects private joins and oversized mandatory user requirements", () => {
  const row = input();
  row.input.sources[1].value = { referenceActions: ["private"] } as unknown as string;
  row.input_hash = hash(row.input);
  assert.throws(() => compileTeacherInput(row, "test"), /Private field/);
  const large = input(); large.input.sources[1].value = "requirement ".repeat(20_000); large.input_hash = hash(large.input);
  assert.throws(() => compileTeacherInput(large, "test"), /input budget/);
});

test("teacher closes complete cohort and preserves original unresolved reservations", async () => {
  const options = fixture(); const calls: ModelRequest[] = [];
  const factory: TeacherFactory = (ledger, record) => {
    const port = new ResponsesModelPort(async params => ({ model: params.model, status: "completed", output: [], output_text: canonical(draft), usage: { input_tokens: 20, output_tokens: 20 } }) as unknown as Promise<Response>, ledger, () => 100, record);
    return { async complete(request) { calls.push(request); return port.complete(request); } };
  };
  const summary = await runInfraAnnotations(options, factory);
  assert.equal(summary.planned, 2); assert.equal(summary.retained, 2); assert.equal(summary.completed, 2);
  assert.equal(summary.knownMicrodollars, 200); assert.equal(summary.humanAuditsPending, 1);
  assert.equal(calls.length, 2); assert(calls.every(call => call.maximumAttemptMicrodollars === 35840));
  const durable = new DurableBudget(options.ledgerPath);
  const rows = durable.ledger.snapshot(); durable.close();
  assert.equal(rows.find(row => row.id === "historical-unresolved")?.actual, undefined);
  assert.equal(rows.filter(row => row.parentId).length, 2);
  assert.equal(rows.find(row => row.id.startsWith("goalspec-infra-annotation-v1:") && !row.parentId)?.actual, 200);
  const annotation = JSON.parse(readFileSync(join(options.output, "annotations.jsonl"), "utf8").split("\n")[0]);
  assert.equal(annotation.teacher_model, RESEARCH_MODELS.teacher);
  assert.equal(annotation.goals[0].sources[0].value_hash, hash("Find document 0"));
  await assert.rejects(runInfraAnnotations(options, factory), /New output/);
});

test("teacher retains failed network rows and uncertain charge maximum", async () => {
  const options = fixture(); let attempts = 0;
  const factory: TeacherFactory = (ledger, record) => new ResponsesModelPort(async params => {
    attempts++; if (attempts === 1) throw new Error("test network interruption");
    return { model: params.model, status: "completed", output: [], output_text: canonical(draft), usage: { input_tokens: 20, output_tokens: 20 } } as unknown as Response;
  }, ledger, () => 100, record);
  const summary = await runInfraAnnotations(options, factory);
  assert.equal(summary.retained, 2); assert.equal(summary.completed, 1); assert.equal(summary.failed, 1);
  assert.equal(summary.unresolvedRequests, 1); assert.equal(attempts, 2);
  const results = readFileSync(join(options.output, "results.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(results[0].annotation, null); assert.equal(results[0].status, "failed");
  const durable = new DurableBudget(options.ledgerPath);
  assert.equal(durable.ledger.snapshot().find(row => row.id.startsWith("goalspec-infra-annotation-v1:") && !row.parentId)?.actual, undefined);
  durable.close();
});

test("teacher refuses a fresh empty budget ledger", async () => {
  const options = fixture(); writeFileSync(options.ledgerPath, "");
  await assert.rejects(runInfraAnnotations(options, () => { throw new Error("must not dispatch"); }), /existing nonempty/);
});

test("teacher initialization failure retains every undispatched row", async () => {
  const options = fixture();
  const summary = await runInfraAnnotations(options, () => { throw new Error("test provider initialization failure"); });
  assert.equal(summary.retained, 2); assert.equal(summary.notDispatched, 2);
  assert.equal(summary.completed, 0); assert.equal(summary.knownMicrodollars, 0);
  const durable = new DurableBudget(options.ledgerPath);
  assert.equal(durable.ledger.snapshot().filter(row => row.parentId).length, 0);
  assert.equal(durable.ledger.snapshot().find(row => row.id.startsWith("goalspec-infra-annotation-v1:") && !row.parentId)?.actual, 0);
  durable.close();
});

test("teacher accepts separately frozen generic pilots without upgrading source verification", async () => {
  const options = fixture(true);
  const factory: TeacherFactory = (ledger, record) => new ResponsesModelPort(async params => ({ model: params.model, status: "completed", output: [], output_text: canonical(draft), usage: { input_tokens: 20, output_tokens: 20 } }) as unknown as Promise<Response>, ledger, () => 100, record);
  const summary = await runInfraAnnotations(options, factory);
  assert.equal(summary.completed, 2);
  assert.deepEqual(summary.sourceVerificationTiers, ["source_reported"]);
  assert.equal(summary.semanticTruthEstablished, false);
  assert.equal(summary.heldoutClaim, false);
  assert.equal(summary.sourceDatasetHash, options.pilotDocuments["pilot.json"].source_dataset_hash);
});

test("teacher rejects republished but unbound public inputs before provider creation", async () => {
  const options = fixture(true); let dispatched = false;
  options.rows[0].input.sources[1].value = "Future request injected";
  options.rows[0].input_hash = hash(options.rows[0].input);
  options.pilotDocuments["pilot.json"].checkpoints[0].input_hash = options.rows[0].input_hash;
  options.expectedPilotHash = writeBundle(options.pilotDirectory, options.pilotDocuments);
  await assert.rejects(runInfraAnnotations(options, () => { dispatched = true; throw new Error("unexpected"); }), /frozen public prefix/);
  assert.equal(dispatched, false);
});

test("teacher rejects source dataset rebinding and heldout or development families", () => {
  const options = fixture(true);
  options.datasetDocuments["split.json"].families.fitting = "development";
  for (const row of options.datasetDocuments["public.jsonl"]) row.split = "development";
  const changedHash = writeBundle(options.datasetDirectory, options.datasetDocuments);
  assert.throws(() => verifyInfraAnnotationSource(options.pilotDirectory, options.datasetDirectory), /binding mismatch/);
  options.pilotDocuments["pilot.json"].source_dataset_hash = changedHash;
  options.pilotDocuments["pilot.json"].source_split_hash = hash(options.datasetDocuments["split.json"]);
  writeBundle(options.pilotDirectory, options.pilotDocuments);
  assert.throws(() => verifyInfraAnnotationSource(options.pilotDirectory, options.datasetDirectory), /training family/);
});

test("teacher rejects modified files whose immutable manifest was not republished", () => {
  const options = fixture(true);
  writeFileSync(join(options.datasetDirectory, "public.jsonl"), "[]\n");
  assert.throws(() => verifyInfraAnnotationSource(options.pilotDirectory, options.datasetDirectory), /artifact changed/);
});
