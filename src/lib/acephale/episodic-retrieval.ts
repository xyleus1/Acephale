import { canonical, copy, hash } from "./canonical";
import type { ExecutionFrame } from "./contracts/generated";
import { compatibleMemoryRuns, memoryQuery, retrieveContextualMemory, validateMemoryArtifact,
  type ContextualMemoryRetrieval, type FrozenExperienceMemory, type MemoryEpisode } from "./experience-memory";

export const EPISODIC_RETRIEVAL_CONTRACT = {
  version: "acephale-episodic-retrieval-v1", projection: "public-prefix-last-six-v1", maxProjectionCodepoints: 1900,
  model: "text-embedding-3-small", dimensions: 1536, perChannel: 32, rrfConstant: 60,
  maxExamples: 4, maxNegativeExamples: 1, maxChars: 16000, timeoutMs: 100,
} as const;
export const EPISODIC_RETRIEVAL_HASH = hash(EPISODIC_RETRIEVAL_CONTRACT);
const validatedEmbeddings = new WeakSet<object>();
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value);
const bounded = (text: string) => Array.from(text).slice(0, EPISODIC_RETRIEVAL_CONTRACT.maxProjectionCodepoints).join("");
export class EpisodicIntegrityError extends Error {}
export type EpisodicRetrievalPort = (frame: ExecutionFrame, signal: AbortSignal) => Promise<ContextualMemoryRetrieval>;
export interface EpisodeEmbeddingRow {
  episodeId: string; episodeHash: string; text: string; textHash: string; vector: number[]; vectorHash: string;
}
export interface FrozenEpisodeEmbeddings {
  version: 1; snapshotId: string; memoryHash: string; model: "text-embedding-3-small"; modelVersion: string;
  dimensions: 1536; projectionHash: string; rows: EpisodeEmbeddingRow[]; contentHash: string;
}
export interface EpisodicSearchHit { episodeId: string; episodeHash: string; lexicalRank: number | null; denseRank: number | null }
export interface EpisodicSearchRequest {
  snapshotId: string; memoryHash: string; embeddingsHash: string; model: string; modelVersion: string;
  projectionHash: string; scopeHash: string; policyHash: string; allowedEpisodeIds: string[];
  allowedFamilies: string[]; excludedFamilies: string[]; excludedRunId: string;
  query: string; vector: number[]; timeoutMs: number;
}
export type EpisodicSearchPort = (request: EpisodicSearchRequest, signal: AbortSignal) => Promise<EpisodicSearchHit[]>;
export function episodicRetrievalProfileHash(embeddings: Pick<FrozenEpisodeEmbeddings, "contentHash">, timeoutMs = 100): string {
  if (!digest(embeddings.contentHash) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 100) throw new Error("Invalid retrieval profile");
  return hash({ contract: EPISODIC_RETRIEVAL_HASH, embeddingsHash: embeddings.contentHash, timeoutMs });
}

/** Only fields visible before the historical action are eligible for embedding. */
export function episodePrefixText(episode: MemoryEpisode): string {
  return bounded(canonical({ requirements: episode.requirements, previousTool: episode.previousTool,
    publicPrefix: episode.prefix.slice(-6) }));
}
export function normalizeEpisodeVector(value: number[]): number[] {
  if (!Array.isArray(value) || value.length !== 1536 || value.some(n => !Number.isFinite(n))) throw new EpisodicIntegrityError("Expected a finite 1536-dimensional vector");
  const magnitude = Math.sqrt(value.reduce((sum, n) => sum + n * n, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) throw new EpisodicIntegrityError("Embedding must be nonzero");
  if (Math.abs(magnitude - 1) <= 0.000001 && value.every(n => Math.fround(n) === n)) return [...value];
  return value.map(n => Math.fround(n / magnitude));
}
export function memoryRunHasKnownOutcome(run: FrozenExperienceMemory["runs"][number]): boolean {
  return run.split === "train" && run.outcomeVerified && run.verificationTier === "native_verified"
    && !/budget|censor|deadline|timeout|cancel|provider|transport|host|execution_error|not_started/i.test(run.termination);
}
export async function buildEpisodeEmbeddings(memoryInput: FrozenExperienceMemory, modelVersion: string,
  embed: (text: string, signal: AbortSignal) => Promise<number[]>, signal: AbortSignal): Promise<FrozenEpisodeEmbeddings> {
  const memory = validateMemoryArtifact(memoryInput);
  if (!modelVersion) throw new Error("Explicit embedding model version required");
  const runs = new Set(memory.runs.filter(memoryRunHasKnownOutcome).map(run => run.id));
  const rows: EpisodeEmbeddingRow[] = [];
  const vectors = new Map<string, number[]>();
  for (const episode of [...memory.episodes].filter(row => runs.has(row.runId)).sort((a, b) => a.id.localeCompare(b.id))) {
    signal.throwIfAborted();
    const text = episodePrefixText(episode), textHash = hash(text);
    let vector = vectors.get(textHash);
    if (!vector) { vector = normalizeEpisodeVector(await embed(text, signal)); signal.throwIfAborted(); vectors.set(textHash, vector); }
    rows.push({ episodeId: episode.id, episodeHash: hash(episode), text, textHash, vector: [...vector], vectorHash: hash(vector) });
  }
  const body = { version: 1 as const, snapshotId: memory.repositorySnapshotId, memoryHash: memory.contentHash,
    model: EPISODIC_RETRIEVAL_CONTRACT.model, modelVersion, dimensions: EPISODIC_RETRIEVAL_CONTRACT.dimensions,
    projectionHash: EPISODIC_RETRIEVAL_HASH, rows };
  return validateEpisodeEmbeddings({ ...body, contentHash: hash(body) }, memory);
}
export function validateEpisodeEmbeddings(input: FrozenEpisodeEmbeddings, memoryInput: FrozenExperienceMemory): FrozenEpisodeEmbeddings {
  const memory = validateMemoryArtifact(memoryInput);
  if (input && validatedEmbeddings.has(input) && input.memoryHash === memory.contentHash && input.snapshotId === memory.repositorySnapshotId) return input;
  const artifact = copy(input);
  const { contentHash, ...body } = artifact;
  if (artifact.version !== 1 || artifact.snapshotId !== memory.repositorySnapshotId || artifact.memoryHash !== memory.contentHash
    || artifact.model !== EPISODIC_RETRIEVAL_CONTRACT.model || artifact.dimensions !== 1536 || !artifact.modelVersion
    || artifact.projectionHash !== EPISODIC_RETRIEVAL_HASH || !digest(contentHash) || hash(body) !== contentHash
    || !Array.isArray(artifact.rows)) throw new EpisodicIntegrityError("Frozen embedding artifact identity mismatch");
  const runs = new Set(memory.runs.filter(memoryRunHasKnownOutcome).map(run => run.id));
  const expected = new Map(memory.episodes.filter(row => runs.has(row.runId)).map(row => [row.id, row]));
  const seen = new Set<string>();
  for (const row of artifact.rows) {
    const episode = expected.get(row.episodeId);
    if (!episode || seen.has(row.episodeId) || hash(episode) !== row.episodeHash || row.text !== episodePrefixText(episode)
      || hash(row.text) !== row.textHash || hash(row.vector) !== row.vectorHash) throw new EpisodicIntegrityError("Embedding row has changed or non-prefix provenance");
    normalizeEpisodeVector(row.vector);
    const magnitude = Math.sqrt(row.vector.reduce((sum, n) => sum + n * n, 0));
    if (Math.abs(magnitude - 1) > 0.00001 || row.vector.some(n => Math.fround(n) !== n)) throw new EpisodicIntegrityError("Embedding is not normalized float32");
    seen.add(row.episodeId);
  }
  if (seen.size !== expected.size) throw new EpisodicIntegrityError("Frozen embedding cohort is incomplete");
  for (const row of artifact.rows) { Object.freeze(row.vector); Object.freeze(row); }
  Object.freeze(artifact.rows); Object.freeze(artifact); validatedEmbeddings.add(artifact); return artifact;
}
export function rankEpisodicHits(hits: EpisodicSearchHit[]): string[] {
  const seen = new Set<string>();
  const scored = hits.map(hit => {
    if (seen.has(hit.episodeId) || [hit.lexicalRank, hit.denseRank].some(rank => rank !== null && (!Number.isSafeInteger(rank) || rank < 1 || rank > 32))
      || hit.lexicalRank === null && hit.denseRank === null) throw new EpisodicIntegrityError("Invalid hybrid retrieval ranks");
    seen.add(hit.episodeId);
    return { id: hit.episodeId, score: (hit.lexicalRank === null ? 0 : 1 / (60 + hit.lexicalRank)) + (hit.denseRank === null ? 0 : 1 / (60 + hit.denseRank)) };
  });
  return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map(row => row.id);
}

/** Per-run cache. A timeout never delays the actor or mutates frozen memory. */
export function createEpisodicRetriever(options: {
  memory: FrozenExperienceMemory; embeddings: FrozenEpisodeEmbeddings; search: EpisodicSearchPort;
  embed: (text: string, signal: AbortSignal) => Promise<number[]>;
  allowedFamilies: string[]; excludeFamilies?: string[]; timeoutMs?: number;
  record?: (event: Record<string, unknown>) => void;
}) {
  const memory = validateMemoryArtifact(options.memory), embeddings = validateEpisodeEmbeddings(options.embeddings, memory);
  const byId = new Map(embeddings.rows.map(row => [row.episodeId, row]));
  const timeoutMs = options.timeoutMs ?? 100;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 100) throw new Error("Retrieval deadline must be at most 100ms");
  const families = [...new Set(options.allowedFamilies)].sort(), excluded = [...new Set(options.excludeFamilies ?? [])].sort();
  const profileHash = episodicRetrievalProfileHash(embeddings, timeoutMs);
  const cache = new Map<string, number[]>(), active = new Set<AbortController>();
  let closed = false;
  const retrieve: EpisodicRetrievalPort = async (frame, signal) => {
    signal.throwIfAborted(); if (closed) throw new Error("Retrieval closed");
    const started = performance.now(), query = bounded(memoryQuery(frame));
    const filters = { allowedFamilies: families, excludeFamilies: excluded, strictPolicy: true, verifiedOnly: true };
    const compatibleRuns = compatibleMemoryRuns(frame, memory, filters).filter(memoryRunHasKnownOutcome);
    const runIds = new Set(compatibleRuns.map(run => run.id));
    const eligible = memory.episodes.filter(episode => runIds.has(episode.runId) && byId.has(episode.id));
    const allowedIds = new Set(eligible.map(row => row.id));
    // Restrict statistics as well as example rows to known training outcomes.
    const allowed = compatibleRuns.map(run => run.familyId);
    const select = (ids: string[]) => {
      let negatives = 0;
      const positives = new Set(compatibleRuns.filter(run => run.success).map(run => run.id));
      const rows = new Map(eligible.map(row => [row.id, row]));
      return ids.filter(id => { const row = rows.get(id); if (!row) return false; return positives.has(row.runId) || negatives++ < 1; }).slice(0, 4);
    };
    const compile = (ids: string[]) => retrieveContextualMemory(frame, query, memory, { ...filters, allowedFamilies: allowed, allowedRunIds: [...runIds],
      maxEpisodes: 4, maxChars: 16000, rankedEpisodeIds: select(ids) });
    const lexical = retrieveContextualMemory(frame, query, memory, { ...filters, allowedFamilies: allowed, allowedRunIds: [...runIds], maxEpisodes: 8, maxChars: 131072 });
    const fallback = () => compile(lexical.episodes.map(row => row.episode.id));
    if (!eligible.length) return fallback();
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true }); active.add(controller);
    const key = hash({ model: embeddings.model, version: embeddings.modelVersion, projection: embeddings.projectionHash,
      scope: frame.scope, policy: frame.policy, query });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
    const cacheHit = cache.has(key);
    const operation = (async () => {
      let vector = cache.get(key);
      if (!vector) {
        vector = normalizeEpisodeVector(await options.embed(query, controller.signal)); controller.signal.throwIfAborted();
        if (closed) throw new Error("Retrieval closed");
        if (cache.size >= 256) cache.delete(cache.keys().next().value!);
        cache.set(key, vector);
      }
      const hits = await options.search({ snapshotId: frame.snapshotId, memoryHash: memory.contentHash, embeddingsHash: embeddings.contentHash,
        model: embeddings.model, modelVersion: embeddings.modelVersion, projectionHash: embeddings.projectionHash,
        scopeHash: hash(frame.scope), policyHash: hash(frame.policy), allowedEpisodeIds: [...allowedIds], allowedFamilies: families,
        excludedFamilies: excluded, excludedRunId: frame.runId, query, vector, timeoutMs }, controller.signal);
      controller.signal.throwIfAborted();
      if (hits.some(hit => !allowedIds.has(hit.episodeId) || byId.get(hit.episodeId)?.episodeHash !== hit.episodeHash)) throw new EpisodicIntegrityError("Search returned an incompatible episode");
      return compile(rankEpisodicHits(hits));
    })();
    try {
      const result = await Promise.race([operation, timeout]); signal.throwIfAborted(); if (closed) throw new Error("Retrieval closed");
      options.record?.({ type: "episodic_retrieval", runId: frame.runId, checkpoint: frame.boundary, profileHash,
        queryHash: hash(query), cacheHit, mode: result ? "hybrid" : "lexical_timeout", latencyMs: performance.now() - started });
      return result ?? fallback();
    } catch (error) {
      signal.throwIfAborted();
      if (closed) throw new Error("Retrieval closed");
      if (error instanceof EpisodicIntegrityError) throw error;
      options.record?.({ type: "episodic_retrieval", runId: frame.runId, checkpoint: frame.boundary, profileHash,
        mode: "lexical_unavailable", latencyMs: performance.now() - started });
      return fallback();
    } finally { if (timer) clearTimeout(timer); signal.removeEventListener("abort", abort); active.delete(controller); controller.abort(); }
  };
  return { retrieve, profileHash, close() { closed = true; active.forEach(controller => controller.abort()); cache.clear(); } };
}
