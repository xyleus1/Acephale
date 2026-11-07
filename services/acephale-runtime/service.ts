import { NativeGateway } from "./gateway-client";
import type { PublicBoundary } from "./actor";

export interface BoundaryWorker {
  decision(publicBoundary: PublicBoundary, boundaryId: string): Promise<unknown>;
  close(): Promise<void>;
}

// Run registration is server-owned. Workers share the same process-wide read
// capacity and durable budget ledger; native workers retain orchestration.
export class ResearchService {
  private workers = new Map<string, BoundaryWorker>();
  private seen = new Set<string>();
  private closing?: Promise<void>;
  constructor(private gateway: NativeGateway) {}
  register(runId: string, worker: BoundaryWorker) {
    if (this.closing || this.workers.has(runId)) throw new Error("Run already owned or service closing");
    this.workers.set(runId, worker);
  }
  async step(signal?: AbortSignal) {
    if (this.closing) return false;
    const next = await this.gateway.request<{ runId: string; boundaryId: string; operation?: "close"; public?: PublicBoundary } | null>("/next", {}, signal);
    if (!next || this.closing) return false;
    const worker = this.workers.get(next.runId);
    const key = `${next.runId}:${next.boundaryId}`;
    if (!worker || this.seen.has(key)) throw new Error("Unknown run or repeated decision boundary");
    this.seen.add(key);
    let response;
    try {
      if (next.operation === "close") { await worker.close(); response = { closed: true }; }
      else {
        if (!next.public) throw new Error("Missing public decision boundary");
        response = await worker.decision(next.public, next.boundaryId);
      }
    }
    catch (error) {
      await worker.close();
      response = { _acephaleError: { type: error instanceof Error && /budget/i.test(error.message) ? "budget_exhausted" : "worker_failed" } };
    }
    if (this.closing) return false;
    await this.gateway.request("/respond", { runId: next.runId, boundaryId: next.boundaryId, response }, signal);
    return true;
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([...this.workers.values()].map(w => Promise.resolve().then(() => w.close())));
      this.workers.clear();
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
    return this.closing;
  }
}
