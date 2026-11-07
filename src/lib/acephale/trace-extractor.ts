import { canonical, hash, type Json } from "./canonical";
import type { MemoryAction, MemoryEpisode, MemoryMessage, MemoryRun, ArgumentProvenance } from "./experience-memory";

function leafValues(value: Json, initial: (string | number)[] = []) {
  const result: { value: Json; path: (string | number)[] }[] = [];
  let remaining = 2048;
  function visit(node: Json, path: (string | number)[]) {
    if (--remaining < 0 || path.length > 12) return;
    if (node !== null && typeof node === "object") Object.entries(node).forEach(([key, entry]) => visit(entry, [...path, Array.isArray(node) ? Number(key) : key]));
    else result.push({ value: node, path });
  }
  visit(value, initial); return result;
}
function provenance(actions: MemoryAction[], prefix: MemoryMessage[]): ArgumentProvenance[] {
  const sources = prefix.flatMap(message => [
    ...leafValues(message.observation, ["observation"]),
    ...leafValues(message.calls as unknown as Json, ["calls"]),
    ...(message.role === "user" && message.content !== null ? [{ value: message.content, path: ["content"] }] : []),
  ].map(source => ({ ...source, messageIndex: message.index })));
  return actions.flatMap(action => leafValues(action.arguments).map(argument => ({
    actionId: action.id, argumentPath: argument.path,
    sources: sources.flatMap(source => {
      const exact = canonical(source.value) === canonical(argument.value);
      const substring = typeof argument.value === "string" && argument.value.length > 0 && typeof source.value === "string" && source.value.includes(argument.value);
      return exact || substring ? [{ messageIndex: source.messageIndex, path: source.path,
        method: exact ? "exact" as const : "substring" as const }] : [];
    }).slice(-8),
  })));
}

export function extractMemoryEpisodes(run: MemoryRun, messages: MemoryMessage[]): MemoryEpisode[] {
  const result: MemoryEpisode[] = [];
  let boundary = 0;
  for (let index = 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const prefix = messages.slice(0, index), requirements = prefix.filter(row => row.role === "user").map(row => row.content ?? "");
    if (!requirements.length) continue;
    const previous = prefix.flatMap(row => row.calls).at(-1)?.tool ?? "__start__";
    const observations: MemoryMessage[] = [];
    for (let next = index + 1; next < messages.length && messages[next].role === "tool"; next++) observations.push(messages[next]);
    const episode: MemoryEpisode = { id: hash({ run: run.id, boundary }), runId: run.id, boundary, scope: run.scope,
      prefixHash: hash(prefix), prefix, requirements, previousTool: previous, nextActions: message.calls,
      nextMessage: message.content, resultingObservations: observations, argumentSources: provenance(message.calls, prefix),
      lesson: run.success && run.outcomeVerified
        ? "This continuation occurred in a verified successful task. Rebind every argument from current evidence and recheck current policy."
        : "This continuation occurred in a failed task. It is a contrastive example, not an approved workflow or a diagnosis of the failure." };
    result.push(episode); boundary++;
  }
  return result;
}
