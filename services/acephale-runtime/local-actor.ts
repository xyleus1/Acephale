import { canonical } from "../../src/lib/acephale/canonical";
import { LocalChatModelPort, validateInfraMessages, type InfraChatMessage, type InfraModelRequest } from "../../src/lib/acephale/infra-model";
import type { PublicBoundary } from "./actor";

/** Converts only native public messages. Derived Acephale contexts and evidence never enter this actor. */
export function localActorMessages(boundary: PublicBoundary): InfraChatMessage[] {
  const messages: InfraChatMessage[] = [{ role: "system", content: boundary.policy }];
  for (const message of boundary.messages) {
    if (message.role === "tool") {
      if (!message.id) throw new Error("Native tool result is missing its actual call ID");
      messages.push({ role: "tool", tool_call_id: message.id, content: message.content ?? "null" });
    } else if (message.role === "assistant") {
      messages.push({ role: "assistant", content: message.content ?? null,
        ...(message.tool_calls?.length ? { tool_calls: message.tool_calls.map(call => ({ id: call.id,
          type: "function" as const, function: { name: call.name, arguments: canonical(call.arguments) } })) } : {}) });
    } else messages.push({ role: message.role, content: message.content ?? "" });
  }
  validateInfraMessages(messages);
  return messages;
}

function oldHistoryGroups(messages: InfraChatMessage[]) {
  const groups: { id: string; messageIndexes: number[]; hasEvidence: boolean }[] = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (message.role !== "assistant") { index++; continue; }
    const indexes = [index++];
    const pending = new Set((message.tool_calls ?? []).map(call => call.id));
    while (pending.size && index < messages.length) {
      const result = messages[index];
      if (result.role !== "tool" || !pending.delete(result.tool_call_id)) throw new Error("Invalid native history group");
      indexes.push(index++);
    }
    if (pending.size) throw new Error("Incomplete native history group");
    groups.push({ id: `history:${indexes[0]}:${indexes.at(-1)}`, messageIndexes: indexes, hasEvidence: indexes.length > 1 });
  }
  const latestEvidence = [...groups].reverse().find(group => group.hasEvidence);
  return groups.filter(group => group !== latestEvidence).map(({ id, messageIndexes }) => ({ id, messageIndexes }));
}

export async function localActorDecision(boundary: PublicBoundary, model: LocalChatModelPort,
  configuration: Pick<InfraModelRequest, "id" | "maxOutputTokens" | "seed" | "signal">) {
  const messages = localActorMessages(boundary);
  const result = await model.complete({ ...configuration, messages, tools: boundary.tools, optionalGroups: oldHistoryGroups(messages) });
  return {
    role: "assistant" as const, content: result.continuation.content,
    tool_calls: result.calls.length ? result.calls.map(call => ({ ...call, requestor: "assistant" as const })) : null,
    raw_data: { acephaleLocalContinuation: result.continuation, acephaleCompiler: {
      ...result.compiler, inputHash: result.inputHash, tokens: result.inputTokens, actorContextMode: "none" as const,
    }, acephaleLocalTiming: result.timing }, usage: result.usage,
  };
}
