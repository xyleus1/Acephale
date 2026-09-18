import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { hash, copy, canonical } from "../src/lib/goalspec/canonical";
import type { Candidate, Scope, Invocation } from "../src/lib/goalspec/contracts/generated";
import { SpeculationScheduler } from "../src/lib/goalspec/scheduler";
import { NativeGateway, NativeReadExecutor } from "../services/goalspec-runtime/gateway-client";
import { ResearchService } from "../services/goalspec-runtime/service";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import type { NativeMessage } from "../services/goalspec-runtime/actor";

type ReplayRun = { runId: string; scope: Scope; reads: string[]; turns: NativeMessage[] };
type PredictionEvent = { type: string; runId?: string; boundary: number; candidate: Candidate; reason?: string };
function recordedCandidates(paths: string[]) {
  const result = new Map<string, Map<number, Candidate[]>>();
  for (const path of paths) {
    let previous = "0".repeat(64), sequence = 0;
    const source = readFileSync(path, "utf8");
    if (!source.endsWith("\n")) throw new Error("Incomplete immutable source log");
    for (const line of source.split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.body.previousHash !== previous || row.body.sequence !== sequence++ || hash(row.body) !== row.hash) throw new Error("Source event hash chain changed");
      previous = row.hash;
      const wrapper = row.body.event;
      const event = (wrapper.event ?? wrapper) as PredictionEvent;
      const runId = wrapper.runId ?? event.runId;
      if (typeof runId !== "string" || event.type !== "candidate_prediction" || event.reason === "argument_or_scope_validation") continue;
      const boundaries = result.get(runId) ?? new Map<number, Candidate[]>();
      const candidates = boundaries.get(event.boundary) ?? [];
      candidates.push(copy(event.candidate)); boundaries.set(event.boundary, candidates); result.set(runId, boundaries);
    }
  }
  return result;
}

async function main() {
  const config = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8")) as { runs: ReplayRun[]; sourceLogs: string[] };
  const output = resolve(process.argv[3]);
  const predictions = recordedCandidates(config.sourceLogs);
  const gateway = new NativeGateway(process.env.GOALSPEC_GATEWAY_URL!, process.env.GOALSPEC_GATEWAY_TOKEN!);
  const service = new ResearchService(gateway);
  const events = new ImmutableEventLog(join(output, "scheduler-events.jsonl"));
  const counts: Record<string, number> = {};
  const durations: number[] = [];
  let calls = 0;
  for (const run of config.runs) {
    const reads = new NativeReadExecutor(gateway, run.runId, run.scope, new Set(run.reads));
    const scheduler = new SpeculationScheduler(run.runId, reads, event => { counts[event.type] = (counts[event.type] ?? 0) + 1; events.append(event); });
    let boundary = 0;
    service.register(run.runId, {
      async decision() {
        const index = boundary++;
        if (index >= run.turns.length) throw new Error("Recorded actor decisions exhausted");
        const start = performance.now();
        await scheduler.evidenceAtBoundary();
        // These predictions were frozen in the original live run before its actor
        // emitted this turn. Recorded actor arguments never form candidate input.
        const candidates = predictions.get(run.runId)?.get(index) ?? [];
        scheduler.admit(candidates);
        const response = copy(run.turns[index]);
        const invocations: Invocation[] = (response.tool_calls ?? []).map(call => ({ tool: call.name, arguments: JSON.parse(canonical(call.arguments)), scope: run.scope }));
        const promotions: Record<string, string> = {};
        if (invocations.some(invocation => !reads.eligible(invocation))) await scheduler.invalidate("recorded_mutating_or_mixed_batch");
        else for (const [position, invocation] of invocations.entries()) {
          const observation = await scheduler.authoritative(invocation, async () => null);
          if (observation !== null) {
            const lease = reads.takeLease(invocation);
            if (lease) promotions[response.tool_calls![position].id] = lease;
          }
        }
        calls++; durations.push(performance.now() - start);
        return { ...response, _goalspecPromotions: promotions };
      },
      close: () => scheduler.close(),
    });
  }
  try {
    while (!(await gateway.request<{ closed: boolean }>("/status", {})).closed) await service.step();
  } finally { await service.close(); events.close(); }
  durations.sort((a, b) => a - b);
  writeFileSync(join(output, "scheduler-summary.json"), JSON.stringify({ label: "Native execution replay of frozen live predictions; not live latency or task-success improvement",
    runs: config.runs.length, boundaries: calls, sourcePredictionRuns: predictions.size, counts,
    replayBoundaryLatencyMs: { sampleCount: durations.length, median: durations[Math.floor(durations.length / 2)] ?? null,
      p95: durations[Math.ceil(durations.length * .95) - 1] ?? null, max: durations.at(-1) ?? null }, providerCalls: 0, billedUsd: 0 }, null, 2) + "\n", { flag: "wx" });
}

main().catch(error => { process.stderr.write(`Native replay failed: ${error instanceof Error ? error.name : "Error"}\n`); process.exitCode = 1; });
