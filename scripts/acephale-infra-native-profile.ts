/** Native component measurements use a live Python snapshot gateway, never trace durations. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { validateInfraManifest } from "../src/lib/acephale/infra-manifest";
import { LocalChatModelPort } from "../src/lib/acephale/infra-model";
import { validateMemoryArtifact } from "../src/lib/acephale/experience-memory";
import { SpeculationScheduler, type ReadExecutor } from "../src/lib/acephale/scheduler";
import { NativeGateway, NativeReadExecutor } from "../services/acephale-runtime/gateway-client";
import { NativeReadPolicy } from "../services/acephale-runtime/native-read-policy";
import { createInfraNativeCandidates } from "../services/acephale-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/acephale-runtime/infra-compiler-identity";
import { infraOpportunityProfile, NATIVE_PROFILE_PROTOCOL } from "../services/acephale-runtime/infra-opportunity-profile";
import { createInfraMemoryServices, loadFrozenEpisodeEmbeddings } from "../services/acephale-runtime/infra-memory-services";
import { episodicRetrievalProfileHash } from "../src/lib/acephale/episodic-retrieval";
import { InfraLocalPredictors, predictorContractHash } from "../services/acephale-runtime/infra-predictors";
import { localActorDecision, localActorMessages } from "../services/acephale-runtime/local-actor";
import type { PublicBoundary } from "../services/acephale-runtime/actor";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { validateInfraLedgerCheckpoint } from "../services/acephale-runtime/infra-hosted-workers";
import { nativeSplitGuard } from "../services/acephale-runtime/infra-split-guard";
import { publicInfraFrame, selectInfraReplayRows } from "./acephale-infra-predict";
import { validateFreshInfraMemoryBinding, verifyInfraPilotBundle } from "./acephale-infra-memory";

export interface NativeProfileConfig {
  version: 1; datasetPath: string; cohortPath: string; memoryPath: string; manifestPath: string; ledgerCheckpointPath: string;
  budgetDirectory: string; actorBaseUrl: string; predictorBaseUrl: string; limit: number; seed: number; maximumLifetimeSeconds: number;
  otlpBaseUrl?: string; splitGuardPath?: string; episodicEmbeddingsPath?: string; stream?: boolean;
}
type Span = { clockId: string; startMs: number; endMs: number };
type Spans = Partial<Record<"actorLeadMs" | "predictionMs" | "toolMs" | "validationMs" | "schedulingMs", Span>>
  & { contentionMs?: { method: "paired_difference"; baseline: Span; concurrent: Span } };
const json = async <T = any>(file: string): Promise<T> => JSON.parse(await readFile(file, "utf8"));
const write = (file: string, value: unknown) => writeFile(file, canonical(value) + "\n", { flag: "wx", mode: 0o600 });
export { NATIVE_PROFILE_PROTOCOL };

/** Bind the original journal prefix while allowing later billed profiling entries. */
export async function nativeProfileJournalPrefix(ledgerPath: string, bytes?: number) {
  const metadata = await stat(ledgerPath), count = bytes ?? metadata.size;
  if (!metadata.isFile() || !Number.isSafeInteger(count) || count < 1 || count > metadata.size) throw new Error("Original budget journal prefix missing or truncated");
  const digest = createHash("sha256"); let read = 0;
  for await (const chunk of createReadStream(ledgerPath, { start: 0, end: count - 1 })) { digest.update(chunk); read += chunk.length; }
  if (read !== count) throw new Error("Original budget journal prefix changed during read");
  return { pathHash: hash(resolve(ledgerPath)), bytes: count, sha256: digest.digest("hex") };
}

async function inputs(configurationPath: string) {
  const config = await json<NativeProfileConfig>(configurationPath), base = dirname(resolve(configurationPath));
  const path = (file: string) => resolve(base, file);
  if (config.version !== 1 || !Number.isSafeInteger(config.limit) || config.limit < 1 || config.limit > 100
    || !Number.isSafeInteger(config.seed) || config.seed < 0 || !Number.isSafeInteger(config.maximumLifetimeSeconds)
    || config.maximumLifetimeSeconds < 1 || config.maximumLifetimeSeconds > 28800
    || config.stream !== undefined && typeof config.stream !== "boolean") throw new Error("Invalid bounded native profile configuration");
  const dataset = verifyInfraPilotBundle(path(config.datasetPath)), memory = validateMemoryArtifact(await json(path(config.memoryPath)));
  const manifest = await json(path(config.manifestPath)); validateInfraManifest(manifest);
  const checkpoint = await json(path(config.ledgerCheckpointPath));
  validateFreshInfraMemoryBinding(memory, dataset);
  if (dataset.lineage.fresh_qwen_traces !== true
    || manifest.data.datasetHash !== dataset.manifest.bundle_hash || manifest.data.memoryHash !== memory.contentHash
    || manifest.data.environmentRevision !== "2174a603f6d014ef94473ffa95957f6ce27100db"
    || hash(checkpoint) !== manifest.budgets.ledgerCheckpointHash || !manifest.seeds.includes(config.seed)) throw new Error("Native profile source or ledger identity mismatch");
  const partitions = dataset.split.declared_family_policy ?? dataset.split.families;
  for (const [key, split] of [["trainingFamilies", "train"], ["developmentFamilies", "development"], ["heldoutFamilies", "test"]] as const) {
    const expected = Object.entries(partitions).filter(([, value]) => value === split).map(([family]) => family).sort();
    if (canonical([...manifest.data[key]].sort()) !== canonical(expected)) throw new Error("Native profile changed the frozen family partitions");
  }
  // Constructors reject credential-bearing endpoints before any plan is persisted.
  for (const role of ["actor", "predictor"] as const) new LocalChatModelPort({ baseUrl: config[`${role}BaseUrl`], model: manifest[role].servedModel, stream: config.stream ?? true });
  nativeSplitGuard(config, manifest, resolve(configurationPath));
  const publicRows = (await readFile(join(path(config.datasetPath), "public.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return { config, path, dataset, memory, manifest, checkpoint, publicRows };
}

function poolFor(row: any, memory: ReturnType<typeof validateMemoryArtifact>, training: string[]) {
  const frame = publicInfraFrame(row, memory.repositorySnapshotId), policy = new NativeReadPolicy(row.domain, frame.scope);
  policy.updateFrame(frame);
  const tools = Object.fromEntries(row.input.tools.map((tool: any) => [tool.name, tool.parameters]));
  return { frame, policy, candidates: createInfraNativeCandidates(memory, tools, invocation => policy.eligible(invocation),
    { allowedFamilies: training, excludeFamilies: [row.family_id] }).candidates(frame) };
}

export async function prepareNativeProfile(configurationPath: string, output: string) {
  const data = await inputs(configurationPath), { config, path, dataset, memory, manifest, checkpoint, publicRows } = data;
  const ledgerPath = resolve(path(config.budgetDirectory), "budget.jsonl"), metadata = await stat(ledgerPath);
  if (!metadata.isFile() || metadata.size === 0) throw new Error("Original nonempty budget journal required");
  const budget = new DurableBudget(ledgerPath);
  let budgetJournalPrefix: Awaited<ReturnType<typeof nativeProfileJournalPrefix>>;
  try { validateInfraLedgerCheckpoint(checkpoint, budget.ledger, ledgerPath); budgetJournalPrefix = await nativeProfileJournalPrefix(ledgerPath); } finally { budget.close(); }
  const embeddings = config.episodicEmbeddingsPath ? await loadFrozenEpisodeEmbeddings(path(config.episodicEmbeddingsPath), memory) : undefined;
  if (embeddings && !process.env.ACEPHALE_RESEARCH_DATABASE_URL) throw new Error("Episodic profiling requires the dedicated research database");
  // Never consult next-action labels to select prefixes or candidate IDs.
  const selected = selectInfraReplayRows(publicRows.filter(row => row.split !== "test" && poolFor(row, memory, dataset.expected).candidates.length > 0), config.limit);
  if (!selected.length || selected.some(row => !(row.split === "train" ? manifest.data.trainingFamilies : manifest.data.developmentFamilies).includes(row.family_id))) throw new Error("No eligible declared train/development native prefixes");
  const body = { version: 2, kind: "native_component_profile", configuration: config, configurationHash: hash(config),
    profile: infraOpportunityProfile(manifest, "native", { stream: config.stream ?? true, retrievalHash: embeddings ? episodicRetrievalProfileHash(embeddings) : undefined }), budgetJournalPrefix,
    manifestHash: hash(manifest), sourceDatasetHash: dataset.manifest.bundle_hash, memoryHash: memory.contentHash,
    candidateCompilerHash: infraCandidateCompilerHash("native"), predictorContractHash: predictorContractHash(manifest.predictor),
    protocol: NATIVE_PROFILE_PROTOCOL, rowIds: selected.map(row => row.checkpoint_id), benchmarkClaim: false,
    rows: selected.map((row, ordinal) => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash,
      family_id: row.family_id, split: row.split, episode_id: row.episode_id, ordinal, baselineFirst: ordinal % 2 === 0,
      candidate: poolFor(row, memory, dataset.expected).candidates[0] })) };
  await mkdir(output, { recursive: false }); await write(join(output, "profile-plan.json"), { ...body, contentHash: hash(body) });
  return body;
}

/** Exported separately so offline tests can exercise paired execution without live endpoints. */
export async function measureNativePair(options: {
  boundary: PublicBoundary; checkpointId: string; ordinal: number; seed: number; signal: AbortSignal;
  candidate: ReturnType<typeof poolFor>["candidates"][number]; executor: ReadExecutor;
  nonMutating?: (invocation: ReturnType<typeof poolFor>["candidates"][number]["invocation"]) => boolean;
  actor: (suffix: string) => ReturnType<typeof localActorDecision>; prediction: () => Promise<unknown>;
  refreshGoals?: () => Promise<unknown>;
}): Promise<Record<string, any> & { status: string; errorType?: string }> {
  const { candidate, executor, signal } = options;
  localActorMessages(options.boundary);
  const clockId = `native-profile:${process.pid}:${randomUUID()}`, spans: Spans = {}, raw: Record<string, any> = {
    kind: "observed_infra_timing", checkpoint_id: options.checkpointId, spans, candidate, boundaryHash: hash(options.boundary),
    baselineFirst: options.ordinal % 2 === 0, actorToolsExecuted: false };
  const timed = async <T,>(operation: () => Promise<T>) => {
    const startMs = performance.now(); const result = await operation(); return { result, span: { clockId, startMs, endMs: performance.now() } };
  };
  const actorCall = async (suffix: string) => {
    signal.throwIfAborted(); const result = await timed(() => options.actor(suffix)); raw[`actor_${suffix}`] = result; return result;
  };
  let errorType: string | null = null;
  try {
    const joint = async () => {
      const trace: unknown[] = [], wrapped: ReadExecutor = {
        eligible: invocation => executor.eligible(invocation),
        read: async (invocation, inner) => {
          const measured = await timed(() => executor.read(invocation, AbortSignal.any([signal, inner])));
          spans.toolMs = measured.span; return measured.result;
        },
        validate: async (invocation, previous, inner) => {
          const measured = await timed(() => executor.validate(invocation, previous, AbortSignal.any([signal, inner])));
          spans.validationMs = measured.span; return measured.result;
        },
      };
      const scheduler = new SpeculationScheduler(`profile:${options.checkpointId}`, wrapped, event => trace.push(event));
      const actorPromise = actorCall("concurrent");
      let goalRefresh: Promise<void> | undefined;
      const background = (async () => {
        const prediction = await timed(options.prediction); spans.predictionMs = prediction.span; raw.prediction = prediction.result;
        if (options.refreshGoals) goalRefresh = (async () => {
          const startMs = performance.now();
          try { raw.goalRefresh = { status: "completed", result: await options.refreshGoals!() }; }
          catch (error) { raw.goalRefresh = { status: "failed", errorType: error instanceof Error ? error.name : "GoalRefreshError" }; }
          finally { raw.goalRefreshSpan = { clockId, startMs, endMs: performance.now() }; }
        })();
        signal.throwIfAborted();
        const startMs = performance.now(), admitted = scheduler.admit([{ ...candidate, probability: 1 }]);
        spans.schedulingMs = { clockId, startMs, endMs: performance.now() };
        if (admitted.length !== 1) throw new Error("Eligible native profiling read was not admitted");
        const promoted = await scheduler.promoteOnly(candidate.invocation);
        if (!promoted) throw new Error("Native freshness lease was not validated");
        raw.observationHash = hash(promoted.observation);
      })();
      const settled = await Promise.allSettled([actorPromise, background]);
      try { await scheduler.close(); } finally { await goalRefresh; raw.schedulerEvents = trace; }
      if (settled[0].status === "rejected") throw settled[0].reason;
      if (settled[1].status === "rejected") throw settled[1].reason;
      return settled[0].value;
    };
    const baseline = options.ordinal % 2 === 0 ? await actorCall("baseline") : null;
    const concurrent = await joint(), control = baseline ?? await actorCall("baseline");
    spans.actorLeadMs = control.span;
    spans.contentionMs = { method: "paired_difference", baseline: control.span, concurrent: concurrent.span };
    if (control.result.raw_data.acephaleCompiler.inputHash !== concurrent.result.raw_data.acephaleCompiler.inputHash) throw new Error("Paired actor input changed");
    const requested = (response: typeof control.result) => response.tool_calls?.some(call => call.name === candidate.invocation.tool && hash(call.arguments) === hash(candidate.invocation.arguments))
      && (!options.nonMutating || response.tool_calls.every(call => options.nonMutating!({ tool: call.name, arguments: JSON.parse(canonical(call.arguments)), scope: candidate.invocation.scope })));
    if (!requested(control.result) || !requested(concurrent.result)) errorType = "actor_did_not_request_profiled_read";
    if (concurrent.span.endMs - concurrent.span.startMs < control.span.endMs - control.span.startMs) errorType = "paired_contention_unresolved_negative_excess";
    if (Object.keys(spans).length !== 6) errorType = "incomplete_measured_components";
  } catch (error) { errorType = signal.aborted ? "profile_deadline" : "native_component_failure"; raw.error = error instanceof Error ? error.message : "Native profiling failed"; }
  return { ...raw, status: errorType ? "failed" : "completed", ...(errorType ? { errorType } : {}) };
}

export async function measurePreparedNativePrefix(configurationPath: string, output: string, ordinal: number) {
  const { config, path, dataset, memory, manifest, publicRows } = await inputs(configurationPath);
  const plan = await json(join(output, "profile-plan.json")), { contentHash, ...planBody } = plan;
  const declared = plan.rows[ordinal], row = publicRows.find(row => row.checkpoint_id === declared?.checkpoint_id);
  if (contentHash !== hash(planBody) || plan.configurationHash !== hash(config) || plan.manifestHash !== hash(manifest)
    || plan.sourceDatasetHash !== dataset.manifest.bundle_hash || plan.candidateCompilerHash !== infraCandidateCompilerHash("native") || !row) throw new Error("Prepared native profile identity changed");
  const prefix = await json(join(output, `prefix-${ordinal}.json`));
  if (prefix.checkpoint_id !== row.checkpoint_id || prefix.input_hash !== row.input_hash || prefix.verifiedPublicPrefix !== true
    || prefix.boundaryHash !== hash(prefix.boundary) || hash(prefix.boundary.tools) !== row.runtime_tool_schema_hash
    || prefix.boundary.policy !== row.input.policy) throw new Error("Native prefix gateway provenance mismatch");
  const { frame, policy, candidates } = poolFor(row, memory, dataset.expected);
  if (hash(candidates[0]) !== hash(declared.candidate)) throw new Error("Native candidate identity changed");
  const gateway = new NativeGateway(process.env.ACEPHALE_GATEWAY_URL ?? "", process.env.ACEPHALE_GATEWAY_TOKEN ?? "");
  const executor = new NativeReadExecutor(gateway, row.checkpoint_id, frame.scope, new Set(row.input.tools.filter((tool: any) => tool.side_effects === "read_only").map((tool: any) => tool.name)), policy);
  executor.updateFrame(frame);
  const actorEvents: unknown[] = [], predictorEvents: unknown[] = [];
  const actor = new LocalChatModelPort({ baseUrl: config.actorBaseUrl, model: manifest.actor.servedModel, stream: config.stream ?? true, record: event => actorEvents.push(event) });
  const model = new LocalChatModelPort({ baseUrl: config.predictorBaseUrl, model: manifest.predictor.servedModel,
    contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024, stream: config.stream ?? true, record: event => predictorEvents.push(event) });
  let budget: DurableBudget | undefined, memoryServices: ReturnType<typeof createInfraMemoryServices> | undefined;
  try {
  if (config.episodicEmbeddingsPath) {
    if (!process.env.ACEPHALE_RESEARCH_DATABASE_URL) throw new Error("Episodic profiling requires the dedicated research database");
    const ledgerPath = resolve(path(config.budgetDirectory), "budget.jsonl");
    const metadata = await stat(ledgerPath);
    if (!metadata.isFile() || metadata.size === 0 || !plan.budgetJournalPrefix) throw new Error("Original nonempty budget journal and frozen prefix required");
    budget = new DurableBudget(ledgerPath);
    if (hash(await nativeProfileJournalPrefix(ledgerPath, plan.budgetJournalPrefix.bytes)) !== hash(plan.budgetJournalPrefix)) throw new Error("Original budget journal prefix changed since profiling was declared");
    const embeddings = await loadFrozenEpisodeEmbeddings(path(config.episodicEmbeddingsPath), memory);
    memoryServices = createInfraMemoryServices({ memory, embeddings, databaseUrl: process.env.ACEPHALE_RESEARCH_DATABASE_URL,
       budget: budget.ledger, allocation: "development",
      allowedFamilies: dataset.expected, record: event => predictorEvents.push(event) });
  }
  const retrieval = memoryServices?.perRun(`profile:${row.checkpoint_id}`, "neutral_memory_prefetch", row.family_id);
  if (hash(plan.profile) !== hash(infraOpportunityProfile(manifest, "native", { stream: config.stream ?? true, retrievalHash: retrieval?.profileHash }))) throw new Error("Measured deployment or actual retrieval profile changed");
  const predictor = new InfraLocalPredictors(model, { ...manifest.predictor, memory, allowedFamilies: dataset.expected, excludeFamilies: [row.family_id],
    ...(retrieval ? { retrieveMemory: retrieval.retrieve, retrievalProfileHash: retrieval.profileHash } : {}) });
  const guard = nativeSplitGuard(config, manifest, resolve(configurationPath)), interruption = new AbortController();
  const guardIdentity = guard?.();
  const signal = AbortSignal.any([interruption.signal, AbortSignal.timeout(Math.min(180000, Number(process.env.ACEPHALE_PROFILE_REMAINING_MS ?? 0)))]);
  const monitor = guard ? setInterval(() => { try { guard(); } catch { interruption.abort(); } }, 500) : undefined;
  let raw: Record<string, any>;
  try { raw = await measureNativePair({ boundary: prefix.boundary, checkpointId: row.checkpoint_id, ordinal, seed: config.seed, candidate: candidates[0], executor, signal,
    nonMutating: invocation => executor.nonMutating(invocation),
    actor: suffix => localActorDecision(prefix.boundary, actor, { id: `profile:${row.checkpoint_id}:${suffix}`, seed: config.seed, maxOutputTokens: 4096, signal }),
    prediction: async () => ({ neutral: await predictor.rawRank(frame, candidates, frame.goals, signal) }),
    refreshGoals: () => predictor.inferGoals(frame, signal),
  }); } finally { if (monitor) clearInterval(monitor); }
  await memoryServices?.drain();
  await write(join(output, `node-measurement-${ordinal}.json`), { ...raw, profileHash: hash(plan.profile), actorEvents, predictorEvents, prefixHash: hash(prefix), splitGuard: guardIdentity ?? null });
  return { checkpoint_id: row.checkpoint_id, status: raw.status };
  } finally {
    try { await memoryServices?.close(); } finally { budget?.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, configuration, output, ordinal] = process.argv.slice(2);
  if (!configuration || !output || !["prepare", "measure"].includes(mode)) throw new Error("Internal native profiler: prepare|measure CONFIG OUTPUT [ORDINAL]; use python -m acephale.infra_native_profile for live runs");
  (mode === "prepare" ? prepareNativeProfile(configuration, output) : measurePreparedNativePrefix(configuration, output, Number(ordinal)))
    .then(value => console.log(JSON.stringify({ prepared: mode === "prepare", ...(mode === "measure" ? value : {}) })))
    .catch(error => { console.error(error instanceof Error ? error.message : "Native profile failed"); process.exitCode = 1; });
}
