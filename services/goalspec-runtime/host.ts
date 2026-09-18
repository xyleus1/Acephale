import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { NativeGateway } from "./gateway-client";
import { DurableBudget } from "./durable-budget";
import { ImmutableEventLog } from "./artifacts";
import { ResearchService, type BoundaryWorker } from "./service";
import type { BudgetLedger } from "../../src/lib/goalspec/budget";

export interface BootstrapContext {
  gateway: NativeGateway; ledger: BudgetLedger; record(event: unknown): void;
}
export interface Bootstrap {
  build(context: BootstrapContext): Promise<{ runs: { runId: string; worker: BoundaryWorker }[]; maxDecisions: number; concurrency?: number; ready?: () => Promise<void>; close?: () => Promise<void> }>;
}

// Bootstrap is trusted local server code, never actor-supplied configuration.
export async function serve(bootstrap: Bootstrap, options: { gatewayUrl: string; token: string; artifactDirectory: string; signal: AbortSignal }) {
  const gateway = new NativeGateway(options.gatewayUrl, options.token);
  const directory = resolve(options.artifactDirectory);
  const budget = new DurableBudget(join(directory, "budget.jsonl"));
  const events = new ImmutableEventLog(join(directory, `events-${randomUUID()}.jsonl`));
  const service = new ResearchService(gateway);
  let decisions = 0;
  let closeBootstrap: (() => Promise<void>) | undefined;
  try {
    const configured = await bootstrap.build({ gateway, ledger: budget.ledger, record: event => events.append(event) });
    closeBootstrap = configured.close;
    if (!Number.isInteger(configured.maxDecisions) || configured.maxDecisions < 1 || !configured.runs.length) throw new Error("Invalid service limits");
    for (const run of configured.runs) service.register(run.runId, run.worker);
    const concurrency = configured.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("Invalid boundary concurrency");
    events.append({ type: "service_started", runs: configured.runs.map(run => run.runId), maxDecisions: configured.maxDecisions, concurrency });
    await configured.ready?.();
    let stopped = false, assigned = 0;
    const results = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      try {
        while (!stopped && !options.signal.aborted && assigned < configured.maxDecisions) {
          assigned++;
          if (await service.step(options.signal)) decisions++;
          else {
            assigned--;
            if ((await gateway.request<{ closed: boolean }>("/status", {}, options.signal)).closed) stopped = true;
          }
        }
      } catch (error) { stopped = true; throw error; }
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  } catch (error) {
    if (!options.signal.aborted) throw error;
  } finally {
    // Do not release spending ownership while native work is still draining.
    try { await service.close(); }
    finally {
      try { await closeBootstrap?.(); }
      finally {
        try { events.append({ type: "service_closed", decisions, aborted: options.signal.aborted }); }
        finally { events.close(); budget.close(); }
      }
    }
  }
  return decisions;
}
