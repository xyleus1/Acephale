import { copy, hash } from "./canonical";
import type { EvidenceEnvelope, ExecutionFrame } from "./contracts/generated";
import { validateContract } from "./contracts/validate";

// These are real completed speculative executions, recorded separately from
// actor tool calls. They never create a fabricated model function-call result.
export function addEvidenceSources(frame: Pick<ExecutionFrame, "sources" | "scope">, entries: EvidenceEnvelope[]) {
  const events = Array.isArray(frame.sources._binding_events) ? frame.sources._binding_events : [];
  const signatures = Array.isArray(frame.sources._signatures) ? frame.sources._signatures : [];
  for (const entry of entries) {
    validateContract("EvidenceEnvelope", entry);
    if (hash(entry.invocation.scope) !== hash(frame.scope)) throw new Error("Prefetched evidence scope changed");
    const sourceId = `prefetch:${entry.id}`;
    if (Object.hasOwn(frame.sources, sourceId)) continue;
    frame.sources[sourceId] = { tool: entry.invocation.tool, arguments: copy(entry.invocation.arguments),
      observation: copy(entry.observation), observedAt: entry.observedAt, validatedAt: entry.validatedAt };
    events.push({ seq: events.length, kind: "tool_request", call_id: sourceId,
      tool: entry.invocation.tool, arguments: copy(entry.invocation.arguments), speculative: true });
    events.push({ seq: events.length, kind: "tool_result", call_id: sourceId,
      tool: entry.invocation.tool, status: "success", result: copy(entry.observation), speculative: true });
    signatures.push(`${entry.invocation.tool}:success`);
  }
  frame.sources._binding_events = events;
  frame.sources._signatures = signatures;
}
