import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { hash } from "../src/lib/goalspec/canonical";
import { SpeculationScheduler, type RuntimeEvent } from "../src/lib/goalspec/scheduler";
import type { Candidate, Invocation } from "../src/lib/goalspec/contracts/generated";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";

async function main() {
  const destination = resolve(process.argv[2] ?? "research/goalspec/runs/v1-execution-replay");
  mkdirSync(destination, { recursive: false });
  const events = new ImmutableEventLog(resolve(destination, "events.jsonl"));
  const counters: Record<string, number> = {};
  const durations: number[] = [];
  for (let i = 0; i < 24; i++) {
    const path = resolve(destination, `fixture-${i}.json`);
    writeFileSync(path, JSON.stringify({ value: i }));
    const read = async () => JSON.parse(readFileSync(path, "utf8"));
    const invocation: Invocation = { tool: "read_fixture", arguments: { fixture: i }, scope: { tenantId: "fixture", principalId: "fixture", authorizationVersion: "v1", environmentVersion: "local-file-v1", toolSchemaHash: "fixture" } };
    const candidate: Candidate = { schemaVersion: 1, id: hash(invocation), invocation, probability: 1, bindings: [], hop: 1, patternId: null };
    const scheduler = new SpeculationScheduler(`fixture-${i}`, { eligible: value => value.tool === "read_fixture", read, validate: read }, (event: RuntimeEvent) => {
      counters[event.type] = (counters[event.type] ?? 0) + 1; events.append(event);
    });
    const start = performance.now();
    scheduler.admit([candidate]);
    const result = await scheduler.authoritative(invocation, read);
    if (JSON.stringify(result) !== JSON.stringify({ value: i })) throw new Error("Replay observation mismatch");
    await scheduler.close(); durations.push(performance.now() - start);
  }
  events.close();
  durations.sort((a, b) => a - b);
  const report = { label: "Deterministic file-backed execution replay, not live native evaluation", cases: 24,
    counters, latencyMs: { sampleCount: durations.length, median: durations[Math.floor(durations.length / 2)], p95: durations[Math.ceil(durations.length * 0.95) - 1], max: durations.at(-1) },
    modelCalls: 0, providerBilledUsd: 0, avoidedDatabaseQueriesClaimed: 0, comparativeSpeedupClaimed: false };
  writeFileSync(resolve(destination, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
void main();
