import { copy, hash } from "./canonical";
import type { ExecutionFrame, WorkflowPattern, SourceRef } from "./contracts/generated";
import { validateMemoryArtifact, type FrozenExperienceMemory, type MemoryEpisode } from "./experience-memory";
import { inferBinding, type BindingEvent, type BindingSample, type Expression, type ArgumentBinding } from "./patterns";
import { bindWorkflowPatterns } from "./workflow-binder";
import type { Experience } from "./repository";

function eventsFromEpisode(episode: MemoryEpisode): BindingEvent[] {
  const events: BindingEvent[] = [], calls = new Map<string, string>();
  for (const message of episode.prefix) {
    for (const call of message.calls) {
      calls.set(call.id, call.tool);
      events.push({ seq: events.length, kind: "tool_request", call_id: call.id, tool: call.tool, arguments: call.arguments });
    }
    if (message.role === "tool" && message.callId && calls.has(message.callId)) {
      events.push({ seq: events.length, kind: "tool_result", call_id: message.callId, tool: calls.get(message.callId), status: "success", result: message.observation });
    }
  }
  return events;
}
/** Compile only current-compatible symbolic mappings, once per frozen memory. */
export function compileInfraWorkflows(input: FrozenExperienceMemory, tools: Record<string, Record<string, unknown>>, options: { excludeFamilies?: string[]; allowedFamilies?: string[] } = {}) {
  const memory = validateMemoryArtifact(input), runs = new Map(memory.runs.map(run => [run.id, run]));
  const groups = new Map<string, { episodes: MemoryEpisode[]; samples: BindingSample[]; families: Set<string>; successes: number; failures: number; tool: string }>();
  for (const episode of memory.episodes) {
    const run = runs.get(episode.runId)!;
    if (!run.outcomeVerified || run.constraintViolations || options.excludeFamilies?.includes(run.familyId)
      || options.allowedFamilies && !options.allowedFamilies.includes(run.familyId)) continue;
    for (const action of episode.nextActions) {
      if (!Object.hasOwn(tools, action.tool)) continue;
      const key = hash([episode.scope, episode.previousTool, action.tool, Object.keys(action.arguments).sort()]);
      const group = groups.get(key) ?? { episodes: [], samples: [], families: new Set<string>(), successes: 0, failures: 0, tool: action.tool };
      if (run.success) {
        const events = eventsFromEpisode(episode);
        group.episodes.push(episode); group.families.add(run.familyId);
        group.samples.push({ events, throughSeq: events.length - 1, arguments: copy(action.arguments) }); group.successes++;
      } else group.failures++;
      groups.set(key, group);
    }
  }
  const records: Experience[] = [];
  for (const [key, group] of groups) {
    if (group.families.size < 2 || group.samples.length < 2) continue;
    const binding = inferBinding(group.samples, tools[group.tool], 2); if (!binding) continue;
    const episode = group.episodes[0];
    const prefix: WorkflowPattern["prefix"] = episode.previousTool.startsWith("__") ? [] : [`${episode.previousTool}:success`];
    const pattern: WorkflowPattern = { schemaVersion: 1, id: key, scope: copy(episode.scope), snapshotId: memory.repositorySnapshotId,
      verificationTier: "native_verified", prefix, tool: group.tool, binding: copy(binding) as unknown as WorkflowPattern["binding"],
      dataDependencies: ["current_visible_tool_events"], policyPrerequisites: [], observedOrdering: [...prefix], branches: [], successes: group.successes, failures: group.failures };
    records.push({ id: key, familyId: [...group.families].sort().join("|"), text: `${episode.previousTool} -> ${group.tool}`, embedding: [], pattern, split: "train" });
  }
  const contentHash = hash({ version: "infra-symbolic-workflows-v1", memoryHash: memory.contentHash, toolsHash: hash(tools), records });
  return { contentHash, records, bind(frame: ExecutionFrame) {
    if (frame.snapshotId !== memory.repositorySnapshotId) return [];
    const compatible = records.filter(record => hash(record.pattern.scope) === hash(frame.scope));
    return bindWorkflowPatterns(frame, compatible).flatMap(candidate => {
      // Preserve exact original event indices while avoiding the entire trace as
      // a mandatory binding slice in the predictor's bounded context.
      const expression = (compatible.find(record => record.id === candidate.patternId)!.pattern.binding as unknown as ArgumentBinding).expression;
      const events = frame.sources._binding_events as unknown as BindingEvent[];
      const requests = new Map(events.filter(event => event.kind === "tool_request").map(event => [event.call_id, event.seq]));
      const bindings: SourceRef[] = [];
      function visit(node: Expression) {
        if (node.kind === "reference" && node.reference) {
          const ref = node.reference;
          const matches = events.filter(event => event.tool === ref.tool && (ref.source === "arguments" ? event.kind === "tool_request" : event.kind === "tool_result" && event.status === "success" && requests.has(event.call_id)))
            .sort((a, b) => ref.source === "arguments" ? b.seq - a.seq : requests.get(b.call_id)! - requests.get(a.call_id)!);
          const event = matches[ref.occurrence - 1], index = events.indexOf(event);
          const path = [index, ref.source === "arguments" ? "arguments" : "result", ...ref.path];
          if (index < 0 || path.length > 8) throw new Error("Binding source exceeds wire bounds");
          bindings.push({ sourceId: "_binding_events", path: path as SourceRef["path"] });
        }
        Object.values(node.fields ?? {}).forEach(visit); (node.items ?? []).forEach(visit);
      }
      try { visit(expression); return [{ ...candidate, bindings: [...new Map(bindings.map(ref => [hash(ref), ref])).values()] }]; }
      catch { return []; }
    });
  } };
}
