import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Response } from "openai/resources/responses/responses";
import { buildResearch, researchScope, type ResearchManifest, type ResearchProviderFactory } from "../../services/goalspec-runtime/research-bootstrap";
import type { BootstrapContext } from "../../services/goalspec-runtime/host";
import type { NativeGateway } from "../../services/goalspec-runtime/gateway-client";
import type { PublicBoundary, NativeMessage } from "../../services/goalspec-runtime/actor";
import { ResponsesModelPort, RESEARCH_MODELS } from "../../src/lib/goalspec/model";
import { BudgetLedger } from "../../src/lib/goalspec/budget";
import { hash } from "../../src/lib/goalspec/canonical";
import { validateControllerV5Artifact, v5ExpectedSaving } from "../../src/lib/goalspec/controller-v5";
import { validateMemoryArtifact } from "../../src/lib/goalspec/experience-memory";

const root = resolve(__dirname, "../..");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const arms = ["literal", "hypotheses"] as const;
const configPath = "research/goalspec/v5-development.configuration.json";
const trainingPath = "research/goalspec/runs/local-v5-training-20260916/service-manifest.json";
const recordsPath = "research/goalspec/runs/local-v5-library-20260916/records.json";
const memoryPath = "research/goalspec/runs/local-v5-model-pipeline-20260916/memory-b/artifact.json";

async function main() {
  if (process.env.GOALSPEC_DATABASE_URL) throw new Error("Offline smoke requires no configured database connection");
  const output = resolve(process.argv[2] ?? "research/goalspec/runs/local-v5-fitted-composition-smoke-20260916/receipt.json");
  if (existsSync(output)) throw new Error("Immutable receipt exists");
  const config = json(configPath), training = json(trainingPath) as ResearchManifest;
  const artifact = validateControllerV5Artifact(json(config.controllerPath));
  const memory = validateMemoryArtifact(json(memoryPath));
  const native = training.runs.find(run => run.domain === "retail")!;
  const tools = native.tools;
  const scope = researchScope(native);
  const family = "offline-fitted-composition-synthetic";
  const compatible = memory.runs.filter(run => hash(run.scope) === hash(scope)
    && artifact.lineage.trainingFamilies.includes(run.familyId) && run.familyId !== family);
  assert(compatible.length > 0, "Actual native tool schema has compatible fitting memory");
  const sourcePaths = ["outputs/goalspec-v5-tools/fitted-composition-smoke.ts", configPath, trainingPath, recordsPath, memoryPath,
    config.controllerPath, config.legacyConfigurationPath, "services/goalspec-runtime/research-bootstrap.ts",
    "src/lib/goalspec/session-v5.ts", "src/lib/goalspec/controller-v5.ts", "src/lib/goalspec/experience-memory.ts"];
  const sources = sourcePaths.map(path => ({ path, sha256: sha(resolve(root, path)) }));
  const bestSaving = v5ExpectedSaving(1, config.estimate);
  assert(bestSaving < 0, "Measured estimate must reject even certain next-read reuse");
  const ledger = new BudgetLedger(), events: any[] = [], requests: any[] = [];
  const manifest: ResearchManifest = { schemaVersion: 1, runtimeVersion: "v5", snapshotId: memory.repositorySnapshotId,
    recordsPath: resolve(root, recordsPath), memoryPath: resolve(root, memoryPath), heldoutFamilies: [family],
    awaitReady: true, v4Configuration: json(config.legacyConfigurationPath), v5Configuration: config,
    runs: arms.map(arm => ({ runId: `fitted-smoke-${arm}`, familyId: family, arm, domain: "retail",
      allocation: "development", maxCostMicrodollars: 1_250_000, maxBoundaries: 4, tools, evaluator: true })) };
  const email = "composition@example.test", userId = "composition_fixture", orderId = "#SMOKE100";
  const request = `My email is ${email}. Please inspect order_id ${orderId}, tell me its status and shipping address. Do not change or cancel it.`;
  const boundary: PublicBoundary = { policy: "Authenticate the user before viewing their orders. Do not modify or cancel any order without explicit confirmation.", tools,
    messages: [{ role: "user", content: request },
      { role: "assistant", content: null, tool_calls: [{ id: "identity", name: "find_user_id_by_email", arguments: { email } }] },
      { role: "tool", id: "identity", content: JSON.stringify(userId) },
      { role: "assistant", content: null, tool_calls: [{ id: "profile", name: "get_user_details", arguments: { user_id: userId } }] },
      { role: "tool", id: "profile", content: JSON.stringify({ user_id: userId, orders: [orderId, "#SMOKE101"] }) }] };
  let providerCount = 0;
  const provider: ResearchProviderFactory = (trialLedger, _allocation, record) => {
    const runId = manifest.runs[providerCount++]!.runId;
    let actorCalls = 0;
    return { embed: async () => { throw new Error("Unexpected embedding transport"); },
      model: new ResponsesModelPort(async params => {
        requests.push({ runId, params });
        let text = "", output: unknown[] = [];
        if (params.tools) {
          assert.equal(params.model, RESEARCH_MODELS.actor);
          assert.equal(params.max_output_tokens, 4096);
          assert.deepEqual(params.reasoning, { effort: "medium" });
          if (++actorCalls === 1) output = [{ type: "function_call", id: `item-${runId}`, call_id: `order-${runId}`,
            name: "get_order_details", arguments: JSON.stringify({ order_id: orderId }), status: "completed" }];
          else text = "The order is pending. No changes were made.";
        } else {
          assert.equal(params.model, RESEARCH_MODELS.goal);
          assert.equal(params.max_output_tokens, 1024);
          const payload = JSON.parse((params.input as { content: string }[])[0]!.content);
          const spanIds = payload.userSourcesInChronologicalOrder.flatMap((source: any) => source.spans.map((span: any) => span.id));
          text = JSON.stringify({ set_active_goals: [{ objective: `Inspect ${orderId} status and shipping address without modifying or cancelling it.`,
            weight: 1, spanIds, constraints: [] }], unknownWeight: 0, factDeltas: [] });
        }
        return { model: params.model, status: "completed", output, output_text: text,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 } } } as Response;
      }, trialLedger, () => 0, record) };
  };
  const gatewayCalls: string[] = [];
  const context: BootstrapContext = { ledger, record: event => events.push(event), gateway: {
    request: async (route: string) => { gatewayCalls.push(route); assert.equal(route, "/ready"); return {}; },
  } as unknown as NativeGateway };
  const configured = await buildResearch(context, manifest, provider), results: any[] = [];
  try {
    await configured.ready?.();
    for (const arm of arms) {
      const runId = `fitted-smoke-${arm}`, worker = configured.runs.find(run => run.runId === runId)!.worker;
      const first = await worker.decision(boundary, "public-0") as NativeMessage;
      assert.equal(first.tool_calls?.[0]?.id, `order-${runId}`);
      await new Promise<void>(done => setImmediate(done));
      const second = await worker.decision({ ...boundary, messages: [...boundary.messages, first,
        { role: "tool", id: `order-${runId}`, content: JSON.stringify({ order_id: orderId, user_id: userId, status: "pending", items: [] }) }] }, "public-1") as any;
      await new Promise<void>(done => setImmediate(done));
      const captured = requests.filter(row => row.runId === runId && row.params.tools);
      const developer = captured[1].params.input.filter((item: any) => item.role === "developer");
      assert.equal(developer.length, 1);
      const contextText = JSON.stringify(developer[0]);
      assert(contextText.includes("latestUserStatement"), "Literal obligation projection is exposed");
      assert.equal(contextText.includes("experimentalHypotheses"), arm === "hypotheses");
      assert.equal(second.raw_data.goalspecCompiler.actorContextMode, "current-only");
      const runEvents = events.filter(event => event.runId === runId).map(event => event.event);
      assert(!runEvents.some(event => event?.type === "prediction_cycle_failed"));
      const decisions = runEvents.filter(event => event?.type === "controller_decision");
      assert(decisions.length >= 2);
      assert(decisions.some(event => event.candidatePool.length > 0));
      const retrieved = decisions.flatMap(event => event.memory?.episodes ?? []);
      assert(retrieved.length > 0, "Actual compatible fitting episodes retrieved at live session boundary");
      assert(retrieved.every(item => artifact.lineage.trainingFamilies.includes(item.run.familyId)
        && item.run.familyId !== family && hash(item.run.scope) === hash(scope)));
      const predictions = runEvents.filter(event => event?.type === "candidate_prediction");
      assert(predictions.length > 0);
      assert(predictions.every(event => event.admission === false && event.expectedSavingMs <= bestSaving));
      const goalCalls = requests.filter(row => row.runId === runId && !row.params.tools).length;
      assert.equal(goalCalls, arm === "hypotheses" ? 1 : 0);
      const reliabilities = decisions.map(event => event.decision.goalReliability);
      if (arm === "hypotheses") assert(reliabilities.some(value => value === artifact.calibration.reliability.bins[0]!.probability));
      else assert(reliabilities.every(value => value === 0));
      results.push({ arm, actorContextMode: "current-only", literalContext: true, hypothesisContext: arm === "hypotheses",
        controllerDecisions: decisions.length, poolSizes: decisions.map(event => event.candidatePool.length),
        goalReliabilities: reliabilities, goalCalls, memoryEpisodeIds: [...new Set(retrieved.map(item => item.episode.id))],
        retrievedFamilies: [...new Set(retrieved.map(item => item.run.familyId))], retrievedMemoryHash: decisions[0].memory.artifactHash,
        candidatePredictions: predictions.length, admittedReads: 0, actualSpeculativeGatewayCalls: 0 });
    }
  } finally { await Promise.all(configured.runs.map(run => run.worker.close())); await configured.close(); }
  assert.deepEqual(gatewayCalls, ["/ready"]);
  assert(ledger.snapshot().every(row => row.actual === 0));
  for (const source of sources) assert.equal(sha(resolve(root, source.path)), source.sha256);
  const receipt = { version: "goalspec-v5-fitted-composition-smoke-v1", passed: true,
    paidProviderCalls: 0, databaseConnections: 0, transport: "Mock Responses transport; actual bootstrap, session, controller, scheduler and contextual memory",
    publicPrefix: "Synthetic user and native tool observations; real complete retail tool catalog from permitted training manifest",
    scope, currentFamily: family, compatibleFittingRuns: compatible.length, snapshotId: memory.repositorySnapshotId,
    controllerHash: artifact.contentHash, memoryHash: memory.contentHash, configHash: hash(config), manifestHash: hash(manifest),
    maximumExpectedSavingMs: bestSaving, estimate: config.estimate, results, sources,
    limitations: ["No live latency or task success claim", "Goal hypotheses are mocked and fallible; reliability calibration has 19 examples",
      "Current measured estimates reject all speculative reads even at probability one"],
    mockedRequests: requests.length, eventsHash: hash(JSON.parse(JSON.stringify(events))), ledger: ledger.snapshot() };
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ path: relative(root, output), sha256: sha(output), passed: true, results, paidProviderCalls: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
