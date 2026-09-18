import test from "node:test";
import assert from "node:assert/strict";
import { researchModelWithTransportPolicy, buildResearch, type ResearchManifest, type ResearchProviderFactory } from "../services/goalspec-runtime/research-bootstrap";
import type { BootstrapContext } from "../services/goalspec-runtime/host";
import type { NativeGateway } from "../services/goalspec-runtime/gateway-client";
import { RESEARCH_MODELS, type ModelPort, type ModelRequest, type ModelResult } from "../src/lib/goalspec/model";
import { BudgetLedger } from "../src/lib/goalspec/budget";
import { copy } from "../src/lib/goalspec/canonical";

const result = (model: string): ModelResult => ({ model, text: "done", continuation: [], calls: [], status: "completed", refusals: [],
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });

test("v3 wrapper changes only retry policy for all five Responses roles and leaves legacy port unchanged", async () => {
  const captured: ModelRequest[] = [];
  const model: ModelPort = { async complete(request) { captured.push(request); return result(request.model); } };
  assert.equal(researchModelWithTransportPolicy(model, false), model);
  const wrapped = researchModelWithTransportPolicy(model, true);
  for (const role of ["actor", "user", "teacher", "goal", "candidate"] as const) {
    const request: ModelRequest = { id: role, model: RESEARCH_MODELS[role], instructions: "unchanged", input: [{ role: "user", content: "unchanged" }],
      maxOutputTokens: role === "actor" || role === "teacher" ? 4096 : 1024, allocation: "development", maximumAttemptMicrodollars: 7,
      retries: 0, ...(role === "actor" ? { reasoning: "medium" as const } : {}) };
    const before = copy(request);
    await wrapped.complete(request);
    assert.deepEqual(captured.at(-1), { ...request, retries: 1, retryableCauseCodes: ["UND_ERR_SOCKET"] });
    assert.deepEqual(request, before);
  }
});

test("bootstrap wires actor, user and evaluator through the same recorded v3 retry policy", async () => {
  for (const v3 of [false, true]) {
    const captured: ModelRequest[] = [], records: unknown[] = [];
    const factory: ResearchProviderFactory = () => ({ embed: async () => { throw new Error("Unexpected embedding"); },
      model: { async complete(request) { captured.push(request); return result(request.model); } } });
    const context: BootstrapContext = { ledger: new BudgetLedger(), record: record => records.push(record),
      gateway: {} as NativeGateway };
    const manifest: ResearchManifest = { schemaVersion: 1, snapshotId: "frozen", heldoutFamilies: [], ...(v3 ? { runtimeVersion: "v3" as const } : {}),
      runs: [{ runId: "transport-test", arm: "base", domain: "airline", allocation: "development", maxCostMicrodollars: 2_500_000,
        maxBoundaries: 2, tools: [], evaluator: true }] };
    const configured = await buildResearch(context, manifest, factory);
    try {
      for (const run of configured.runs) await run.worker.decision({ policy: "original policy", messages: [{ role: "user", content: "original text" }], tools: [] }, "one");
      assert.equal(captured.length, 3);
      assert.deepEqual(captured.map(request => request.model), [RESEARCH_MODELS.actor, RESEARCH_MODELS.user, RESEARCH_MODELS.teacher]);
      for (const request of captured) {
        assert.equal(request.retries, v3 ? 1 : 0);
        assert.deepEqual(request.retryableCauseCodes, v3 ? ["UND_ERR_SOCKET"] : undefined);
      }
      const saved = records.find(value => (value as { type?: string }).type === "research_manifest") as { transportPolicy: unknown };
      assert.deepEqual(saved.transportPolicy, v3 ? { maximumAttempts: 2, retryableCauseCodes: ["UND_ERR_SOCKET"], sdkRetries: 0, unknownReservationRetained: true } : null);
    } finally {
      for (const run of configured.runs) await run.worker.close();
      await configured.close();
    }
  }
});
