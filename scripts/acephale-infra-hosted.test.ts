import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BudgetLedger } from "../src/lib/acephale/budget";
import { hash } from "../src/lib/acephale/canonical";
import { RESEARCH_MODELS, type ModelRequest } from "../src/lib/acephale/model";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { attachInfraHostedWorkers, validateInfraHosted, validateInfraLedgerCheckpoint } from "../services/acephale-runtime/infra-hosted-workers";
import { writeInfraLedgerCheckpoint } from "./acephale-infra-native";
import { ResearchService } from "../services/acephale-runtime/service";
import { NativeGateway } from "../services/acephale-runtime/gateway-client";

const configuration = { allocation: "training" as const, maxCostMicrodollarsPerRun: 1_250_000,
  maxSteps: 10, maxErrors: 2, timeoutSeconds: 300 };
const boundary = { policy: "unchanged native policy", tools: [], messages: [{ role: "user" as const, content: "hello" }] };

test("native hosted ports preserve native prompts and never dispatch a hosted actor", async () => {
  const ledger = new BudgetLedger(), requests: ModelRequest[] = [], events: unknown[] = [];
  let actorCalls = 0, actorCloses = 0;
  const workers = attachInfraHostedWorkers([{ runId: "run", worker: {
    async decision() { actorCalls++; return { role: "assistant", content: "local Qwen" }; }, async close() { actorCloses++; },
  } }], configuration, ledger, event => events.push(event), (trial, allocation, record) => ({
    model: { async complete(request) {
      requests.push(request); trial.reserve(request.id, allocation, 100); trial.settle(request.id, 25);
      record({ type: "model_attempt", costMicrodollars: 25 });
      return { model: request.model, continuation: [], calls: [], text: "native text", status: "completed", refusals: [], usage: undefined };
    } }, embed: async () => [],
  }));
  assert.deepEqual(workers.map(worker => worker.runId), ["run", "run:user", "run:evaluator"]);
  await workers[0].worker.decision(boundary, "a");
  assert.equal(actorCalls, 1); assert.equal(requests.length, 0);
  assert.equal((await workers[1].worker.decision(boundary, "u") as { role: string }).role, "user");
  assert.equal((await workers[2].worker.decision(boundary, "j") as { role: string }).role, "assistant");
  assert.deepEqual(requests.map(request => request.model), [RESEARCH_MODELS.user, RESEARCH_MODELS.teacher]);
  assert.ok(requests.every(request => request.instructions === boundary.policy && request.retries === 0 && !request.tools));
  await workers[0].worker.close(); await workers[1].worker.close();
  assert.equal(ledger.snapshot().find(row => row.id === "infra:run")?.actual, undefined);
  await workers[2].worker.close(); await workers[0].worker.close();
  assert.equal(actorCloses, 1); assert.equal(events.length, 2);
  assert.equal(ledger.snapshot().find(row => row.id === "infra:run")?.actual, 50);
});

test("failed hosted requests retain uncertain cost after all workers close", async () => {
  const ledger = new BudgetLedger();
  const workers = attachInfraHostedWorkers([{ runId: "failed", worker: { async decision() {}, async close() {} } }],
    configuration, ledger, () => {}, (trial, allocation) => ({
      model: { async complete(request) { trial.reserve(request.id, allocation, 100); throw new Error("transport unknown"); } },
      embed: async () => [],
    }));
  await assert.rejects(workers[1].worker.decision(boundary, "u"), /transport unknown/);
  for (const worker of workers) await worker.worker.close();
  assert.equal(ledger.snapshot().find(row => row.id === "infra:failed")?.actual, undefined);
  assert.equal(ledger.snapshot().find(row => row.parentId === "infra:failed")?.maximum, 100);
});

test("concurrent closes drain late provider receipts before finishing the shared trial reservation", async () => {
  const ledger = new BudgetLedger(); let actorCloses = 0, releaseActor!: () => void, releaseProvider!: () => void;
  const workers = attachInfraHostedWorkers([{ runId: "drain", worker: { async decision() {}, async close() {
    actorCloses++; await new Promise<void>(resolve => { releaseActor = resolve; });
  } } }], configuration, ledger, () => {}, (trial, allocation) => ({ model: { async complete(request) {
    trial.reserve(request.id, allocation, 100);
    await new Promise<void>(resolve => { releaseProvider = resolve; });
    assert.equal(ledger.snapshot().find(row => row.id === "infra:drain")?.actual, undefined);
    trial.settle(request.id, 25);
    return { model: request.model, continuation: [], calls: [], text: "late native text", status: "completed", refusals: [], usage: undefined };
  } }, embed: async () => [] }));
  const decision = assert.rejects(workers[1].worker.decision(boundary, "pending"), /closed during inference/);
  const first = workers[0].worker.close(), second = workers[0].worker.close(); assert.equal(first, second);
  await workers[2].worker.close(); let userClosed = false;
  const closingUser = workers[1].worker.close().then(() => { userClosed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(actorCloses, 1); assert.equal(userClosed, false);
  releaseActor(); await first; assert.equal(ledger.snapshot().find(row => row.id === "infra:drain")?.actual, undefined);
  releaseProvider(); await Promise.all([decision, closingUser]);
  assert.equal(ledger.snapshot().find(row => row.id === "infra:drain")?.actual, 25);
});

test("service shutdown is single-flight and fences an in-flight decision response", async () => {
  const gateway = new NativeGateway("http://127.0.0.1:1", "x".repeat(32));
  let responds = 0, closes = 0, releaseDecision!: () => void, releaseClose!: () => void;
  gateway.request = async <T>(path: string) => {
    if (path === "/respond") responds++;
    return { runId: "run", boundaryId: "pending", public: boundary } as T;
  };
  const service = new ResearchService(gateway);
  service.register("run", { async decision() { await new Promise<void>(resolve => { releaseDecision = resolve; }); return { content: "late" }; },
    async close() { closes++; await new Promise<void>(resolve => { releaseClose = resolve; }); } });
  const pending = service.step(); await new Promise(resolve => setImmediate(resolve));
  const first = service.close(), second = service.close(); assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closes, 1);
  releaseDecision(); assert.equal(await pending, false); assert.equal(responds, 0);
  releaseClose(); await first; assert.equal(await service.step(), false);
  assert.throws(() => service.register("other", { async decision() {}, async close() {} }), /closing/);
});

test("native hosted limits cannot spend contingency or cross phase allocations", () => {
  assert.doesNotThrow(() => validateInfraHosted(configuration, "collection"));
  assert.throws(() => validateInfraHosted({ ...configuration, allocation: "contingency" }, "collection"), /allocation/);
  assert.throws(() => validateInfraHosted(configuration, "heldout"), /allocation/);
});

test("offline checkpoint binds original reservations and refuses replacement or stale journals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infra-ledger-checkpoint-"));
  try {
    const path = join(directory, "budget.jsonl"), output = join(directory, "checkpoint.json");
    await writeFile(path, "");
    await assert.rejects(writeInfraLedgerCheckpoint(path, output), /nonempty original/);
    const initial = new DurableBudget(path);
    initial.ledger.reserve("previous-unknown", "preparation", 10_000); initial.close();
    const receipt = await writeInfraLedgerCheckpoint(path, output);
    const checkpoint = JSON.parse(await readFile(output, "utf8"));
    assert.equal(receipt.checkpointHash, hash(checkpoint));
    const restored = new DurableBudget(path);
    try {
      assert.doesNotThrow(() => validateInfraLedgerCheckpoint(checkpoint, restored.ledger, resolve(path)));
      assert.equal(restored.ledger.snapshot()[0].actual, undefined);
      restored.ledger.reserve("new", "training", 1);
      assert.throws(() => validateInfraLedgerCheckpoint(checkpoint, restored.ledger, resolve(path)), /differs/);
    } finally { restored.close(); }
    await assert.rejects(writeInfraLedgerCheckpoint(path, output), /EEXIST/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
