import { canonical, copy, hash, type Json } from "./canonical";
import type { ExecutionFrame } from "./contracts/generated";

export type MemoryScope = ExecutionFrame["scope"];
export type MemoryStage = "v1-training" | "v2-development-1" | "v2-development-2" | "v5-training";
export interface MemoryFile { path: string; sha256: string }
export interface MemoryAction { id: string; tool: string; arguments: Record<string, Json> }
export interface MemoryMessage {
  index: number; role: "user" | "assistant" | "tool"; content: string | null;
  calls: MemoryAction[]; callId: string | null; observation: Json;
}
export interface MemoryRun {
  id: string; familyId: string; stage: MemoryStage; split: "train" | "development";
  scope: MemoryScope; policyHash: string; sourceFiles: MemoryFile[];
  success: boolean; outcomeVerified: boolean; constraintViolations: number;
  termination: string; publicMessageCount: number; episodeCount: number;
}
export interface ArgumentProvenance {
  actionId: string; argumentPath: (string | number)[];
  sources: { messageIndex: number; path: (string | number)[]; method: "exact" | "substring" }[];
}
export interface MemoryEpisode {
  id: string; runId: string; boundary: number; scope: MemoryScope;
  prefixHash: string; prefix: MemoryMessage[]; requirements: string[];
  previousTool: string; nextActions: MemoryAction[]; nextMessage: string | null;
  resultingObservations: MemoryMessage[]; argumentSources: ArgumentProvenance[];
  lesson: string;
}
export interface MemoryMiss {
  id: string; episodeId: string; predicted: Omit<MemoryAction, "id">;
  actual: Omit<MemoryAction, "id">[]; fullMatch: boolean; toolMatch: boolean;
  admitted: boolean; beforeActorResponse: boolean; eventSequence: number;
  eventHash: string; source: MemoryFile;
}
export interface MemoryTransition {
  scope: MemoryScope; from: string; to: string; successes: number; failures: number;
  confidence: number; successRate: number; argumentSignatures: string[][];
  episodeIds: string[]; runIds: string[];
}
export interface MemoryConfusion {
  scope: MemoryScope; previousTool: string; predictedTool: string; actualTool: string;
  count: number; runIds: string[]; missIds: string[];
}
export interface FrozenExperienceMemory {
  schemaVersion: 1; compilerVersion: "goalspec-memory-v3" | "goalspec-memory-v5"; repositorySnapshotId: string;
  sourcePolicy: "v1-training-plus-v2-development-only" | "v5-and-permitted-training-only";
  sourceFiles: MemoryFile[]; runs: MemoryRun[]; episodes: MemoryEpisode[]; misses: MemoryMiss[];
  transitions: MemoryTransition[]; confusions: MemoryConfusion[]; contentHash: string;
}
export interface MemoryRetrieval {
  queryHash: string; artifactHash: string; episodeIds: string[]; hints: string[];
  transitions: MemoryTransition[]; confusions: MemoryConfusion[];
}

type MemoryInput = Pick<FrozenExperienceMemory, "repositorySnapshotId" | "sourceFiles" | "runs" | "episodes" | "misses">;
const validated = new WeakSet<object>();
const indexes = new WeakMap<object, { runs: Map<string, MemoryRun>; terms: Map<string, Set<string>> }>();
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value);
const sameScope = (a: MemoryScope, b: MemoryScope) => canonical(a) === canonical(b);

function memoryStatistics(input: MemoryInput) {
  const runs = new Map(input.runs.map(run => [run.id, run]));
  const episodes = new Map(input.episodes.map(episode => [episode.id, episode]));
  const transitions = new Map<string, MemoryTransition>();
  for (const episode of input.episodes) {
    const run = runs.get(episode.runId);
    if (!run) throw new Error("Memory episode has no run provenance");
    const actions = episode.nextActions.length ? episode.nextActions
      : episode.nextMessage !== null ? [{ tool: "__message__", arguments: {} }] : [];
    for (const action of actions) {
      const key = canonical([episode.scope, episode.previousTool, action.tool]);
      const row = transitions.get(key) ?? { scope: copy(episode.scope), from: episode.previousTool, to: action.tool,
        successes: 0, failures: 0, confidence: 0, successRate: 0, argumentSignatures: [], episodeIds: [], runIds: [] };
      if (run.outcomeVerified && run.success) row.successes++; else row.failures++;
      row.episodeIds.push(episode.id); row.runIds.push(run.id);
      row.argumentSignatures.push(Object.keys(action.arguments).sort()); transitions.set(key, row);
    }
  }
  for (const row of transitions.values()) {
    const total = [...transitions.values()].filter(other => sameScope(other.scope, row.scope) && other.from === row.from)
      .reduce((sum, other) => sum + other.successes + other.failures, 0);
    row.confidence = (row.successes + row.failures) / total;
    row.successRate = row.successes / (row.successes + row.failures);
    row.episodeIds = [...new Set(row.episodeIds)].sort(); row.runIds = [...new Set(row.runIds)].sort();
    row.argumentSignatures = [...new Map(row.argumentSignatures.map(keys => [canonical(keys), keys])).values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  }
  const confusions = new Map<string, MemoryConfusion>();
  const seen = new Set<string>();
  for (const miss of input.misses) {
    if (miss.toolMatch || !miss.beforeActorResponse) continue;
    const episode = episodes.get(miss.episodeId);
    if (!episode) throw new Error("Memory miss has no episode provenance");
    const actualTools = miss.actual.length ? miss.actual.map(action => action.tool)
      : episode.nextMessage !== null ? ["__message__"] : [];
    for (const actualTool of [...new Set(actualTools)]) {
      // Multiple duplicate proposals at one decision count as one confusion.
      const occurrence = canonical([episode.id, miss.predicted.tool, actualTool]);
      if (seen.has(occurrence)) continue;
      seen.add(occurrence);
      const key = canonical([episode.scope, episode.previousTool, miss.predicted.tool, actualTool]);
      const row = confusions.get(key) ?? { scope: copy(episode.scope), previousTool: episode.previousTool,
        predictedTool: miss.predicted.tool, actualTool, count: 0, runIds: [], missIds: [] };
      row.count++; row.runIds.push(episode.runId); row.missIds.push(miss.id); confusions.set(key, row);
    }
  }
  for (const row of confusions.values()) { row.runIds = [...new Set(row.runIds)].sort(); row.missIds.sort(); }
  return { transitions: [...transitions].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row),
    confusions: [...confusions].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row) };
}

export function buildMemoryArtifact(input: MemoryInput, options: { profile?: "v3" | "v5" } = {}): FrozenExperienceMemory {
  const body = { schemaVersion: 1 as const, compilerVersion: options.profile === "v5" ? "goalspec-memory-v5" as const : "goalspec-memory-v3" as const,
    sourcePolicy: options.profile === "v5" ? "v5-and-permitted-training-only" as const : "v1-training-plus-v2-development-only" as const, repositorySnapshotId: input.repositorySnapshotId,
    sourceFiles: copy(input.sourceFiles), runs: copy(input.runs), episodes: copy(input.episodes), misses: copy(input.misses), ...memoryStatistics(input) };
  return validateMemoryArtifact({ ...body, contentHash: hash(body) });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze); Object.freeze(value);
  }
  return value;
}
function validScope(value: MemoryScope) {
  return value && ["tenantId", "principalId", "authorizationVersion", "environmentVersion", "toolSchemaHash"]
    .every(key => typeof value[key as keyof MemoryScope] === "string" && value[key as keyof MemoryScope].length > 0)
    && digest(value.toolSchemaHash);
}
function fileKey(file: MemoryFile) { return canonical(file); }

/** Validate once at service startup. Returned content is deeply frozen. */
export function validateMemoryArtifact(value: unknown): FrozenExperienceMemory {
  if (value && typeof value === "object" && validated.has(value)) return value as FrozenExperienceMemory;
  const artifact = copy(value) as FrozenExperienceMemory;
  if (!artifact || artifact.schemaVersion !== 1 || !["goalspec-memory-v3", "goalspec-memory-v5"].includes(artifact.compilerVersion)
    || artifact.sourcePolicy !== (artifact.compilerVersion === "goalspec-memory-v5" ? "v5-and-permitted-training-only" : "v1-training-plus-v2-development-only") || !artifact.repositorySnapshotId
    || !Array.isArray(artifact.runs) || !Array.isArray(artifact.episodes) || !Array.isArray(artifact.misses)
    || !Array.isArray(artifact.sourceFiles) || !Array.isArray(artifact.transitions) || !Array.isArray(artifact.confusions)
    || artifact.runs.length > 10000 || artifact.episodes.length > 100000 || artifact.misses.length > 100000) throw new Error("Invalid memory artifact");
  const { contentHash, ...body } = artifact;
  if (!digest(contentHash) || hash(body) !== contentHash) throw new Error("Memory artifact content hash mismatch");
  const files = new Set<string>();
  const filePaths = new Set<string>();
  for (const file of artifact.sourceFiles) {
    if (!file.path || !digest(file.sha256) || files.has(fileKey(file)) || filePaths.has(file.path)) throw new Error("Invalid memory source file");
    files.add(fileKey(file)); filePaths.add(file.path);
  }
  const runMap = new Map<string, MemoryRun>();
  for (const run of artifact.runs) {
    if (!run.id || runMap.has(run.id) || !run.familyId || !validScope(run.scope) || !digest(run.policyHash)
      || !(artifact.compilerVersion === "goalspec-memory-v5" ? ["v1-training", "v5-training"] : ["v1-training", "v2-development-1", "v2-development-2"]).includes(run.stage)
      || run.split !== (["v1-training", "v5-training"].includes(run.stage) ? "train" : "development")
      || typeof run.success !== "boolean" || typeof run.outcomeVerified !== "boolean"
      || run.success && (!run.outcomeVerified || run.constraintViolations !== 0)
      || !Number.isInteger(run.constraintViolations) || run.constraintViolations < 0
      || !Number.isInteger(run.publicMessageCount) || run.publicMessageCount < 0
      || !Number.isInteger(run.episodeCount) || run.episodeCount < 0 || !run.termination
      || !Array.isArray(run.sourceFiles) || !run.sourceFiles.length || run.sourceFiles.some(file => !files.has(fileKey(file)))) throw new Error("Invalid or contaminated memory run");
    runMap.set(run.id, run);
  }
  const episodeMap = new Map<string, MemoryEpisode>();
  const decisions = new Set<string>();
  for (const episode of artifact.episodes) {
    const run = runMap.get(episode.runId), decision = canonical([episode.runId, episode.boundary]);
    if (!run || !episode.id || episodeMap.has(episode.id) || decisions.has(decision)
      || !sameScope(episode.scope, run.scope) || !Number.isInteger(episode.boundary) || episode.boundary < 0
      || !Array.isArray(episode.prefix) || hash(episode.prefix) !== episode.prefixHash
      || !Array.isArray(episode.nextActions) || !Array.isArray(episode.resultingObservations)
      || !Array.isArray(episode.argumentSources) || !Array.isArray(episode.requirements)
      || episode.requirements.some(value => typeof value !== "string") || !episode.lesson) throw new Error("Invalid memory episode");
    const indices = new Set<number>();
    for (const message of episode.prefix) {
      if (!Number.isInteger(message.index) || message.index < 0 || message.index >= run.publicMessageCount || indices.has(message.index)
        || !["user", "assistant", "tool"].includes(message.role) || !Array.isArray(message.calls)
        || message.content !== null && typeof message.content !== "string"
        || Object.keys(message).some(key => !["index", "role", "content", "calls", "callId", "observation"].includes(key))) throw new Error("Invalid memory public prefix");
      indices.add(message.index);
    }
    if (episode.prefix.some((message, index) => message.index !== index)
      || episode.prefix.length >= run.publicMessageCount
      || episode.previousTool !== (episode.prefix.flatMap(message => message.calls).at(-1)?.tool ?? "__start__")
      || canonical(episode.requirements) !== canonical(episode.prefix.filter(message => message.role === "user").map(message => message.content ?? ""))) throw new Error("Memory prefix is not a complete visible checkpoint");
    for (const source of episode.argumentSources) {
      if (!episode.nextActions.some(action => action.id === source.actionId) || source.sources.some(ref => !indices.has(ref.messageIndex))) throw new Error("Memory argument source is outside visible prefix");
    }
    for (const action of episode.nextActions) if (!action.id || !action.tool || !action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) throw new Error("Invalid memory action");
    episodeMap.set(episode.id, episode); decisions.add(decision);
  }
  for (const run of artifact.runs) if (artifact.episodes.filter(episode => episode.runId === run.id).length !== run.episodeCount) throw new Error("Memory run episode coverage mismatch");
  const missIds = new Set<string>();
  for (const miss of artifact.misses) {
    const episode = episodeMap.get(miss.episodeId);
    if (!episode || !miss.id || missIds.has(miss.id) || !digest(miss.eventHash)
      || !files.has(fileKey(miss.source)) || !Number.isInteger(miss.eventSequence) || miss.eventSequence < 0
      || canonical(miss.actual) !== canonical(episode.nextActions.map(({ tool, arguments: args }) => ({ tool, arguments: args })))
      || miss.toolMatch !== miss.actual.some(action => action.tool === miss.predicted.tool)
      || miss.fullMatch !== miss.actual.some(action => canonical(action) === canonical(miss.predicted))
      || typeof miss.beforeActorResponse !== "boolean" || typeof miss.admitted !== "boolean") throw new Error("Invalid memory prediction verification");
    missIds.add(miss.id);
  }
  const statistics = memoryStatistics(artifact);
  if (canonical(statistics.transitions) !== canonical(artifact.transitions) || canonical(statistics.confusions) !== canonical(artifact.confusions)) throw new Error("Memory statistics do not match evidence");
  deepFreeze(artifact); validated.add(artifact);
  return artifact;
}

function bounded(text: string, limit: number) { return Array.from(text).slice(0, limit).join(""); }
function terms(text: string) {
  return new Set(text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}_]{3,}/gu) ?? []);
}
function previousTool(frame: ExecutionFrame) {
  const events = frame.sources._binding_events;
  if (!Array.isArray(events)) return "__start__";
  for (const event of [...events].reverse()) if (event && typeof event === "object" && !Array.isArray(event)
    && event.kind === "tool_request" && typeof event.tool === "string") return event.tool;
  return "__start__";
}

/** Public decision state, never hidden evaluator labels or a historical outcome. */
export function memoryQuery(frame: ExecutionFrame): string {
  const requirements = Object.entries(frame.sources).filter(([key]) => key.startsWith("requirement:"))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([, value]) => value).slice(-4);
  const observations = Object.entries(frame.sources).filter(([key]) => key.startsWith("observation:") || key.startsWith("tool:"))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([, value]) => value).slice(-2);
  const events = Array.isArray(frame.sources._binding_events) ? frame.sources._binding_events.slice(-4) : [];
  return canonical({ objective: bounded(frame.requestedObjective, 1200), requirements: bounded(canonical(requirements), 5000),
    recentEvents: bounded(canonical(events), 6000), recentObservations: bounded(canonical(observations), 4000) });
}

/** Predictor-only hints. Historical values cannot authorize or bind a current invocation. */
export function retrieveMemory(frame: ExecutionFrame, query: string, input: FrozenExperienceMemory,
  options: { maxEpisodes?: number; maxChars?: number } = {}): MemoryRetrieval {
  const artifact = validateMemoryArtifact(input);
  const result: MemoryRetrieval = { queryHash: hash(query), artifactHash: artifact.contentHash, episodeIds: [], hints: [], transitions: [], confusions: [] };
  if (frame.snapshotId !== artifact.repositorySnapshotId || artifact.runs.some(run => run.id === frame.runId)) return result;
  let index = indexes.get(artifact);
  if (!index) {
    index = { runs: new Map(artifact.runs.map(run => [run.id, run])), terms: new Map(artifact.episodes.map(episode =>
      [episode.id, terms(canonical({ requirements: episode.requirements, context: episode.prefix.slice(-4), previousTool: episode.previousTool }))])) };
    indexes.set(artifact, index);
  }
  const queryTerms = terms(query), current = previousTool(frame);
  const count = Math.max(0, Math.min(6, Math.floor(options.maxEpisodes ?? 3)));
  let remaining = Math.max(0, Math.min(16000, Math.floor(options.maxChars ?? 5000)));
  const add = (hint: unknown) => {
    const text = canonical(hint);
    if (text.length > remaining) return false;
    result.hints.push(text); remaining -= text.length; return true;
  };
  const transitions = artifact.transitions.filter(row => sameScope(row.scope, frame.scope) && row.from === current)
    .sort((a, b) => b.confidence - a.confidence || a.to.localeCompare(b.to)).slice(0, 3);
  if (transitions.length && add({ historicalTransitions: transitions.map(row => ({ from: row.from, to: row.to,
    successes: row.successes, failures: row.failures, confidence: row.confidence, successRate: row.successRate, argumentKeys: row.argumentSignatures })) })) result.transitions = copy(transitions);
  const confusions = artifact.confusions.filter(row => sameScope(row.scope, frame.scope) && row.previousTool === current && row.count >= 3)
    .sort((a, b) => b.count - a.count || a.predictedTool.localeCompare(b.predictedTool)).slice(0, 3);
  if (confusions.length && add({ recurringConfusions: confusions.map(row => ({ predicted: row.predictedTool,
    actual: row.actualTool, count: row.count })), advice: "Recheck the current request before repeating these predictions. Historical errors do not prohibit a valid current action." })) result.confusions = copy(confusions);
  const ranked = artifact.episodes.filter(episode => episode.runId !== frame.runId && sameScope(episode.scope, frame.scope))
    .map(episode => { const words = index!.terms.get(episode.id)!;
      return { episode, score: (episode.previousTool === current ? 2 : 0)
        + [...queryTerms].filter(term => words.has(term)).length / Math.max(1, Math.sqrt(queryTerms.size * words.size)) }; })
    .sort((a, b) => b.score - a.score || a.episode.id.localeCompare(b.episode.id));
  const seen = new Set<string>();
  for (const { episode } of ranked) {
    if (result.episodeIds.length >= count) break;
    const run = index.runs.get(episode.runId)!;
    // Avoid repeated-arm duplicates consuming every example slot.
    const key = canonical([run.familyId, episode.previousTool, episode.nextActions.map(action => action.tool), run.success]);
    if (seen.has(key)) continue;
    const misses = artifact.misses.filter(miss => miss.episodeId === episode.id && !miss.fullMatch && miss.beforeActorResponse).slice(0, 2);
    const hint = { historicalEpisode: episode.id, historicalValuesAreNotCurrentEvidence: true,
      outcome: run.success ? "verified_success" : "failure", lesson: episode.lesson,
      requirements: bounded(episode.requirements.slice(-2).join("\n"), 600), previousTool: episode.previousTool,
      context: episode.prefix.slice(-3).map(message => ({ role: message.role, content: bounded(message.content ?? "", 350),
        calls: message.calls.map(({ tool, arguments: args }) => ({ tool, arguments: bounded(canonical(args), 250) })) })),
      nextActions: episode.nextActions.map(({ tool, arguments: args }) => ({ tool, historicalArguments: bounded(canonical(args), 400) })),
      nextMessage: episode.nextMessage === null ? null : bounded(episode.nextMessage, 250),
      argumentSources: episode.argumentSources.slice(0, 8),
      misses: misses.map(miss => ({ predicted: miss.predicted.tool, actual: miss.actual.map(action => action.tool) })) };
    if (add(hint)) { seen.add(key); result.episodeIds.push(episode.id); }
  }
  return result;
}

export interface ContextualMemoryRetrieval {
  version: "goalspec-contextual-memory-v5";
  queryHash: string; artifactHash: string; historicalValuesAreNotCurrentBindings: true;
  episodes: { episode: MemoryEpisode; run: MemoryRun; misses: MemoryMiss[]; similarity: number }[];
  transitions: MemoryTransition[]; confusions: MemoryConfusion[];
  omittedEpisodes: number; serializedCharacters: number;
}
const contextualIndexes = new WeakMap<FrozenExperienceMemory, Map<string, {
  runs: Map<string, MemoryRun>; episodes: MemoryEpisode[]; misses: MemoryMiss[];
  statistics: ReturnType<typeof memoryStatistics>; words: Map<string, Set<string>>;
}>>();

/** Complete historical observations and provenance, bounded by dropping whole
 * episodes. Statistics obey the same family/run exclusion as episode retrieval. */
export function retrieveContextualMemory(frame: ExecutionFrame, query: string, input: FrozenExperienceMemory,
  options: { maxEpisodes?: number; maxChars?: number; excludeFamilies?: string[]; allowedFamilies?: string[] } = {}): ContextualMemoryRetrieval {
  const artifact = validateMemoryArtifact(input);
  const result: ContextualMemoryRetrieval = { version: "goalspec-contextual-memory-v5", queryHash: hash(query),
    artifactHash: artifact.contentHash, historicalValuesAreNotCurrentBindings: true, episodes: [], transitions: [], confusions: [], omittedEpisodes: 0, serializedCharacters: 0 };
  if (frame.snapshotId !== artifact.repositorySnapshotId) return result;
  const excluded = new Set(options.excludeFamilies ?? []), allowed = options.allowedFamilies && new Set(options.allowedFamilies);
  let cache = contextualIndexes.get(artifact);
  if (!cache) { cache = new Map(); contextualIndexes.set(artifact, cache); }
  const cacheKey = hash([frame.scope, artifact.runs.some(run => run.id === frame.runId) ? frame.runId : null,
    [...excluded].sort(), allowed ? [...allowed].sort() : null]);
  let index = cache.get(cacheKey);
  if (!index) {
    const runs = artifact.runs.filter(run => run.id !== frame.runId && sameScope(run.scope, frame.scope)
      && !excluded.has(run.familyId) && (!allowed || allowed.has(run.familyId)));
    const byRun = new Map(runs.map(run => [run.id, run]));
    const episodes = artifact.episodes.filter(episode => byRun.has(episode.runId));
    const ids = new Set(episodes.map(episode => episode.id));
    const misses = artifact.misses.filter(miss => ids.has(miss.episodeId));
    index = { runs: byRun, episodes, misses, statistics: memoryStatistics({ ...artifact, runs, episodes, misses }),
      words: new Map(episodes.map(episode => [episode.id, terms(canonical({ requirements: episode.requirements, prefix: episode.prefix }))])) };
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, index);
  }
  const { runs: byRun, episodes, misses, statistics } = index;
  const previous = previousTool(frame), words = terms(query);
  result.transitions = copy(statistics.transitions.filter(row => row.from === previous));
  result.confusions = copy(statistics.confusions.filter(row => row.previousTool === previous));
  const count = Math.max(0, Math.min(8, Math.floor(options.maxEpisodes ?? 4)));
  const budget = Math.max(0, Math.min(131072, Math.floor(options.maxChars ?? 49152)));
  const ranked = episodes.map(episode => {
    const episodeWords = index!.words.get(episode.id)!;
    return { episode, run: byRun.get(episode.runId)!, misses: misses.filter(miss => miss.episodeId === episode.id),
      similarity: [...words].filter(word => episodeWords.has(word)).length / Math.max(1, Math.sqrt(words.size * episodeWords.size)) };
  }).sort((a, b) => b.similarity - a.similarity || a.episode.id.localeCompare(b.episode.id));
  let used = canonical({ transitions: result.transitions, confusions: result.confusions }).length;
  // A small budget must not accidentally leak arbitrarily large statistics.
  while (used > budget && (result.transitions.length || result.confusions.length)) {
    if (result.confusions.length) result.confusions.pop(); else result.transitions.pop();
    used = canonical({ transitions: result.transitions, confusions: result.confusions }).length;
  }
  const signatures = new Set<string>();
  for (const item of ranked) {
    const signature = hash([item.run.familyId, item.episode.prefixHash, item.episode.nextActions.map(action => action.tool)]);
    const size = canonical(item).length;
    if (result.episodes.length >= count || used + size > budget || signatures.has(signature)) continue;
    result.episodes.push(copy(item)); signatures.add(signature); used += size;
  }
  result.omittedEpisodes = ranked.length - result.episodes.length;
  result.serializedCharacters = used;
  return result;
}
