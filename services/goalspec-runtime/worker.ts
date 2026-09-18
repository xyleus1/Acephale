import { canonical, copy, hash } from "../../src/lib/goalspec/canonical";
import type { ExecutionFrame, Scope } from "../../src/lib/goalspec/contracts/generated";
import { validateContract } from "../../src/lib/goalspec/contracts/validate";
import type { Allocation } from "../../src/lib/goalspec/budget";
import { RESEARCH_MODELS, type ModelPort } from "../../src/lib/goalspec/model";
import type { BindingEvent } from "../../src/lib/goalspec/patterns";
import { actorDecision, type PublicBoundary, type ActorRuntime } from "./actor";
import type { NativeReadExecutor } from "./gateway-client";
import type { BoundaryWorker } from "./service";
import { addEvidenceSources } from "../../src/lib/goalspec/evidence-sources";

export interface WorkerConfiguration {
  runId: string; scope: Scope; snapshotId: string; allocation: Allocation;
  maximumAttemptMicrodollars: number; maxBoundaries: number;
}

export class NativeBoundaryWorker implements BoundaryWorker {
  private boundary = 0;
  private closed = false;
  private active = false;
  private activeFinished?: Promise<void>;
  constructor(private configuration: WorkerConfiguration, private model: ModelPort,
    private record: (event: unknown) => void,
    private runtime?: ActorRuntime, private reads?: NativeReadExecutor) {
    if (!!runtime !== !!reads || !Number.isInteger(configuration.maxBoundaries) || configuration.maxBoundaries < 1) throw new Error("Invalid worker configuration");
  }
  async decision(publicBoundary: PublicBoundary, boundaryId: string) {
    if (this.closed || this.active || this.boundary >= this.configuration.maxBoundaries) throw new Error("Native worker unavailable or step budget exhausted");
    this.active = true;
    let finish!: () => void;
    this.activeFinished = new Promise<void>(resolve => { finish = resolve; });
    try {
      const boundary = copy(publicBoundary);
      if (hash(boundary.tools) !== this.configuration.scope.toolSchemaHash) throw new Error("Native tool schema changed");
      const sources: ExecutionFrame["sources"] = {};
      const events: BindingEvent[] = [];
      const signatures: string[] = [];
      const calls = new Map<string, string>();
      const requirements: string[] = [];
      boundary.messages.forEach((message, index) => {
        const evidence = (message.raw_data as { goalspecVerifiedEvidence?: unknown } | undefined)?.goalspecVerifiedEvidence;
        if (evidence !== undefined) {
          if (message.role !== "assistant" || !Array.isArray(evidence) || evidence.length > 2) throw new Error("Invalid historical prefetched evidence");
          const partial = { sources: { ...sources, _binding_events: JSON.parse(canonical(events)), _signatures: signatures },
            scope: this.configuration.scope } as Pick<ExecutionFrame, "sources" | "scope">;
          addEvidenceSources(partial, evidence);
          Object.assign(sources, partial.sources);
          events.splice(0, events.length, ...(partial.sources._binding_events as unknown as BindingEvent[]));
        }
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
          try { result = JSON.parse(message.content ?? "null"); } catch { /* Native textual observations stay strings. */ }
          const status = (message as { error?: boolean }).error ? "error" : "success";
          sources[`observation:${index}`] = JSON.parse(canonical(result));
          events.push({ seq: events.length, kind: "tool_result", call_id: message.id, tool, status, result });
          signatures.push(`${tool}:${status}`);
        }
      });
      sources._binding_events = JSON.parse(canonical(events));
      sources._signatures = signatures;
      const frame: ExecutionFrame = { schemaVersion: 1, runId: this.configuration.runId, boundary: this.boundary++,
        scope: this.configuration.scope, snapshotId: this.configuration.snapshotId, policy: boundary.policy,
        requestedObjective: requirements.join("\n"), sources,
        goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
      validateContract("ExecutionFrame", frame);
      this.reads?.updateFrame(frame);
      if (!this.runtime) this.record({ type: "execution_frame", frame: copy(frame) });
      this.record({ type: "actor_boundary", boundaryId, frameHash: hash(frame), inputHash: hash(boundary) });
      const response = await actorDecision(boundary, frame, this.model, {
        id: `${this.configuration.runId}:${boundaryId}:actor`, model: RESEARCH_MODELS.actor,
        reasoning: "medium", maxOutputTokens: 4096, allocation: this.configuration.allocation,
        maximumAttemptMicrodollars: this.configuration.maximumAttemptMicrodollars, retries: 0,
      }, this.runtime);
      const promotions: Record<string, string> = {};
      if (this.runtime && this.reads) {
        const invocations = (response.tool_calls ?? []).map(call => ({ tool: call.name, arguments: JSON.parse(canonical(call.arguments)), scope: frame.scope }));
        if (invocations.some(invocation => !this.reads!.nonMutating(invocation))) {
          await this.runtime.scheduler.invalidate("native_mixed_or_mutating_batch");
        } else {
          // Fallback runs in Python. Node only joins and verifies existing work.
          for (const [index, invocation] of invocations.entries()) {
            // Pure native calculations preserve leases but execute only in Python.
            if (!this.reads.eligible(invocation)) continue;
            const observation = await this.runtime.scheduler.authoritative(invocation, async () => null);
            if (observation !== null) {
              const lease = this.reads.takeLease(invocation);
              if (lease) promotions[response.tool_calls![index].id] = lease;
            }
          }
        }
      }
      this.record({ type: "actor_response", boundaryId, responseHash: hash(response), compiler: response.raw_data.goalspecCompiler,
        stagedPromotions: Object.keys(promotions).length });
      return { ...response, _goalspecPromotions: promotions };
    } finally { this.active = false; finish(); }
  }
  async close() { this.closed = true; await this.activeFinished; await this.runtime?.close(); }
}
