import { hash } from "./canonical";
import type { Candidate, ExecutionFrame } from "./contracts/generated";
import type { Experience } from "./repository";
import { resolveBinding, type ArgumentBinding, type BindingEvent } from "./patterns";

export function bindWorkflowPatterns(frame: ExecutionFrame, records: Experience[]): Candidate[] {
  const events = frame.sources._binding_events;
  const signatures = frame.sources._signatures;
  if (!Array.isArray(events) || !Array.isArray(signatures)) return [];
  const candidates: Candidate[] = [];
  for (const record of records) {
    const pattern = record.pattern;
    if (record.split !== "train" || pattern.snapshotId !== frame.snapshotId || hash(pattern.scope) !== hash(frame.scope)) continue;
    // Unsupported prerequisite predicates fail closed, rather than treating
    // empirical ordering as proof that a policy prerequisite was satisfied.
    if (pattern.policyPrerequisites.length || pattern.verificationTier !== "native_verified") continue;
    let position = 0;
    for (const signature of signatures) if (pattern.prefix[position] === signature) position++;
    if (position !== pattern.prefix.length) continue;
    try {
      const binding = pattern.binding as unknown as ArgumentBinding;
      if (binding.language_version !== 1 || binding.examples < 2 || binding.total_examples < binding.examples) continue;
      const value = resolveBinding(binding.expression, events as unknown as BindingEvent[], Number.MAX_SAFE_INTEGER);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const invocation = { tool: pattern.tool, arguments: value as Candidate["invocation"]["arguments"], scope: frame.scope };
      candidates.push({ schemaVersion: 1, id: hash({ pattern: pattern.id, invocation }), invocation,
        probability: (binding.examples / binding.total_examples) * pattern.successes / Math.max(1, pattern.successes + pattern.failures),
        bindings: [{ sourceId: "_binding_events", path: [] }], hop: 1, patternId: pattern.id });
    } catch { /* A missing current binding produces no candidate. */ }
  }
  return candidates;
}
