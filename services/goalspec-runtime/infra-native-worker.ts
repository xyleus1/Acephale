import { canonical, copy, hash } from "../../src/lib/goalspec/canonical";
import type { ExecutionFrame, Scope } from "../../src/lib/goalspec/contracts/generated";
import { validateContract } from "../../src/lib/goalspec/contracts/validate";
import { LocalChatModelPort } from "../../src/lib/goalspec/infra-model";
import type { InfraSession } from "../../src/lib/goalspec/infra-session";
import type { BindingEvent } from "../../src/lib/goalspec/patterns";
import type { PublicBoundary } from "./actor";
import type { NativeReadExecutor } from "./gateway-client";
import type { BoundaryWorker } from "./service";
import { localActorDecision, localActorMessages } from "./local-actor";

export interface InfraNativeWorkerConfiguration {
  runId: string;
  scope: Scope;
  snapshotId: string;
  maxBoundaries: number;
  seed: number;
}

/** Public inputs only. Historical prefetched metadata is deliberately excluded. */
export function infraNativeFrame(boundary: PublicBoundary, configuration: InfraNativeWorkerConfiguration, ordinal: number): ExecutionFrame {
  localActorMessages(boundary);
  if (hash(boundary.tools) !== configuration.scope.toolSchemaHash) throw new Error("Native tool schema changed");
  const sources: ExecutionFrame["sources"] = {};
  const events: BindingEvent[] = [], signatures: string[] = [], requirements: string[] = [];
  const calls = new Map<string, string>();
  boundary.messages.forEach((message, index) => {
    if (message.role === "user") {
      sources[`requirement:${index}`] = message.content ?? "";
      requirements.push(message.content ?? "");
    }
    for (const call of message.tool_calls ?? []) {
      calls.set(call.id, call.name);
      events.push({ seq: events.length, kind: "tool_request", call_id: call.id, tool: call.name, arguments: call.arguments });
    }
    if (message.role === "tool") {
      const tool = calls.get(message.id ?? "");
      if (!tool) throw new Error("Native observation lacks an actual call");
      let result: unknown = message.content ?? "";
      try { result = JSON.parse(message.content ?? "null"); } catch { /* Native text is preserved exactly. */ }
      const status = (message as { error?: boolean }).error ? "error" : "success";
      sources[`observation:${index}`] = JSON.parse(canonical(result));
      events.push({ seq: events.length, kind: "tool_result", call_id: message.id, tool, status, result });
      signatures.push(`${tool}:${status}`);
    }
  });
  sources._binding_events = JSON.parse(canonical(events));
  sources._signatures = signatures;
  const frame: ExecutionFrame = { schemaVersion: 1, runId: configuration.runId, boundary: ordinal,
    scope: copy(configuration.scope), snapshotId: configuration.snapshotId, policy: boundary.policy,
    requestedObjective: requirements.join("\n") || "No requested objective is visible at this checkpoint.", sources,
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
  validateContract("ExecutionFrame", frame);
  return frame;
}

/** A step-gateway worker with fixed local actor inputs and Python-owned authoritative effects. */
export class InfraNativeBoundaryWorker implements BoundaryWorker {
  private boundary = 0;
  private closed = false;
  private active?: { controller: AbortController; finished: Promise<void> };
  private seen = new Set<string>();
  private closing?: Promise<void>;
  constructor(private configuration: InfraNativeWorkerConfiguration, private model: LocalChatModelPort,
    private record: (event: Record<string, unknown>) => void,
    private runtime?: InfraSession, private reads?: NativeReadExecutor) {
    if (!!runtime !== !!reads || !configuration.runId || !configuration.snapshotId
      || !Number.isSafeInteger(configuration.maxBoundaries) || configuration.maxBoundaries < 1
      || !Number.isSafeInteger(configuration.seed) || configuration.seed < 0) throw new Error("Invalid infra native worker configuration");
    validateContract("Scope", configuration.scope);
    this.configuration = copy(configuration);
  }
  async decision(publicBoundary: PublicBoundary, boundaryId: string) {
    if (this.closed || this.active || this.boundary >= this.configuration.maxBoundaries) throw new Error("Native worker unavailable or step budget exhausted");
    if (!boundaryId || this.seen.has(boundaryId)) throw new Error("Repeated or empty native checkpoint ID");
    const boundary = copy(publicBoundary);
    const frame = infraNativeFrame(boundary, this.configuration, this.boundary);
    const controller = new AbortController();
    let finish!: () => void;
    this.active = { controller, finished: new Promise<void>(resolve => { finish = resolve; }) };
    this.seen.add(boundaryId); this.boundary++;
    try {
      this.reads?.updateFrame(frame);
      this.record({ type: "infra_native_checkpoint", runId: frame.runId, boundaryId, frameHash: hash(frame), publicInputHash: hash(boundary) });
      this.runtime?.observe(frame);
      const response = await localActorDecision(boundary, this.model, { id: `${frame.runId}:${boundaryId}:actor`,
        maxOutputTokens: 4096, seed: this.configuration.seed, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (this.closed) throw new Error("Native worker closed during inference");
      const promotions: Record<string, string> = {};
      if (this.runtime && this.reads) {
        const invocations = (response.tool_calls ?? []).map(call => ({ tool: call.name, arguments: JSON.parse(canonical(call.arguments)), scope: frame.scope }));
        if (invocations.some(invocation => !this.reads!.nonMutating(invocation))) {
          // Python executes the original batch. Fencing here cancels prediction as well as pending reads.
          await this.runtime.mutationBatch(async () => undefined);
          this.record({ type: "infra_native_mutation_barrier", runId: frame.runId, boundaryId, calls: invocations.length });
        } else {
          for (const [index, invocation] of invocations.entries()) {
            controller.signal.throwIfAborted();
            if (!this.reads.eligible(invocation)) continue;
            const promoted = await this.runtime.promoteOnly(invocation);
            if (promoted !== undefined) {
              const lease = this.reads.takeLease(invocation);
              if (lease) promotions[response.tool_calls![index].id] = lease;
            } else this.record({ type: "infra_native_fallback_deferred_to_python", runId: frame.runId, boundaryId, invocationHash: hash(invocation) });
          }
        }
      }
      controller.signal.throwIfAborted();
      this.record({ type: "infra_native_response", runId: frame.runId, boundaryId, responseHash: hash(response),
        compiler: response.raw_data.goalspecCompiler, stagedPromotions: Object.keys(promotions).length });
      return { ...response, _goalspecPromotions: promotions };
    } finally { this.active = undefined; finish(); }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const active = this.active;
    active?.controller.abort();
    this.closing = Promise.allSettled([active?.finished, this.runtime?.close()]).then(results => {
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    });
    return this.closing;
  }
}
