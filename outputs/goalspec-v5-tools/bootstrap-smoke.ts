import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { buildResearch, type ResearchManifest, type ResearchProviderFactory } from "../../services/goalspec-runtime/research-bootstrap";
import type { BootstrapContext } from "../../services/goalspec-runtime/host";
import type { NativeGateway } from "../../services/goalspec-runtime/gateway-client";
import type { PublicBoundary, NativeMessage } from "../../services/goalspec-runtime/actor";
import { ResponsesModelPort, RESEARCH_MODELS } from "../../src/lib/goalspec/model";
import { BudgetLedger } from "../../src/lib/goalspec/budget";
import { canonical, hash } from "../../src/lib/goalspec/canonical";

const root = resolve(__dirname, "../..");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const arms = ["base", "literal", "hypotheses", "v4"] as const;
const orderIds = Array.from({ length: 140 }, (_, i) => `#SMOKE${String(i).padStart(3, "0")}`);
const targetOrder = orderIds[0]!;
const userId = "elena_smoke";
const email = "elena@example.test";
const policy = "Authenticate the user before viewing orders. Only inspect the authenticated user's orders. Do not change an order without explicit user confirmation.";
const tools: PublicBoundary["tools"] = [["find_user_id_by_email", "email"], ["get_user_details", "user_id"], ["get_order_details", "order_id"]]
  .map(([name, field]) => ({ type: "function", function: { name: name!, description: `Native audited ${name}`,
    parameters: { type: "object", properties: { [field!]: { type: "string" } }, required: [field!], additionalProperties: false } } }));
function publicBoundary(): PublicBoundary {
  return { policy, tools, messages: [
    { role: "user", content: `My email is ${email}. Please inspect order_id ${targetOrder} and tell me its status. Do not change or cancel it. The unrelated order_id #FOREIGN999 is not mine.` },
    { role: "assistant", content: null, tool_calls: [{ id: "real-identity-call", name: "find_user_id_by_email", arguments: { email } }] },
    { role: "tool", id: "real-identity-call", content: JSON.stringify(userId) },
    { role: "assistant", content: null, tool_calls: [{ id: "real-profile-call", name: "get_user_details", arguments: { user_id: userId } }] },
    { role: "tool", id: "real-profile-call", content: JSON.stringify({ user_id: userId, orders: orderIds }) },
  ] };
}
type Event = { runId?: string; event?: Record<string, any>; [key: string]: unknown };
type Captured = { runId: string; params: ResponseCreateParamsNonStreaming };
export async function runBootstrapSmoke() {
  // This helper never imports dotenv or permits a configured database connection.
  if (process.env.GOALSPEC_DATABASE_URL) throw new Error("Offline smoke requires GOALSPEC_DATABASE_URL absent");
  const sourcePaths = ["outputs/goalspec-v5-tools/bootstrap-smoke.ts", "services/goalspec-runtime/research-bootstrap.ts",
    "services/goalspec-runtime/worker.ts", "services/goalspec-runtime/actor.ts", "services/goalspec-runtime/native-candidate-graph.ts",
    "services/goalspec-runtime/native-read-policy.ts", "services/goalspec-runtime/gateway-client.ts", "src/lib/goalspec/session-v5.ts",
    "src/lib/goalspec/session-v4.ts", "src/lib/goalspec/controller-v5.ts", "src/lib/goalspec/controller-v5-features.ts",
    "src/lib/goalspec/goal-state-protocol-v4c.ts", "src/lib/goalspec/model.ts", "src/lib/goalspec/obligation-ledger.ts"];
  const frozenManifestPath = resolve(root, "research/goalspec/runs/local-official-v4-confirmation-20260916/service-manifest.json");
  // Only immutable repository/controller configuration is reused; no task or outcome fields are read.
  const prior = JSON.parse(readFileSync(frozenManifestPath, "utf8")) as ResearchManifest;
  const v4Path = resolve(root, "research/goalspec/runs/local-controller-v4-trained-20260916-b/controller.json");
  const v5Path = resolve(root, "research/goalspec/runs/local-controller-v5-trained-20260916/controller.json");
  const paths = [...sourcePaths.map(path => resolve(root, path)), frozenManifestPath, v4Path, v5Path,
    resolve(root, prior.recordsPath!), resolve(root, prior.memoryPath!)];
  const sources = paths.map(path => ({ path: relative(root, path).replaceAll("\\", "/"), sha256: sha(path) }));
  const estimate = { toolMs: 0, validationMs: 1, schedulingMs: 0, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 };
  const manifest: ResearchManifest = { schemaVersion: 1, runtimeVersion: "v5", snapshotId: prior.snapshotId,
    recordsPath: prior.recordsPath, memoryPath: prior.memoryPath, heldoutFamilies: ["offline-smoke-structural-fixture"], awaitReady: true,
    v4Configuration: { controllerPath: v4Path, estimate },
    v5Configuration: { controllerPath: v5Path, legacyConfigurationPath: frozenManifestPath, estimate,
      actorContext: "none", goalConditioning: false, exposeEvidence: false },
    runs: arms.map(arm => ({ runId: `offline-${arm}`, familyId: "offline-smoke-structural-fixture", arm,
      domain: "retail", allocation: "development", maxCostMicrodollars: 1_250_000, maxBoundaries: 4, tools, evaluator: true })) };
  const events: Event[] = [], requests: Captured[] = [], gatewayCalls: { route: string; payload: unknown }[] = [];
  const ledger = new BudgetLedger();
  let providerCount = 0;
  const provider: ResearchProviderFactory = (trialLedger, _allocation, record) => {
    const runId = manifest.runs[providerCount++]!.runId;
    let actorCalls = 0;
    return { embed: async () => { throw new Error("Unexpected embedding in offline composition smoke"); },
      model: new ResponsesModelPort(async params => {
        assert.equal(ledger.snapshot().filter(item => !item.parentId).length, 4, "reserve every cohort slot before dispatch");
        requests.push({ runId, params });
        let text = "", output: unknown[] = [];
        if (params.tools) {
          actorCalls++;
          assert.equal(params.model, RESEARCH_MODELS.actor);
          assert.equal(params.max_output_tokens, 4096);
          assert.deepEqual(params.reasoning, { effort: "medium" });
          if (actorCalls === 1) output = [
            { type: "reasoning", id: `opaque-${runId}`, summary: [], encrypted_content: `fixture-opaque-${runId}` },
            { type: "function_call", id: `provider-item-${runId}`, call_id: `real-order-call-${runId}`,
              name: "get_order_details", arguments: JSON.stringify({ order_id: targetOrder }), status: "completed" },
          ];
          else text = "The order is pending. I have made no changes.";
        } else if (params.text?.format?.type === "json_schema") {
          assert.equal(params.model, RESEARCH_MODELS.goal);
          assert.equal(params.max_output_tokens, 1024);
          assert.equal(params.text.format.name, "goal_state_spans_v4_2");
          const payload = JSON.parse((params.input as { content: string }[])[0]!.content);
          const spanIds = payload.userSourcesInChronologicalOrder.flatMap((source: { spans: { id: string }[] }) => source.spans.map(span => span.id));
          text = JSON.stringify({ set_active_goals: [{ objective: `Inspect ${targetOrder} status without changing or cancelling it.`,
            weight: 1, spanIds, constraints: [] }], unknownWeight: 0, factDeltas: [] });
        } else if (params.model === RESEARCH_MODELS.user) {
          assert.equal(params.max_output_tokens, 1024); text = "###STOP###";
        } else {
          assert.equal(params.model, RESEARCH_MODELS.teacher); assert.equal(params.max_output_tokens, 4096);
          text = '{"checks":[{"met":true}]}';
        }
        return { model: params.model, status: "completed", output, output_text: text,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15,
            input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } as Response;
      }, trialLedger, () => 0, record) };
  };
  const context: BootstrapContext = { ledger, record: event => events.push(event as Event), gateway: {
    request: async (route: string, payload: unknown) => {
      assert.equal(route, "/ready", "nonpositive utility must not dispatch speculative reads");
      gatewayCalls.push({ route, payload }); return {};
    },
  } as unknown as NativeGateway };
  const configured = await buildResearch(context, manifest, provider);
  const results: Record<string, unknown>[] = [];
  try {
    await configured.ready?.();
    assert.deepEqual(gatewayCalls, [{ route: "/ready", payload: { manifestHash: hash(manifest) } }]);
    for (const arm of arms) {
      const runId = `offline-${arm}`, worker = configured.runs.find(run => run.runId === runId)!.worker;
      const boundary = publicBoundary();
      const response = await worker.decision(boundary, "public-0") as NativeMessage;
      assert.deepEqual(response.tool_calls?.map(call => ({ id: call.id, name: call.name, arguments: call.arguments })),
        [{ id: `real-order-call-${runId}`, name: "get_order_details", arguments: { order_id: targetOrder } }]);
      await new Promise<void>(done => setImmediate(done));
      const second = await worker.decision({ ...boundary, messages: [...boundary.messages, response,
        { role: "tool", id: `real-order-call-${runId}`, content: JSON.stringify({ order_id: targetOrder, user_id: userId, items: [], status: "pending" }) }] }, "public-1") as any;
      const actorRequests = requests.filter(row => row.runId === runId && row.params.tools);
      assert.equal(actorRequests.length, 2);
      const secondInput = actorRequests[1]!.params.input as Record<string, any>[];
      assert(secondInput.some(item => item.type === "reasoning" && item.encrypted_content === `fixture-opaque-${runId}`), "opaque continuation preserved");
      assert(secondInput.some(item => item.type === "function_call" && item.call_id === `real-order-call-${runId}`), "real provider call ID preserved");
      assert(secondInput.some(item => item.type === "function_call_output" && item.call_id === `real-order-call-${runId}`), "matching authoritative observation preserved");
      for (const item of secondInput.filter(item => item.type === "function_call_output"))
        assert(["real-identity-call", "real-profile-call", `real-order-call-${runId}`].includes(item.call_id), "no fabricated tool result");
      const decisions = events.filter(event => event.runId === runId && event.event?.type === "controller_decision").map(event => event.event!);
      if (arm === "base") assert.equal(decisions.length, 0);
      else {
        assert(decisions.length >= 2, `${arm} missing controller decisions`);
        const first = decisions[0]!, pool = first.candidatePool as any[];
        assert.equal(pool.length, arm === "v4" ? 32 : 128, `${arm} realistic owned order graph must reach configured pool cap`);
        assert(pool.some(candidate => candidate.invocation.tool === "get_order_details" && candidate.invocation.arguments.order_id === targetOrder));
        assert(pool.every(candidate => candidate.invocation.tool === "get_order_details" && orderIds.includes(candidate.invocation.arguments.order_id)), "every pool argument must be currently owned");
        assert(!canonical(pool).includes("#FOREIGN999"), "current mention does not establish ownership");
        if (arm !== "v4") assert.equal(first.runtimeVersion, "goalspec-v5");
      }
      const expectedMode = arm === "literal" || arm === "hypotheses" ? "current-only" : "legacy";
      const compiler = second.raw_data.goalspecCompiler;
      assert.equal(compiler.actorContextMode ?? "legacy", expectedMode);
      const contexts = secondInput.filter(item => item.role === "developer");
      if (expectedMode === "current-only") {
        assert.equal(contexts.length, 1); assert.equal(compiler.omittedHistoricalDerivedContexts, 1);
      } else if (arm === "v4") assert.equal(contexts.length, 2);
      const userWorker = configured.runs.find(run => run.runId === `${runId}:user`)!.worker;
      const stopped = await userWorker.decision({ policy: "Unmodified native user simulator protocol", tools: [],
        messages: [{ role: "user", content: "The task is complete." }] }, `${runId}-user`) as any;
      assert.equal(stopped.content, "###STOP###", "native user STOP remains untouched");
      const judgeWorker = configured.runs.find(run => run.runId === `${runId}:evaluator`)!.worker;
      await judgeWorker.decision({ policy: "Unmodified native independent evaluator", tools: [],
        messages: [{ role: "user", content: "Evaluate a synthetic assertion." }] }, `${runId}-judge`);
      await worker.close(); await userWorker.close();
      assert.equal(ledger.snapshot().find(item => item.id === `trial:${runId}`)?.actual, undefined);
      await judgeWorker.close();
      assert.equal(ledger.snapshot().find(item => item.id === `trial:${runId}`)?.actual, 0);
      const failed = events.filter(event => event.runId === runId && event.event?.type === "prediction_cycle_failed");
      assert.equal(failed.length, 0, `${arm} background goal update must succeed`);
      const goalRequests = requests.filter(row => row.runId === runId && row.params.text?.format?.type === "json_schema");
      assert.equal(goalRequests.length, ["hypotheses", "v4"].includes(arm) ? 1 : 0);
      results.push({ arm, actorContextMode: expectedMode, initialPoolSize: decisions[0]?.candidatePool.length ?? 0,
        controllerDecisions: decisions.length, actorRequests: actorRequests.length, goalRequests: goalRequests.length,
        inputTokens: compiler.tokens, models: [...new Set(requests.filter(row => row.runId === runId).map(row => row.params.model))],
        continuationPreserved: true, stopProtocolUnchanged: true, successfulClosure: true });
    }
  } finally { await Promise.all(configured.runs.map(run => run.worker.close())); await configured.close(); }
  assert(ledger.snapshot().every(row => row.actual === 0));
  sources.forEach(source => assert.equal(sha(resolve(root, source.path)), source.sha256, `Source changed during smoke: ${source.path}`));
  return { version: "goalspec-v5-bootstrap-composition-smoke-v1", passed: true, paidProviderCalls: 0, databaseConnections: 0,
    transport: "in-process mock Responses transport; actual ResponsesModelPort, NativeBoundaryWorker and buildResearch",
    scope: "Synthetic public prefix only; 140 currently owned orders; no private benchmark fixtures or task outcomes used",
    limitations: ["No live provider or network timing claim", "No success or intent guarantee", "Nonpositive utility deliberately prevents native speculative dispatch; separate native HTTP parity smoke covers execution"],
    manifestHash: hash(manifest), sources, results, mockedPhysicalAttempts: requests.length,
    requestHashes: requests.map(row => ({ runId: row.runId, sha256: hash(JSON.parse(JSON.stringify(row.params))) })),
    eventsHash: hash(JSON.parse(JSON.stringify(events))),
    ledger: ledger.snapshot() };
}

async function main() {
  const output = resolve(process.argv[2] ?? "research/goalspec/runs/local-v5-bootstrap-smoke-20260916/receipt.json");
  if (existsSync(output)) throw new Error("Receipt already exists; use a new immutable output path");
  const receipt = await runBootstrapSmoke();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ path: output, sha256: sha(output), passed: receipt.passed, results: receipt.results, paidProviderCalls: 0 }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
