import { canonical, copy } from "../../src/lib/acephale/canonical";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { EvidenceEnvelope } from "../../src/lib/acephale/contracts/generated";
import type { InfraModelResult } from "../../src/lib/acephale/infra-model";

/** Public native-agent protocol. Actor behavior lives only in local-actor.ts. */
export interface NativeMessage {
  role: "system" | "user" | "assistant" | "tool"; content?: string | null; id?: string;
  tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[] | null;
  raw_data?: { acephaleContinuation?: ResponseInputItem[]; acephaleVerifiedEvidence?: EvidenceEnvelope[]; acephaleActorContext?: {
    version: 1; boundary: number; scopeHash: string; snapshotId: string; text: string;
  }; acephaleCompiler?: (InfraModelResult["compiler"] & { inputHash: string; tokens: number; actorContextMode: "none" });
    acephaleLocalContinuation?: InfraModelResult["continuation"]; acephaleLocalTiming?: InfraModelResult["timing"] } | null;
}
export interface PublicBoundary { messages: NativeMessage[]; policy: string; tools: { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } }[] }

export function nativeInput(messages: NativeMessage[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  const calls = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.id || !calls.delete(message.id)) throw new Error("Tool result has no matching real call ID");
      input.push({ type: "function_call_output", call_id: message.id, output: message.content ?? "null" });
    } else if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        if (calls.has(call.id) || !call.id) throw new Error("Duplicate tool call ID");
        calls.add(call.id);
      }
      if (message.raw_data?.acephaleContinuation) input.push(...copy(message.raw_data.acephaleContinuation));
      else {
        if (message.content) input.push({ role: "assistant", content: message.content });
        for (const call of message.tool_calls ?? []) input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: canonical(call.arguments) });
      }
    } else input.push({ role: message.role, content: message.content ?? "" });
  }
  if (calls.size) throw new Error("Unresolved calls at actor boundary");
  return input;
}
