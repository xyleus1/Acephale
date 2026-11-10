import { readFile, writeFile, mkdir, appendFile, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { hash, copy, canonical } from "../src/lib/acephale/canonical";
import type { Candidate, ExecutionFrame, Json, GoalSet } from "../src/lib/acephale/contracts/generated";
import { validateContract } from "../src/lib/acephale/contracts/validate";
import { predictorModelIdentity, resolvePredictorProfile, type PredictorProfile } from "../src/lib/acephale/predictor-artifact";
import { LocalChatModelPort } from "../src/lib/acephale/infra-model";
import { LEXICAL_MEMORY_RETRIEVAL_HASH, validateMemoryArtifact } from "../src/lib/acephale/experience-memory";
import { createInfraNativeCandidates } from "../services/acephale-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/acephale-runtime/infra-compiler-identity";
import { InfraLocalPredictors, predictorContractHash } from "../services/acephale-runtime/infra-predictors";
import { NativeReadPolicy } from "../services/acephale-runtime/native-read-policy";
import { validateFreshInfraMemoryBinding, verifyInfraPilotBundle } from "./acephale-infra-memory";
import { documentPublicInput, verifyDocumentBundle } from "./acephale-infra-document-data";
import { documentFrame } from "../services/acephale-runtime/infra-document-runner";
import { DOCUMENT_TOOLS, documentCandidates } from "../services/acephale-runtime/document-adapter";
import type { PublicBoundary } from "../services/acephale-runtime/actor";
import { createInfraMemoryServices, loadFrozenEpisodeEmbeddings } from "../services/acephale-runtime/infra-memory-services";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { validateInfraLedgerCheckpoint } from "../services/acephale-runtime/infra-hosted-workers";
import type { EpisodicRetrievalPort } from "../src/lib/acephale/episodic-retrieval";

export interface PublicRow {
  checkpoint_id: string; input_hash: string; episode_id: string; family_id: string; split: string; domain: string; through_seq: number;
  environment_version: string; tool_schema_hash: string; runtime_tool_schema_hash?: string;
  checkpoint_number?: number;
  document_boundary?: PublicBoundary;
  scope: { tenant_id: string; principal_id: string; authorization_revision: string };
  input: { policy: string; sources: { id: string; kind: string; value: Json }[];
    events: { kind: string; seq: number; role?: string; content?: string; tool?: string; status?: string; [key: string]: unknown }[];
    tools: { name: string; parameters: Record<string, unknown> }[] };
}
/** Round-robin family partitions so a bounded replay includes development rows. */
export function selectInfraReplayRows<T extends { split: string; family_id: string; checkpoint_id: string }>(rows: T[], limit: number, partition: "calibration" | "test" = "calibration"): T[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid replay bound");
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    if (!["train", "development", "test"].includes(row.split)) throw new Error("Unknown replay partition");
    if (partition === "test" ? row.split !== "test" : row.split === "test") continue;
    const key = `${row.split}:${row.family_id}`;
    const bucket = buckets.get(key) ?? []; bucket.push(row); buckets.set(key, bucket);
  }
  const groups = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => bucket);
  const selected: T[] = [];
  for (let index = 0; selected.length < limit && groups.some(group => index < group.length); index++) {
    for (const group of groups) if (index < group.length && selected.length < limit) selected.push(group[index]);
  }
  return selected;
}
/** Freeze the common scoring panel before either condition sees inferred goals. */
export function selectInfraCandidatePanel<T extends { id: string }>(candidates: T[]): T[] {
  if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) throw new Error("Duplicate candidate panel identity");
  return copy(candidates.slice(0, 3));
}
/** Both ranking conditions observe one completed retrieval result, including fallback. */
export function freezeInfraReplayRetrieval(retrieve: EpisodicRetrievalPort): EpisodicRetrievalPort {
  let identity: string | undefined, result: ReturnType<EpisodicRetrievalPort> | undefined;
  return async (frame, signal) => {
    signal.throwIfAborted();
    const current = hash(frame);
    if (identity !== undefined && current !== identity) throw new Error("Frozen replay retrieval cannot cross checkpoint identities");
    identity = current;
    result ??= retrieve(frame, signal);
    const memory = await result;
    signal.throwIfAborted();
    return copy(memory);
  };
}
export function publicInfraFrame(row: PublicRow, snapshotId: string): ExecutionFrame {
  if (row.domain === "documents") {
    if (hash(row.input) !== row.input_hash || !["train", "development", "test"].includes(row.split) || !row.document_boundary
      || !Number.isSafeInteger(row.checkpoint_number) || row.checkpoint_number! < 0
      || hash(row.document_boundary.tools) !== hash(DOCUMENT_TOOLS) || row.runtime_tool_schema_hash !== hash(DOCUMENT_TOOLS)) throw new Error("Invalid document replay provenance");
    const frame = documentFrame(row.document_boundary, `replay:${row.episode_id}`, row.checkpoint_number!, {
      tenantId: row.scope.tenant_id, principalId: row.scope.principal_id, authorizationVersion: row.scope.authorization_revision,
      environmentVersion: row.environment_version, toolSchemaHash: row.runtime_tool_schema_hash }, snapshotId);
    if (hash(documentPublicInput(row.document_boundary, frame)) !== row.input_hash) throw new Error("Document replay prefix differs from declared public input");
    validateContract("ExecutionFrame", frame); return frame;
  }
  if (hash(row.input) !== row.input_hash || !["train", "development", "test"].includes(row.split)
    || row.runtime_tool_schema_hash !== undefined && !/^[a-f0-9]{64}$/.test(row.runtime_tool_schema_hash)
    || !["retail", "airline"].includes(row.domain) || !Array.isArray(row.input.sources) || row.input.events.some(event => event.seq > row.through_seq)) throw new Error("Invalid public checkpoint provenance");
  const sources: Record<string, Json> = Object.fromEntries(row.input.sources.map(source => [source.id, copy(source.value)]));
  const requirements = row.input.events.filter(event => event.kind === "message" && event.role === "user" && typeof event.content === "string");
  for (const event of requirements) {
    const id = `requirement:${event.seq}`;
    if (Object.hasOwn(sources, id) && sources[id] !== event.content) throw new Error("Conflicting public requirement provenance");
    sources[id] = event.content!;
  }
  sources._binding_events = copy(row.input.events.filter(event => ["tool_request", "tool_result"].includes(event.kind))) as Json;
  sources._signatures = row.input.events.filter(event => event.kind === "tool_result").map(event => `${event.tool}:${event.status}`);
  const frame: ExecutionFrame = { schemaVersion: 1, runId: `replay:${row.episode_id}`, boundary: row.through_seq + 1,
    scope: { tenantId: row.scope.tenant_id, principalId: row.scope.principal_id, authorizationVersion: row.scope.authorization_revision,
      environmentVersion: row.environment_version, toolSchemaHash: row.runtime_tool_schema_hash ?? row.tool_schema_hash }, snapshotId,
    requestedObjective: requirements.map(event => event.content).join("\n") || "No requested objective is visible at this checkpoint.",
    policy: row.input.policy, sources, goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
  validateContract("ExecutionFrame", frame); return frame;
}
export interface InfraPredictionEpisodicConfig { embeddingsPath: string; budgetDirectory: string; ledgerCheckpointPath: string }
/** Preserve failed requests as well as successful compilation and dispatch evidence. */
export function sealInfraReplayAudit(events: Record<string, unknown>[], rowWallMs: number) {
  if (!Number.isFinite(rowWallMs) || rowWallMs < 0) throw new Error("Invalid replay wall time");
  const body = { version: 1, events: copy(events), rowWallMs };
  return { ...body, contentHash: hash(body) };
}
export async function runInfraPrediction(input: { bundle: string; memory: string; output: string; baseUrl: string; limit: number; inferGoals: boolean; fixedPanel?: boolean; partition?: "calibration" | "test"; episodic?: InfraPredictionEpisodicConfig; predictor?: PredictorProfile }) {
  const inventory = JSON.parse(await readFile(join(input.bundle, "manifest.json"), "utf8"));
  const documents = !!inventory.files?.["document-lineage.json"];
  const pilot = documents ? verifyDocumentBundle(input.bundle) : verifyInfraPilotBundle(input.bundle);
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error("Invalid replay bound");
  const memory = validateMemoryArtifact(JSON.parse(await readFile(input.memory, "utf8")));
  if (!documents && pilot.lineage.fresh_qwen_traces === true) validateFreshInfraMemoryBinding(memory, pilot as ReturnType<typeof verifyInfraPilotBundle>);
  const rows = selectInfraReplayRows((await readFile(join(input.bundle, "public.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as PublicRow), input.limit, input.partition);
  if (!rows.length) throw new Error("No public checkpoints in the declared replay partition");
  if (input.partition === "test" && !input.fixedPanel) throw new Error("Held-out scoring requires the fixed common panel protocol");
  const output = resolve(input.output); await mkdir(output, { recursive: false });
  if (documents && memory.repositorySnapshotId !== `infra-documents:${pilot.manifest.bundle_hash}`) throw new Error("Document memory belongs to another dataset");
  const candidateCompilerHash = infraCandidateCompilerHash(documents ? "documents" : "native");
  const profile = resolvePredictorProfile(input.predictor);
  const modelIdentity = predictorModelIdentity(input.predictor);
  let rowEvents: Record<string, unknown>[] = [];
  const record = (event: Record<string, unknown>) => rowEvents.push(copy(event));
  const model = new LocalChatModelPort({ baseUrl: input.baseUrl, model: profile.trainedPredictor?.servedModel ?? modelIdentity.repository, contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024, record });
  let budget: DurableBudget | undefined, memoryServices: ReturnType<typeof createInfraMemoryServices> | undefined;
  let episodicLineage: Record<string, string> | null = null;
  const retrievalEvents: Record<string, unknown>[] = [];
  try {
  if (input.episodic) {
    if (!process.env.ACEPHALE_RESEARCH_DATABASE_URL) throw new Error("Episodic replay requires the dedicated research database");
    const ledgerPath = resolve(input.episodic.budgetDirectory, "budget.jsonl"), metadata = await stat(ledgerPath);
    if (!metadata.isFile() || metadata.size === 0) throw new Error("Original nonempty budget journal required");
    budget = new DurableBudget(ledgerPath);
    const checkpoint = JSON.parse(await readFile(input.episodic.ledgerCheckpointPath, "utf8"));
    validateInfraLedgerCheckpoint(checkpoint, budget.ledger, ledgerPath);
    const embeddings = await loadFrozenEpisodeEmbeddings(input.episodic.embeddingsPath, memory);
    memoryServices = createInfraMemoryServices({ memory, embeddings, databaseUrl: process.env.ACEPHALE_RESEARCH_DATABASE_URL,
       budget: budget.ledger, allocation: "replay", allowedFamilies: pilot.expected,
      record: event => retrievalEvents.push(event) });
    episodicLineage = { embeddingsHash: embeddings.contentHash, ledgerCheckpointHash: hash(checkpoint), budgetPathHash: hash(ledgerPath) };
  }
  const lineage = { version: 2, kind: "uncalibrated_prediction_replay", model: modelIdentity, memoryHash: memory.contentHash,
    probabilitySemantics: "independent_next_batch_hit", predictionMode: input.fixedPanel ? "fixed_panel" : "selected_candidates",
    panelSelection: input.fixedPanel ? "first_three_common_compiler_candidates_before_goal_inference_v1" : null,
    partition: input.partition ?? "calibration", compilerAuditVersion: 1,
    predictionProtocol: profile.protocol, binaryTokenIds: profile.binaryTokenIds ?? null,
    serving: { contextWindow: 8192, inputBudget: 7168, outputCap: 1024, temperature: 0, topP: 1, seed: 0, stream: true, enableThinking: false },
    predictorContractHash: predictorContractHash(input.predictor), candidateCompilerHash,
    retrievalHash: memoryServices?.profileHash ?? LEXICAL_MEMORY_RETRIEVAL_HASH, episodic: episodicLineage,
    sourceDatasetHash: pilot.manifest.bundle_hash, limit: input.limit, selection: "family-partition-round-robin-v1", inferGoals: input.inferGoals, rowIds: rows.map(row => row.checkpoint_id), executionAllowed: false };
  await writeFile(join(output, "manifest.json"), canonical({ ...lineage, contentHash: hash(lineage) }) + "\n", { flag: "wx" });
  let completed = 0;
  const lifetime = AbortSignal.timeout(2 * 3600 * 1000);
  for (const row of rows) {
    rowEvents = [];
    const rowStarted = performance.now();
    const audit = () => sealInfraReplayAudit(rowEvents, performance.now() - rowStarted);
    const expiredBeforeRow = lifetime.aborted;
    let candidates: Candidate[] | undefined;
    try {
    const frame = publicInfraFrame(row, memory.repositorySnapshotId), tools = Object.fromEntries(row.input.tools.map(tool => [tool.name, tool.parameters]));
    const reads = documents ? null : new NativeReadPolicy(row.domain as "retail" | "airline", frame.scope); reads?.updateFrame(frame);
    const universe = documents ? documentCandidates(frame) : createInfraNativeCandidates(memory, tools, invocation => reads!.eligible(invocation), { excludeFamilies: [row.family_id], allowedFamilies: pilot.expected }).candidates(frame);
    candidates = input.fixedPanel ? selectInfraCandidatePanel(universe) : universe;
    lifetime.throwIfAborted();
    const retrieval = memoryServices?.perRun(`prediction:${row.checkpoint_id}`, "neutral_memory_prefetch", row.family_id);
    const predictor = new InfraLocalPredictors(model, { ...input.predictor, memory, allowedFamilies: pilot.expected, excludeFamilies: [row.family_id], record,
      ...(retrieval ? { retrieveMemory: freezeInfraReplayRetrieval(retrieval.retrieve), retrievalProfileHash: retrieval.profileHash } : {}) });
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(120000)]);
      const goals: GoalSet = input.inferGoals ? await predictor.inferGoals(frame, signal) : frame.goals;
      const rank = input.fixedPanel ? predictor.rawRankPanel.bind(predictor) : predictor.rawRank.bind(predictor);
      const neutral = await rank(frame, candidates, frame.goals, signal);
      const conditional = input.inferGoals ? await rank(frame, candidates, goals, signal) : null;
      await appendFile(join(output, "predictions.jsonl"), canonical({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, family_id: row.family_id,
        split: row.split, candidates, orderedCandidatePoolHash: hash(candidates), ...(input.fixedPanel ? { candidatePanel: candidates.map(candidate => candidate.id), panelHash: hash(candidates.map(candidate => candidate.id).sort()) } : {}),
        goals, neutral, conditional, status: "completed", audit: audit() }) + "\n"); completed++;
    } catch (error) {
      await appendFile(join(output, "predictions.jsonl"), canonical({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash, family_id: row.family_id,
        split: row.split, ...(candidates ? { candidates, orderedCandidatePoolHash: hash(candidates), ...(input.fixedPanel ? {
          candidatePanel: candidates.map(candidate => candidate.id), panelHash: hash(candidates.map(candidate => candidate.id).sort()) } : {}) } : {}),
        status: expiredBeforeRow ? "not_dispatched" : "failed", errorType: error instanceof Error ? error.name : "Error", audit: audit() }) + "\n");
    }
  }
  await memoryServices?.drain();
  await writeFile(join(output, "retrieval-events.jsonl"), retrievalEvents.map(event => canonical(event) + "\n").join(""), { flag: "wx", mode: 0o600 });
  const receipt = { declared: rows.length, completed, failed: rows.length - completed, liveActorExecuted: false, toolExecutionPerformed: false };
  await writeFile(join(output, "receipt.json"), canonical(receipt) + "\n", { flag: "wx" }); return receipt;
  } finally {
    try { await memoryServices?.close(); } finally { budget?.close(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [bundle, memory, output, baseUrl, limit = "100", condition = "neutral", mode = "selected_candidates", partition = "calibration", episodicConfig, predictorConfig] = process.argv.slice(2);
  if (!bundle || !memory || !output || !baseUrl || !["neutral", "goals"].includes(condition) || !["selected_candidates", "fixed_panel"].includes(mode) || !["calibration", "test"].includes(partition)) throw new Error("Usage: acephale-infra-predict.ts BUNDLE MEMORY OUTPUT LOCAL_MODEL_URL [LIMIT] [neutral|goals] [selected_candidates|fixed_panel] [calibration|test] [EPISODIC_CONFIG_JSON_OR_-] [PREDICTOR_PROFILE_JSON]");
  const run = async () => {
    let episodic: InfraPredictionEpisodicConfig | undefined;
    if (episodicConfig && episodicConfig !== "-") {
      const configuration = JSON.parse(await readFile(episodicConfig, "utf8"));
      if (hash(Object.keys(configuration).sort()) !== hash(["budgetDirectory", "embeddingsPath", "ledgerCheckpointPath"])
        || Object.values(configuration).some(value => typeof value !== "string" || !value)) throw new Error("Episodic replay config requires only artifact and original-journal paths");
      const base = dirname(resolve(episodicConfig));
      episodic = { embeddingsPath: resolve(base, configuration.embeddingsPath), budgetDirectory: resolve(base, configuration.budgetDirectory), ledgerCheckpointPath: resolve(base, configuration.ledgerCheckpointPath) };
    }
    return runInfraPrediction({ bundle, memory, output, baseUrl, limit: Number(limit), inferGoals: condition === "goals", fixedPanel: mode === "fixed_panel", partition: partition as "calibration" | "test", episodic,
      predictor: predictorConfig ? JSON.parse(await readFile(predictorConfig, "utf8")) : undefined });
  };
  run().then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error instanceof Error ? error.message : "Prediction replay failed"); process.exitCode = 1; });
}
