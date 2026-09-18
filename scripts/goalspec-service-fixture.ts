import type { BootstrapContext } from "../services/goalspec-runtime/host";
import { NativeBoundaryWorker } from "../services/goalspec-runtime/worker";
import { NativeReadExecutor } from "../services/goalspec-runtime/gateway-client";
import { hash } from "../src/lib/goalspec/canonical";
import { ResponsesModelPort } from "../src/lib/goalspec/model";
import { FrozenRepository } from "../src/lib/goalspec/repository";
import { GoalSpecSession } from "../src/lib/goalspec/session";
import { SpeculationScheduler } from "../src/lib/goalspec/scheduler";

// Deterministic integration fixture only. This is never a research model arm.
export async function build({ gateway, ledger, record }: BootstrapContext) {
  const tool = process.env.GOALSPEC_FIXTURE_TOOL!;
  if (!["list_all_product_types", "list_all_airports"].includes(tool)) throw new Error("Unknown fixture tool");
  const scope = { tenantId: "fixture", principalId: "fixture", authorizationVersion: "fixture-v1",
    environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(JSON.parse(process.env.GOALSPEC_FIXTURE_TOOLS!)) };
  const reads = new NativeReadExecutor(gateway, "parity", scope, new Set([tool]));
  const scheduler = new SpeculationScheduler("parity", reads, record);
  const runtime = new GoalSpecSession(new FrozenRepository("fixture", []), {
    async inferGoals(frame) {
      const sourceId = Object.keys(frame.sources).find(key => key.startsWith("requirement:"));
      return { schemaVersion: 1, hypotheses: sourceId ? [{ id: "visible", objective: frame.requestedObjective, probability: 1, sources: [{ sourceId, path: [] }], constraints: [] }] : [], unknown: sourceId ? 0 : 1, revisionHash: hash({}) };
    },
    async embed() { return Array(1536).fill(0); },
    bindPatterns(frame) { return frame.boundary === 0 ? [{ schemaVersion: 1, id: "fixture-candidate", invocation: { tool, arguments: {}, scope }, probability: 1, bindings: [], hop: 1, patternId: null }] : []; },
    async candidates() { return []; }, calibrated() { return true; }, validateArguments() { return true; },
  }, scheduler);
  let turn = 0;
  const model = new ResponsesModelPort(async params => {
    // Deterministic model latency allows the concurrent predictor to finish;
    // production actor boundaries do not wait on prediction.
    await runtime.settlePredictions();
    const first = turn++ === 0;
    return { model: params.model, status: "completed", incomplete_details: null,
      output_text: first ? "" : "Here are the options.",
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      output: first ? [{ type: "function_call", id: "provider-item", call_id: "native-real-call", name: tool, arguments: "{}" }]
        : [{ type: "message", id: "final", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Here are the options.", annotations: [] }] }],
    } as never;
  }, ledger, () => 0, record);
  record({ type: "fixture_only", providerCalls: 0 });
  return { maxDecisions: 3, runs: [{ runId: "parity", worker: new NativeBoundaryWorker({ runId: "parity", scope,
    snapshotId: "fixture", allocation: "development", maximumAttemptMicrodollars: 1, maxBoundaries: 2 }, model, record, runtime, reads) }] };
}
