import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { BudgetLedger } from "../src/lib/goalspec/budget";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { createDeryaServerComposition, type DeryaServerDependencies } from "../src/lib/goalspec-adapters/derya-server";
import type { DeryaBootstrapConfiguration } from "../src/lib/goalspec-adapters/derya-bootstrap";
import { hash } from "../src/lib/goalspec/canonical";
import { coldDeryaController } from "./goalspec-derya-v5-live";

const operator = { userId: "operator", officeId: "office", accessKind: "operator", canViewWholeOffice: true };
const tools = [{ name: "search_jobs", input_schema: { type: "object", properties: {} } }];
function fixture() {
  const environment: Record<string, string | undefined> = {};
  const ledger = new BudgetLedger();
  const calls: string[] = [];
  let captured: DeryaBootstrapConfiguration | undefined;
  const dependencies: DeryaServerDependencies = {
    environment: () => environment,
    budget: () => { calls.push("budget-open"); return { ledger, close: () => { calls.push("budget-close"); } }; },
    events: () => { calls.push("events-open"); return { append: () => { calls.push("event"); }, close: () => { calls.push("events-close"); } }; },
    provider: (provided, allocation) => {
      assert.equal(provided, ledger); assert.equal(allocation, "preparation"); calls.push("provider");
      return { model: { complete: async () => { throw new Error("No paid dispatch in server composition tests"); } }, embed: async () => [] };
    },
    configure: options => { captured = options; calls.push("configure"); return { close: async () => { calls.push("runtime-close"); } }; },
    snapshot: () => { throw new Error("Unexpected snapshot access"); },
  };
  function configure() { Object.assign(environment, { DATABASE_URL: "postgresql://unused@127.0.0.1/goalspec_fixture", OPENAI_API_KEY: "unit-test-placeholder", GOALSPEC_DERYA_BUDGET_DIRECTORY: "research/goalspec/runs/unused-server-test" }); }
  return { environment, dependencies, configure, calls, captured: () => captured };
}

test("v5 server validates complete estimates before budget ownership and pins configured content", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-server-v5-"));
  const controllerPath = join(directory, "controller.json"), configPath = join(directory, "config.json");
  writeFileSync(controllerPath, JSON.stringify(coldDeryaController()));
  const value = fixture(); value.configure();
  value.environment.GOALSPEC_DERYA_V5_CONFIGURATION_FILE = configPath;
  const server = createDeryaServerComposition(value.dependencies);
  const config = { version: 1, controllerPath, actorContext: "literal", goalConditioning: false, exposeEvidence: true,
    estimate: { toolMs: 0, validationMs: 0, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 } };
  try {
    writeFileSync(configPath, JSON.stringify({ ...config, estimate: { toolMs: 1 } }));
    await assert.rejects(server.ensure(tools, operator), /Invalid Derya v5/);
    assert.deepEqual(value.calls, []);
    writeFileSync(configPath, JSON.stringify(config));
    await server.ensure(tools, operator);
    assert.equal(value.captured()?.v5?.actorContext, "literal");
    assert.deepEqual(value.captured()?.epochOptions, { mode: "off" });
    writeFileSync(configPath, JSON.stringify({ ...config, actorContext: "hypotheses" }));
    await assert.rejects(server.ensure(tools, operator), /configuration changed/);
  } finally {
    await server.close();
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("goalspec-server-v5-"));
    rmSync(directory, { recursive: true });
  }
});

test("Derya composition stays lazy, requires explicit budget/operator, and uses one shared ledger", async () => {
  const fixtureValue = fixture();
  const server = createDeryaServerComposition(fixtureValue.dependencies);
  assert.deepEqual(fixtureValue.calls, []);
  await server.ensure(tools, operator);
  assert.deepEqual(fixtureValue.calls, []);
  fixtureValue.configure();
  await server.ensure(tools);
  await server.ensure(tools, { ...operator, accessKind: "customer" });
  assert.deepEqual(fixtureValue.calls, []);
  await Promise.all([server.ensure(tools, operator), server.ensure(tools, operator)]);
  assert.equal(fixtureValue.calls.filter(c => c === "budget-open").length, 1);
  assert.equal(fixtureValue.calls.filter(c => c === "configure").length, 1);
  const configured = fixtureValue.captured()!;
  assert.equal(configured.maximumPredictionAttemptMicrodollars, Math.ceil(8192 * .4 + 1024 * 1.6));
  const scope = { tenantId: "office", principalId: "operator", authorizationVersion: "a", environmentVersion: "e", toolSchemaHash: "t" };
  const empty = await configured.snapshot(scope);
  assert.equal(empty?.purpose, "derya_business");
  assert.equal(empty?.tenantId, "office");
  assert.deepEqual(empty?.records, []);
  assert.equal(empty?.recordsHash, hash([]));
  await server.close();
  await server.close();
  assert.deepEqual(fixtureValue.calls.slice(-3), ["runtime-close", "events-close", "budget-close"]);
  await assert.rejects(() => server.ensure(tools, operator), /closed/);
});

test("Derya initialization failure releases ownership and can retry; changed schemas fail closed", async () => {
  const value = fixture(); value.configure();
  const original = value.dependencies.configure;
  let attempts = 0;
  value.dependencies.configure = configuration => {
    if (attempts++ === 0) throw new Error("Transient composition failure");
    return original(configuration);
  };
  const server = createDeryaServerComposition(value.dependencies);
  await assert.rejects(() => server.ensure(tools, operator), /Transient/);
  assert.deepEqual(value.calls.slice(-2), ["events-close", "budget-close"]);
  await server.ensure(tools, operator);
  await assert.rejects(() => server.ensure([{ name: "search_jobs", input_schema: { type: "object", properties: { limit: { type: "integer" } } } }], operator), /configuration changed/);
  await server.close();
});

test("Derya denies research corpus snapshots and distinct declared shared budgets before ownership", async () => {
  const value = fixture(); value.configure();
  value.environment.GOALSPEC_BUDGET_DIRECTORY = "different-global-budget";
  const server = createDeryaServerComposition(value.dependencies);
  await assert.rejects(() => server.ensure(tools, operator), /shared budget/);
  assert.deepEqual(value.calls, []);
  delete value.environment.GOALSPEC_BUDGET_DIRECTORY;
  value.environment.GOALSPEC_DERYA_SNAPSHOT_FILE = "unread-fixture-path";
  value.dependencies.snapshot = () => ({ schemaVersion: 1, purpose: "derya_business", source: "APIGen", snapshotId: "research", tenantId: "office", records: [], recordsHash: hash([]) }) as never;
  await assert.rejects(() => server.ensure(tools, operator), /business snapshots/);
  assert.deepEqual(value.calls, []);
  await server.close();
});

test("Derya shares actual durable budget lock and releases it even if event close fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-server-"));
  const value = fixture(); value.configure();
  value.environment.GOALSPEC_DERYA_BUDGET_DIRECTORY = directory;
  value.dependencies.budget = path => new DurableBudget(path);
  value.dependencies.provider = () => ({ model: { complete: async () => { throw new Error("No provider requests"); } }, embed: async () => [] });
  value.dependencies.events = () => ({ append: () => {}, close: () => { throw new Error("Event close failure"); } });
  const server = createDeryaServerComposition(value.dependencies);
  try {
    await server.ensure(tools, operator);
    assert(existsSync(join(directory, "budget.jsonl.lock")));
    assert.throws(() => new DurableBudget(join(directory, "budget.jsonl")), /EEXIST/);
    await assert.rejects(() => server.close(), /Event close failure/);
    assert(!existsSync(join(directory, "budget.jsonl.lock")));
    const recovered = new DurableBudget(join(directory, "budget.jsonl"));
    recovered.close();
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(basename(directory).startsWith("goalspec-server-"));
    rmSync(directory, { recursive: true, force: true });
  }
});

function controllerArtifactFixture() {
  const body = { version: "goalspec-controller-artifact-v1", featureVersion: "goalspec-controller-features-v1", goalFeaturePolicy: "public-request-only", inputDimension: 216,
    architecture: "logistic", layers: [{ weights: Array.from({ length: 5 }, () => Array(216).fill(0)), bias: [0, 0, 0, 0, 0], activation: "linear" }],
    heads: ["actionRead", "nextAction", "usefulWithin2", "readiness", "exposure"], trainedHeads: { actionRead: true, nextAction: true, usefulWithin2: true, readiness: true, exposure: false },
    calibration: { temperature: [1, 1, 1, 1, 1], bias: [0, 0, 0, 0, 0], method: "family-heldout-temperature-grid" }, thresholds: { actionRead: 0.5, usefulWithin2: 0.5, readiness: 0.5, exposure: 1 },
    lineage: { datasetHash: "a".repeat(64), trainFamilies: ["train"], selectionFamilies: ["selection"], calibrationFamilies: ["calibration"], baseOnly: true, seed: 1, selectedCheckpoint: "fixture", soupMembers: [], randomizedExposureDataHash: null, labelSemantics: "next-action-imitation;within-two-observed-use;readiness-is-not-authorization;exposure-masked" } };
  return { ...body, contentHash: hash(body) };
}
function actionKindArtifactFixture() {
  const body = { version: "goalspec-action-kind-artifact-v1", featureVersion: "goalspec-controller-features-v1", goalFeaturePolicy: "public-request-only",
    classes: ["read", "message", "write", "compute", "stop"], trained: [true, true, false, false, false],
    weights: Array.from({ length: 5 }, () => Array(216).fill(0)), bias: [0, 0, 0, 0, 0], temperature: 1,
    lineage: { datasetHash: "b".repeat(64), baseOnly: true, trainFamilies: ["train"], selectionFamilies: ["selection"], calibrationFamilies: ["calibration"], trainLabelCounts: [1, 1, 0, 0, 0], seed: 1, selectedEpoch: 1, stopLabelPolicy: "unavailable-without-explicit-public-actor-stop", roleMapHash: "c".repeat(64) } };
  return { ...body, contentHash: hash(body) };
}
function removeArtifactFixture(directory: string) {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert(basename(directory).startsWith("goalspec-server-artifacts-"));
  rmSync(directory, { recursive: true, force: true });
}
test("Derya loads selected controller and optional action kinds once, recording hashes without changing the execution gate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-server-artifacts-")), value = fixture(); value.configure();
  const main = controllerArtifactFixture(), auxiliary = actionKindArtifactFixture(), events: Record<string, unknown>[] = [];
  const controllerPath = join(directory, "controller.json"), actionKindPath = join(directory, "action-kind.json");
  writeFileSync(controllerPath, JSON.stringify(main)); writeFileSync(actionKindPath, JSON.stringify(auxiliary));
  value.environment.GOALSPEC_DERYA_CONTROLLER_FILE = controllerPath; value.environment.GOALSPEC_DERYA_ACTION_KIND_FILE = actionKindPath;
  value.dependencies.events = () => ({ append: event => { events.push(event as Record<string, unknown>); }, close: () => {} });
  const server = createDeryaServerComposition(value.dependencies);
  try {
    await Promise.all([server.ensure(tools, operator), server.ensure(tools, operator)]);
    const configured = value.captured()!;
    assert.deepEqual(configured.controllerArtifact, main); assert.deepEqual(configured.actionKindArtifact, auxiliary);
    assert.equal(configured.utilityEstimate, undefined);
    assert.equal(value.calls.filter(call => call === "configure").length, 1);
    assert.equal(events[0].controllerArtifactHash, main.contentHash); assert.equal(events[0].actionKindArtifactHash, auxiliary.contentHash);
    assert.equal(events[0].actionKindTelemetryOnly, true);
    value.environment.GOALSPEC_DERYA_ACTION_KIND_FILE = join(directory, "different-action-kind.json");
    await assert.rejects(() => server.ensure(tools, operator), /configuration changed/);
  } finally { await server.close(); removeArtifactFixture(directory); }
});
test("Derya auxiliary-only configuration remains optional and never substitutes for the main controller", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-server-artifacts-")), value = fixture(); value.configure();
  const actionKindPath = join(directory, "action-kind.json"); writeFileSync(actionKindPath, JSON.stringify(actionKindArtifactFixture()));
  value.environment.GOALSPEC_DERYA_ACTION_KIND_FILE = actionKindPath;
  const server = createDeryaServerComposition(value.dependencies);
  try {
    await server.ensure(tools, operator);
    assert.equal(value.captured()!.controllerArtifact, undefined);
    assert.equal(value.captured()!.actionKindArtifact?.trained[4], false);
    delete value.environment.GOALSPEC_DERYA_ACTION_KIND_FILE;
    await assert.rejects(() => server.ensure(tools, operator), /configuration changed/);
  } finally { await server.close(); removeArtifactFixture(directory); }
});
test("Derya rejects malformed or corrupt configured artifacts before owning the budget and can retry a repaired file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-server-artifacts-")), value = fixture(); value.configure();
  const path = join(directory, "action-kind.json"); value.environment.GOALSPEC_DERYA_ACTION_KIND_FILE = path;
  const server = createDeryaServerComposition(value.dependencies);
  try {
    await assert.rejects(() => server.ensure(tools, operator), /ENOENT/);
    writeFileSync(path, "not JSON"); await assert.rejects(() => server.ensure(tools, operator), SyntaxError);
    const corrupt = actionKindArtifactFixture(); corrupt.bias[0] = 2;
    writeFileSync(path, JSON.stringify(corrupt)); await assert.rejects(() => server.ensure(tools, operator), /hash/);
    assert.deepEqual(value.calls, []);
    writeFileSync(path, JSON.stringify(actionKindArtifactFixture()));
    value.environment.GOALSPEC_DERYA_CONTROLLER_FILE = join(directory, "controller.json");
    writeFileSync(value.environment.GOALSPEC_DERYA_CONTROLLER_FILE, "{}");
    await assert.rejects(() => server.ensure(tools, operator), /ControllerArtifact/);
    assert.deepEqual(value.calls, []);
    delete value.environment.GOALSPEC_DERYA_CONTROLLER_FILE;
    await server.ensure(tools, operator);
    assert.equal(value.calls.filter(call => call === "budget-open").length, 1);
  } finally { await server.close(); removeArtifactFixture(directory); }
});
