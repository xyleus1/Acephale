import type { Invocation, ExecutionFrame } from "../../src/lib/goalspec/contracts/generated";
import type { Observation, ReadExecutor } from "../../src/lib/goalspec/scheduler";
import { hash } from "../../src/lib/goalspec/canonical";
import { randomUUID } from "node:crypto";

type Operation<T> = { state: "unknown" | "running" | "completed" | "cancelled" | "failed"; result?: T };

// Python keeps the original ToolMessage for authoritative promotion. Policy and
// actor evidence need its decoded value, not the transport envelope.
function decodeNativeObservation(value: Observation): Observation {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.content !== "string" || value.error !== false) {
    throw new Error("Invalid or unsuccessful native observation");
  }
  try { return JSON.parse(value.content) as Observation; }
  catch { return value.content; }
}

export class NativeGateway {
  constructor(private baseUrl: string, private token: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("Gateway requires TLS or loopback");
    if (token.length < 32) throw new Error("Gateway token too short");
  }
  async request<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), { method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: signal ?? AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Native gateway rejected request (${response.status})`);
    return response.json() as Promise<T>;
  }

  async read<T>(payload: { runId: string; tool: string; arguments: unknown }, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const operationId = randomUUID();
    const identity = { runId: payload.runId, operationId };
    let operation: Operation<T>;
    try {
      operation = await this.request<Operation<T>>("/read", { ...payload, operationId }, AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
      if (signal.aborted || operation.state === "running" || operation.state === "unknown") throw new Error("Read requires reconciliation");
    } catch (error) {
      // A transport abort is not physical completion. Keep the caller and its
      // scheduler slot pending until Python confirms a terminal operation state.
      // Unknown IDs are tombstoned, fencing a delayed original POST.
      for (;;) {
        try {
          const status = await this.request<Operation<T>>("/operation", { ...identity, cancel: true }, AbortSignal.timeout(5_000));
          if (["cancelled", "completed", "failed"].includes(status.state)) break;
        } catch { /* An unreachable gateway cannot confirm cancellation. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw error;
    }
    if (operation.state !== "completed" || operation.result === undefined) throw new Error(`Native read ${operation.state}`);
    return operation.result;
  }
}
export class NativeReadExecutor implements ReadExecutor {
  private leases = new Map<string, string>();
  constructor(private gateway: NativeGateway, private runId: string, private scope: Invocation["scope"], private tools: ReadonlySet<string>,
    private policy?: { updateFrame(frame: ExecutionFrame): void; eligible(i: Invocation): boolean; nonMutating?(i: Invocation): boolean;
      validateObservation(i: Invocation, observation: Observation): boolean; observeVerified(i: Invocation, observation: Observation): boolean }) {}
  updateFrame(frame: ExecutionFrame) { this.policy?.updateFrame(frame); }
  eligible(i: Invocation) { return hash(i.scope) === hash(this.scope) && this.tools.has(i.tool) && (!this.policy || this.policy.eligible(i)); }
  nonMutating(i: Invocation): boolean {
    if (hash(i.scope) !== hash(this.scope)) return false;
    if (!this.policy?.nonMutating) return this.eligible(i);
    return (this.tools.has(i.tool) || i.tool === "calculate") && this.policy.nonMutating(i);
  }
  async read(i: Invocation, signal: AbortSignal) {
    if (!this.eligible(i)) throw new Error("Native read denied");
    const result = await this.gateway.read<{ lease: string; observation: Observation }>({ runId: this.runId, tool: i.tool, arguments: i.arguments }, signal);
    signal.throwIfAborted();
    const observation = this.policy ? decodeNativeObservation(result.observation) : result.observation;
    if (!this.eligible(i) || this.policy && !this.policy.validateObservation(i, observation)) throw new Error("Native read ownership changed");
    this.leases.set(hash(i), result.lease);
    return observation;
  }
  async validate(i: Invocation, _previous: Observation, signal: AbortSignal) {
    const lease = this.leases.get(hash(i));
    this.leases.delete(hash(i));
    if (!lease || !this.eligible(i)) throw new Error("Missing native freshness lease");
    const result = await this.gateway.request<{ lease: string; observation: Observation }>("/refresh", { runId: this.runId, lease, tool: i.tool, arguments: i.arguments }, signal);
    signal.throwIfAborted();
    const observation = this.policy ? decodeNativeObservation(result.observation) : result.observation;
    if (!this.eligible(i) || this.policy && !this.policy.validateObservation(i, observation)) throw new Error("Native evidence ownership changed");
    if (this.policy && !this.policy.observeVerified(i, observation)) throw new Error("Native verified receipt rejected");
    this.leases.set(hash(i), result.lease);
    return observation;
  }
  takeLease(i: Invocation) {
    const key = hash(i);
    const lease = this.leases.get(key);
    this.leases.delete(key);
    return lease;
  }
}
