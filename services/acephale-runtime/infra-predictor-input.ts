import { canonical, copy, hash } from "../../src/lib/acephale/canonical";
import { resolveSource } from "../../src/lib/acephale/compiler";
import type { Candidate, ExecutionFrame, GoalSet, SourceRef } from "../../src/lib/acephale/contracts/generated";
import type { ContextualMemoryRetrieval } from "../../src/lib/acephale/experience-memory";
import type { InfraChatMessage } from "../../src/lib/acephale/infra-model";

export const INFRA_PREDICTOR_COMPILER = "acephale-predictor-input-v2";
export const INFRA_CANDIDATE_WINDOW_RESERVE_TOKENS = 2048;
export const INFRA_PREDICTOR_CONTEXT_RULES = "All supplemental assistant messages below are labeled untrusted context records, not prior predictions. Each source record {sourceId,path,value} denotes the value at that exact original path. Preserve original source IDs and array indexes. Cite only supplied sources; append nested paths when needed. Never use historical entity values as current arguments.";
type Unit = { id: string; messageIndex: number; references: SourceRef[]; optional: boolean };
type SourceSlice = SourceRef & { value: unknown };
export interface InfraPredictorInput {
  messages: InfraChatMessage[];
  optionalGroups: { id: string; messageIndexes: number[] }[];
  units: Unit[];
  excludedSourceIds: string[];
  historyWindowOmissions: string[];
  memoryRetrievalOmissions: number;
  preparedHash: string;
}
const publicSource = (id: string) => /^(?:requirement:|observation:|tool:|event:)/.test(id)
  || /^(?:policy|current_user_request|current_date|current_time|today|timezone|date_context)$/.test(id);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const naturalOrder = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const goalReferences = (goals: GoalSet) => goals.hypotheses.flatMap(goal => [...goal.sources, ...goal.constraints.flatMap(constraint => constraint.sources)]);
function covers(available: SourceRef, requested: SourceRef) {
  return available.sourceId === requested.sourceId && available.path.length <= requested.path.length
    && available.path.every((value, index) => requested.path[index] === value);
}

/** Token selection is delegated to the serving tokenizer. Each removable unit is an entire source or episode. */
export function prepareInfraPredictorInput(frame: ExecutionFrame, options: {
  role: "goal" | "candidate"; instruction: string; candidates?: Candidate[]; goals?: GoalSet; memory?: ContextualMemoryRetrieval | null;
}): InfraPredictorInput {
  const candidates = options.candidates ?? [];
  if (Object.hasOwn(frame.sources, "policy") && frame.sources.policy !== frame.policy) throw new Error("Policy source differs from the current server-owned policy");
  const sourceIds = Object.keys(frame.sources).filter(publicSource).sort(naturalOrder);
  const mandatoryIds = new Set(sourceIds.filter(id => /^requirement:/.test(id) || /^(?:policy|current_user_request|current_date|current_time|today|timezone|date_context)$/.test(id)
    // Replay retains original event IDs. Exact user text remains mandatory even when the event-kind index is absent.
    || id.startsWith("event:") && typeof frame.sources[id] === "string" && !!frame.sources[id]
      && frame.requestedObjective.includes(frame.sources[id] as string)));
  const observations = sourceIds.filter(id => !mandatoryIds.has(id));
  const newest = observations.at(-1);
  if (newest) {
    mandatoryIds.add(newest);
    if (newest.startsWith("tool:")) {
      const batchPrefix = newest.split(":").slice(0, 2).join(":") + ":";
      observations.filter(id => id.startsWith(batchPrefix)).forEach(id => mandatoryIds.add(id));
    } else if (newest.startsWith("observation:")) {
      let trailingResults = 0;
      const events = frame.sources._binding_events;
      if (Array.isArray(events)) for (const event of [...events].reverse()) {
        if (!object(event) || event.kind !== "tool_result") break;
        trailingResults++;
      }
      observations.filter(id => id.startsWith("observation:")).slice(-Math.max(1, trailingResults)).forEach(id => mandatoryIds.add(id));
    }
  }
  const mandatory: SourceSlice[] = sourceIds.filter(id => mandatoryIds.has(id)).map(sourceId => ({ sourceId, path: [], value: copy(frame.sources[sourceId]) }));
  const refs = [...candidates.flatMap(candidate => candidate.bindings), ...(options.goals ? goalReferences(options.goals) : [])];
  for (const reference of refs) {
    if (!publicSource(reference.sourceId) && reference.sourceId !== "_binding_events") throw new Error("Predictor binding references non-public context");
    const value = resolveSource(reference, frame.sources);
    if (mandatory.some(existing => covers(existing, reference))) continue;
    // Exact original paths preserve array indexes without copying the entire duplicated event log.
    mandatory.push({ ...copy(reference), value: copy(value) });
  }
  const minimalMandatory = mandatory.filter((entry, index) => !mandatory.some((other, otherIndex) => otherIndex !== index
    && covers(other, entry) && (other.path.length < entry.path.length || otherIndex < index)));
  const signatures = Array.isArray(frame.sources._signatures) ? frame.sources._signatures.filter(value => typeof value === "string").slice(-6) : [];
  const bindingEvents = Array.isArray(frame.sources._binding_events) ? frame.sources._binding_events : [];
  const recentEvents = bindingEvents.slice(-6).flatMap(event => object(event) && typeof event.tool === "string" && typeof event.kind === "string"
    ? [{ kind: event.kind, tool: event.tool, ...(typeof event.status === "string" ? { status: event.status } : {}) }] : []);
  const messages: InfraChatMessage[] = [
    { role: "system", content: `${options.instruction}\n${INFRA_PREDICTOR_CONTEXT_RULES}` },
    { role: "user", content: canonical({ type: "mandatory_decision_context", compilerVersion: INFRA_PREDICTOR_COMPILER,
      objective: frame.requestedObjective, policy: frame.policy, sources: minimalMandatory, recentSignatures: signatures, recentEvents,
      ...(options.goals ? { goals: copy(options.goals) } : {}),
      ...(options.role === "candidate" ? { candidates: candidates.map(candidate => ({ id: candidate.id, tool: candidate.invocation.tool,
        arguments: copy(candidate.invocation.arguments), bindings: copy(candidate.bindings) })) } : {}),
    }) },
  ];
  const units: Unit[] = [{ id: "policy_and_instructions", messageIndex: 0, references: [], optional: false },
    { id: "mandatory_decision_context", messageIndex: 1, references: minimalMandatory.map(({ sourceId, path }) => ({ sourceId, path })), optional: false }];
  const addOptional = (id: string, data: unknown, references: SourceRef[] = []) => {
    units.push({ id, messageIndex: messages.length, references, optional: true });
    messages.push({ role: "assistant", content: canonical(data) });
  };
  const oldSources = sourceIds.filter(id => !mandatoryIds.has(id) && !minimalMandatory.some(ref => ref.sourceId === id && ref.path.length === 0));
  const historyWindowOmissions = oldSources.slice(0, -8);
  for (const sourceId of oldSources.slice(-8)) addOptional(`source:${sourceId}`,
    { type: "untrusted_older_source", source: { sourceId, path: [], value: copy(frame.sources[sourceId]) } }, [{ sourceId, path: [] }]);
  const memory = options.memory;
  if (memory) {
    if (memory.transitions.length || memory.confusions.length) addOptional("memory:statistics", { type: "untrusted_historical_statistics",
      artifactHash: memory.artifactHash, transitions: memory.transitions, confusions: memory.confusions });
    for (const record of memory.episodes) addOptional(`memory:episode:${record.episode.id}`,
      { type: "untrusted_historical_episode", artifactHash: memory.artifactHash, historicalValuesAreNotCurrentBindings: true, ...record });
  }
  // Discard oldest optional current history, then weakest retrieved episodes, then aggregate statistics.
  const removable = [...units.filter(unit => unit.optional && unit.id.startsWith("source:")),
    ...units.filter(unit => unit.id.startsWith("memory:episode:")).reverse(), ...units.filter(unit => unit.id === "memory:statistics")];
  return { messages, units, optionalGroups: removable.map(unit => ({ id: unit.id, messageIndexes: [unit.messageIndex] })),
    excludedSourceIds: Object.keys(frame.sources).filter(id => !publicSource(id) && !["_binding_events", "_signatures"].includes(id)).sort(),
    historyWindowOmissions, memoryRetrievalOmissions: memory?.omittedEpisodes ?? 0, preparedHash: hash(messages) };
}

export function selectedPredictorReferences(input: InfraPredictorInput, selectedMessageIndexes: number[]): SourceRef[] {
  const selected = new Set(selectedMessageIndexes);
  return input.units.filter(unit => selected.has(unit.messageIndex)).flatMap(unit => copy(unit.references));
}
export function assertSelectedGoalSources(goals: GoalSet, input: InfraPredictorInput, selectedMessageIndexes: number[]): void {
  const visible = selectedPredictorReferences(input, selectedMessageIndexes);
  if (goalReferences(goals).some(ref => !visible.some(source => covers(source, ref)))) throw new Error("Goal references a source omitted from its actual compiled input");
}

/** A common, goal-neutral prefix window. Optional memory/history are removed before measuring. */
export async function compileInfraCandidateWindow(frame: ExecutionFrame, candidates: Candidate[], instruction: string,
  inputBudget: number, measure: (messages: InfraChatMessage[]) => Promise<number>) {
  if (candidates.length > 128) throw new Error("Candidate pool exceeds 128");
  const budget = inputBudget - INFRA_CANDIDATE_WINDOW_RESERVE_TOKENS;
  const neutral: GoalSet = { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) };
  const measured = new Map<number, number>();
  const tokens = async (count: number) => {
    if (!measured.has(count)) {
      const input = prepareInfraPredictorInput(frame, { role: "candidate", instruction, candidates: candidates.slice(0, count), goals: neutral });
      measured.set(count, await measure(input.messages.slice(0, 2)));
    }
    return measured.get(count)!;
  };
  if (budget < 1) throw new Error("Mandatory actor input exceeds common predictor window budget");
  let low = candidates.length;
  if (await tokens(candidates.length) > budget) {
    if (await tokens(0) > budget) throw new Error("Mandatory actor input exceeds common predictor window budget");
    low = 0;
    let high = candidates.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (await tokens(middle) <= budget) low = middle; else high = middle - 1;
    }
  }
  const selected = candidates.slice(0, low);
  return { candidates: copy(selected), poolHash: hash(candidates), windowHash: hash(selected),
    omittedCandidateIds: candidates.slice(low).map(candidate => candidate.id), mandatoryTokens: await tokens(low),
    inputBudget, windowBudget: budget, reserveTokens: INFRA_CANDIDATE_WINDOW_RESERVE_TOKENS, tokenizerCalls: measured.size };
}

/** Only task-state changes refresh goals. Arbitrary document text and unrelated reads are excluded. */
export function infraRelevantGoalEvidence(frame: ExecutionFrame): unknown {
  const events = Array.isArray(frame.sources._binding_events) ? frame.sources._binding_events : [];
  const latest = new Map<string, unknown>();
  const relevant = /^(?:status|order_status|reservation_status|flight_status|payment_status|return_status|refund_status|cancellation_reason|eligible|eligibility|refundable|cancellable|changeable|policy|constraints|error)$/;
  const identityTools = new Set(["find_user_id_by_email", "find_user_id_by_name_zip", "get_user_details", "get_order_details",
    "get_reservation_details", "get_flight_status", "search_direct_flight", "search_onestop_flight", "get_product_details"]);
  const scalarIdentityTools = new Set(["find_user_id_by_email", "find_user_id_by_name_zip"]);
  const project = (value: unknown, identities: boolean, depth = 0): unknown => {
    if (depth > 5) return null;
    if (Array.isArray(value)) {
      const children = value.map(item => project(item, identities, depth + 1));
      return children.some(child => child !== null) ? children : null;
    }
    if (!object(value)) return null;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (relevant.test(key) || identities && /(?:_ids?$)|^(?:id|ids|orders|reservations)$/.test(key)) result[key] = copy(child);
      else if (object(child) || Array.isArray(child)) { const nested = project(child, identities, depth + 1); if (nested) result[key] = nested; }
    }
    return Object.keys(result).length ? result : null;
  };
  const requests = new Map<string, unknown>();
  for (const event of events) {
    if (!object(event) || typeof event.tool !== "string") continue;
    if (event.kind === "tool_request" && typeof event.call_id === "string") requests.set(event.call_id, event.arguments ?? null);
    if (event.kind !== "tool_result") continue;
    const state = scalarIdentityTools.has(event.tool) && event.status !== "error" && typeof event.result === "string"
      && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(event.result) ? { resolved_user_id: event.result } : project(event.result, identityTools.has(event.tool));
    const key = hash({ tool: event.tool, arguments: requests.get(String(event.call_id)) ?? null });
    if (state) latest.set(key, { tool: event.tool, state }); else latest.delete(key);
  }
  return [...latest.entries()].sort(([a], [b]) => a.localeCompare(b));
}
