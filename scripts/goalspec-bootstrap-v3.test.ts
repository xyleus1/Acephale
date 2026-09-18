import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { buildResearch, type ResearchManifest } from "../services/goalspec-runtime/research-bootstrap";
import type { BootstrapContext } from "../services/goalspec-runtime/host";
import type { researchProvider } from "../services/goalspec-runtime/provider";
import type { NativeGateway } from "../services/goalspec-runtime/gateway-client";
import { BudgetLedger } from "../src/lib/goalspec/budget";
import { ResponsesModelPort } from "../src/lib/goalspec/model";
import { hash } from "../src/lib/goalspec/canonical";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function fixture(evaluator = true, fail = false) {
  const requests: ResponseCreateParamsNonStreaming[] = [], events: unknown[] = [], gatewayCalls: unknown[] = [];
  const ledger = new BudgetLedger();
  let providers = 0;
  const provider: typeof researchProvider = (trialLedger, _allocation, record) => {
    providers++;
    return { embed: async () => { throw new Error("No embedding in base fixture"); },
      model: new ResponsesModelPort(async params => {
        requests.push(params);
        if (fail) throw new Error("Fixture connection outcome unknown");
        return { model: params.model, status: "completed", output: [], output_text: '{"checks":[{"met":true}]}',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15,
            input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } as unknown as Response;
      }, trialLedger, () => 100, record),
    };
  };
  const context: BootstrapContext = { ledger, record: event => events.push(event),
    gateway: { request: async (route: string, payload: unknown) => { gatewayCalls.push({ route, payload }); return {}; } } as unknown as NativeGateway };
  const manifest: ResearchManifest = { schemaVersion: 1, snapshotId: "test-frozen", heldoutFamilies: [], runtimeVersion: "v3", awaitReady: true,
    runs: [{ runId: "test-run", arm: "base", domain: "retail", allocation: "development", maxCostMicrodollars: 2_500_000,
      maxBoundaries: 5, tools: [], evaluator }] };
  return { requests, events, gatewayCalls, ledger, provider, context, manifest, providerCount: () => providers };
}

test("native evaluator forwards original policy and content with pinned model, raw output and no schema", async () => {
  const f = fixture();
  const configured = await buildResearch(f.context, f.manifest, f.provider);
  const evaluator = configured.runs.find(run => run.runId === "test-run:evaluator")!.worker;
  const policy = "Original upstream evaluator policy: return its existing JSON format.";
  const messages = [{ role: "user" as const, content: "Original transcript and independent assertion." },
    { role: "assistant" as const, content: "Original prior evaluator content." }];
  const result = await evaluator.decision({ policy, messages, tools: [] }, "judge-1");
  assert.deepEqual(result, { role: "assistant", content: '{"checks":[{"met":true}]}', usage: {
    input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
  } });
  assert.equal(f.requests.length, 1);
  const sent = f.requests[0]!;
  assert.equal(sent.model, "gpt-5.4-2026-03-05");
  assert.equal(sent.max_output_tokens, 4096);
  assert.equal(sent.instructions, policy);
  assert.deepEqual(sent.input, messages);
  assert.equal(sent.text, undefined);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.store, false);
  await Promise.all(configured.runs.map(run => run.worker.close()));
  await configured.close();
});

test("trial reservation remains open until actor, user and evaluator all close exactly once", async () => {
  const f = fixture(); const configured = await buildResearch(f.context, f.manifest, f.provider);
  const worker = (id: string) => configured.runs.find(run => run.runId === id)!.worker;
  await worker("test-run").close();
  await worker("test-run:user").close();
  await worker("test-run").close();
  assert.equal(f.ledger.snapshot()[0]!.actual, undefined);
  await worker("test-run:evaluator").decision({ policy: "judge policy", messages: [{ role: "user", content: "judge input" }], tools: [] }, "judge-after-actor");
  assert.equal(f.ledger.snapshot()[0]!.actual, undefined);
  await worker("test-run:evaluator").close();
  assert.equal(f.ledger.snapshot()[0]!.actual, 100);
  await worker("test-run:evaluator").close();
  assert.equal(f.ledger.snapshot()[0]!.actual, 100);
  await configured.close();
});

test("legacy two-worker trials settle only after both managed workers close", async () => {
  const f = fixture(false); delete f.manifest.runtimeVersion;
  const configured = await buildResearch(f.context, f.manifest, f.provider);
  assert.deepEqual(configured.runs.map(run => run.runId), ["test-run", "test-run:user"]);
  await configured.runs[0]!.worker.close();
  assert.equal(f.ledger.snapshot()[0]!.actual, undefined);
  await configured.runs[1]!.worker.close();
  assert.equal(f.ledger.snapshot()[0]!.actual, 0);
  await configured.close();
});

test("unknown evaluator request retains its reservation after all workers close", async () => {
  const f = fixture(true, true); const configured = await buildResearch(f.context, f.manifest, f.provider);
  const evaluator = configured.runs.find(run => run.runId.endsWith(":evaluator"))!.worker;
  await assert.rejects(evaluator.decision({ policy: "policy", messages: [{ role: "user", content: "input" }], tools: [] }, "unknown-judge"), /outcome unknown/);
  await Promise.all(configured.runs.map(run => run.worker.close()));
  const snapshot = f.ledger.snapshot();
  assert.equal(snapshot.length, 2);
  assert.equal(snapshot[0]!.maximum, 2_500_000);
  assert.equal(snapshot[0]!.actual, undefined);
  assert.equal(snapshot[1]!.actual, undefined);
  assert.equal(f.requests.length, 1);
  assert.equal(f.events.filter(event => (event as { event?: { type: string } }).event?.type === "model_attempt_failed").length, 1);
  await configured.close();
});

test("invalid cohort manifest reserves nothing and constructs no provider", async () => {
  for (const invalid of ["duplicate", "invalid-final-run", "paper-without-v3"] as const) {
    const f = fixture();
    if (invalid === "duplicate") f.manifest.runs.push({ ...f.manifest.runs[0]! });
    if (invalid === "invalid-final-run") f.manifest.runs.push({ ...f.manifest.runs[0]!, runId: "invalid", maxBoundaries: 0 });
    if (invalid === "paper-without-v3") { delete f.manifest.runtimeVersion; f.manifest.runs[0]!.arm = "paste"; }
    await assert.rejects(buildResearch(f.context, f.manifest, f.provider));
    assert.equal(f.providerCount(), 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.ledger.snapshot().length, 0);
  }
});

test("readiness callback is explicit, hash-bound and waits until build completes", async () => {
  const f = fixture(); const configured = await buildResearch(f.context, f.manifest, f.provider);
  assert.equal(configured.runs.length, 3);
  assert.equal(f.providerCount(), 1);
  assert.deepEqual(f.gatewayCalls, []);
  await configured.ready?.();
  assert.deepEqual(f.gatewayCalls, [{ route: "/ready", payload: { manifestHash: hash(f.manifest) } }]);
  assert.equal(f.requests.length, 0);
  await Promise.all(configured.runs.map(run => run.worker.close()));
  await configured.close();
});

const controllerV4Path = resolve("research/goalspec/runs/local-controller-v4-trained-20260916-b/controller.json");
const controllerV5Path = resolve("research/goalspec/runs/local-controller-v5-trained-20260916/controller.json");
test("v5 bootstrap ranks source-bound policy-denied reads but cannot execute them", {
  skip: !existsSync(controllerV4Path) || !existsSync(controllerV5Path),
}, async () => {
  const f = fixture(false), estimate = { toolMs: 100000, validationMs: 0, schedulingMs: 0, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 };
  const tools = [{ type: "function" as const, function: { name: "get_order_details", parameters: {
    type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"], additionalProperties: false,
  } } }, { type: "function" as const, function: { name: "find_user_id_by_email", parameters: {
    type: "object", properties: { email: { type: "string" } }, required: ["email"], additionalProperties: false,
  } } }];
  f.manifest.runtimeVersion = "v5";
  f.manifest.runs[0]!.arm = "neutral"; f.manifest.runs[0]!.tools = tools;
  f.manifest.v4Configuration = { controllerPath: controllerV4Path, estimate };
  f.manifest.v5Configuration = { controllerPath: controllerV5Path, legacyConfigurationPath: "unused-by-direct-bootstrap-fixture",
    actorContext: "none", goalConditioning: false, exposeEvidence: false, estimate };
  const configured = await buildResearch(f.context, f.manifest, f.provider);
  try {
    await configured.runs.find(run => run.runId === "test-run")!.worker.decision({ policy: "Authenticate the user before order reads.", tools,
      messages: [{ role: "user", content: "Please read order_id=#ORD123." }] }, "pre-policy-read");
    const decision = f.events.map(event => (event as { event?: any }).event).find(event => event?.type === "controller_decision");
    assert.ok(decision, "The real bootstrap must run its local controller");
    assert.ok(decision.candidatePool.some((candidate: any) => candidate.invocation.tool === "get_order_details" && candidate.invocation.arguments.order_id === "#ORD123"));
    assert.ok(decision.deterministicEligibility.every((candidate: any) => candidate.eligible === false));
    assert.equal(f.gatewayCalls.length, 0, "High modeled utility cannot override missing authorization");
    assert.equal(f.requests.length, 1, "Only the mocked authoritative actor request is sent");
  } finally {
    for (const run of configured.runs) await run.worker.close();
    await configured.close();
  }
});
