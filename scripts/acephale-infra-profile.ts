/** Real document component profiling. This is not a task-success or speedup trial. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { validateInfraManifest } from "../src/lib/acephale/infra-manifest";
import { LocalChatModelPort } from "../src/lib/acephale/infra-model";
import { SpeculationScheduler, type ReadExecutor } from "../src/lib/acephale/scheduler";
import { validateMemoryArtifact } from "../src/lib/acephale/experience-memory";
import { DocumentReadExecutor, documentCandidates, verifyDocumentCorpus } from "../services/acephale-runtime/document-adapter";
import { localActorDecision } from "../services/acephale-runtime/local-actor";
import { InfraLocalPredictors, predictorContractHash } from "../services/acephale-runtime/infra-predictors";
import { infraCandidateCompilerHash } from "../services/acephale-runtime/infra-compiler-identity";
import { infraOpportunityProfile, DOCUMENT_PROFILE_PROTOCOL } from "../services/acephale-runtime/infra-opportunity-profile";
import { createInfraMemoryServices, loadFrozenEpisodeEmbeddings } from "../services/acephale-runtime/infra-memory-services";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { validateInfraLedgerCheckpoint } from "../services/acephale-runtime/infra-hosted-workers";
import { publicInfraFrame, selectInfraReplayRows } from "./acephale-infra-predict";
import { verifyDocumentBundle } from "./acephale-infra-document-data";

interface ProfileConfig {
  version: 1; datasetPath: string; memoryPath: string; corpusPath: string; manifestPath: string; ledgerCheckpointPath: string;
  actorBaseUrl: string; predictorBaseUrl: string; limit: number; seed: number; maximumLifetimeSeconds: number;
  episodicEmbeddingsPath?: string; budgetDirectory?: string;
}
type Span = { clockId: string; startMs: number; endMs: number };
type Contention = { method: "paired_difference"; baseline: Span; concurrent: Span };
type Measurements = Partial<Record<"actorLeadMs" | "predictionMs" | "toolMs" | "validationMs" | "schedulingMs", Span>> & { contentionMs?: Contention };
const json = async <T = any>(file: string): Promise<T> => JSON.parse(await readFile(file, "utf8"));
const write = (file: string, value: unknown) => writeFile(file, canonical(value) + "\n", { flag: "wx", mode: 0o600 });
const protocol = DOCUMENT_PROFILE_PROTOCOL;

export async function runOpportunityProfile(configurationPath: string, output: string, options: { documentFetch?: typeof fetch } = {}) {
  const config = await json<ProfileConfig>(configurationPath), base = dirname(resolve(configurationPath));
  const path = (file: string) => resolve(base, file);
  if (config.version !== 1 || !Number.isSafeInteger(config.limit) || config.limit < 1 || config.limit > 100
    || !Number.isSafeInteger(config.maximumLifetimeSeconds) || config.maximumLifetimeSeconds < 1 || config.maximumLifetimeSeconds > 28800
    || !Number.isSafeInteger(config.seed) || config.seed < 0) throw new Error("Invalid bounded component profile configuration");
  const inventory = await json(join(path(config.datasetPath), "manifest.json"));
  if (!inventory.files?.["document-lineage.json"]) throw new Error("Native profiling is blocked: actual Python gateway read and freshness-lease measurements are required; closed trace durations cannot substitute");
  const dataset = verifyDocumentBundle(path(config.datasetPath)), memory = validateMemoryArtifact(await json(path(config.memoryPath)));
  const corpus = verifyDocumentCorpus(await json(path(config.corpusPath))), manifest = await json(path(config.manifestPath));
  validateInfraManifest(manifest);
  if (hash(await json(path(config.ledgerCheckpointPath))) !== manifest.budgets.ledgerCheckpointHash
    || memory.repositorySnapshotId !== `infra-documents:${dataset.manifest.bundle_hash}` || memory.contentHash !== manifest.data.memoryHash || corpus.contentHash !== dataset.lineage.corpusHash
    || manifest.data.datasetHash !== dataset.lineage.taskHash || manifest.data.environmentRevision !== corpus.contentHash
    || !manifest.seeds.includes(config.seed)) throw new Error("Component profile source/ledger/model provenance mismatch");
  const candidates = (await readFile(join(path(config.datasetPath), "public.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  // Selection inspects only current visible candidates, never future action/outcome labels.
  const selected = selectInfraReplayRows(candidates.filter(row => documentCandidates(publicInfraFrame(row, memory.repositorySnapshotId)).length > 0), config.limit);
  if (!selected.length) throw new Error("No eligible current document reads to profile");
  if (selected.some(row => row.split === "test" || !(row.split === "train" ? manifest.data.trainingFamilies : manifest.data.developmentFamilies).includes(row.family_id))) throw new Error("Profile family outside declared train/development partitions");
  const actorEvents: Record<string, unknown>[] = [], predictorEvents: Record<string, unknown>[] = [];
  const actor = new LocalChatModelPort({ baseUrl: config.actorBaseUrl, model: manifest.actor.servedModel, record: event => actorEvents.push(event) });
  const model = new LocalChatModelPort({ baseUrl: config.predictorBaseUrl, model: manifest.predictor.servedModel, contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024, record: event => predictorEvents.push(event) });
  const directory = resolve(output); await mkdir(directory, { recursive: false });
  let budget: DurableBudget | undefined, memoryServices: ReturnType<typeof createInfraMemoryServices> | undefined;
  try {
  if (config.episodicEmbeddingsPath) {
    if (!config.budgetDirectory || !process.env.ACEPHALE_RESEARCH_DATABASE_URL) throw new Error("Episodic profiling requires the original budget directory and dedicated research database");
    const ledgerPath = resolve(path(config.budgetDirectory), "budget.jsonl"), metadata = await stat(ledgerPath);
    if (!metadata.isFile() || metadata.size === 0) throw new Error("Original nonempty budget journal required");
    budget = new DurableBudget(ledgerPath);
    validateInfraLedgerCheckpoint(await json(path(config.ledgerCheckpointPath)), budget.ledger, ledgerPath);
    const embeddings = await loadFrozenEpisodeEmbeddings(path(config.episodicEmbeddingsPath), memory);
    memoryServices = createInfraMemoryServices({ memory, embeddings, databaseUrl: process.env.ACEPHALE_RESEARCH_DATABASE_URL,
       budget: budget.ledger, allocation: "development",
      allowedFamilies: dataset.expected, record: event => predictorEvents.push(event) });
  }
  const profile = infraOpportunityProfile(manifest, "documents", { retrievalHash: memoryServices?.profileHash });
  const plan = { version: 2, kind: "document_component_profile", configuration: config, configurationHash: hash(config), manifestHash: hash(manifest), profile,
    sourceDatasetHash: dataset.manifest.bundle_hash, memoryHash: memory.contentHash, corpusHash: corpus.contentHash,
    predictorContractHash: predictorContractHash(manifest.predictor), candidateCompilerHash: infraCandidateCompilerHash("documents"),
    rowIds: selected.map(row => row.checkpoint_id), protocol, benchmarkClaim: false };
  await write(join(directory, "profile-plan.json"), { ...plan, contentHash: hash(plan) });
  const lifetime = AbortSignal.timeout(config.maximumLifetimeSeconds * 1000), clockId = `node-profile:${process.pid}:${randomUUID()}`;
  const rows: Record<string, unknown>[] = [];
  for (const [ordinal, row] of selected.entries()) {
    const identity = Object.fromEntries(["checkpoint_id", "input_hash", "family_id", "split"].map(key => [key, row[key]]));
    const spans: Measurements = {}, actorOffset = actorEvents.length, predictorOffset = predictorEvents.length;
    const raw: Record<string, unknown> = { kind: "observed_infra_timing", ...identity, profileHash: hash(profile), ordinal, spans, baselineFirst: ordinal % 2 === 0 };
    let errorType: string | null = null;
    const timed = async <T,>(operation: () => Promise<T>): Promise<{ result: T; span: Span }> => {
      const startMs = performance.now(); const result = await operation(); return { result, span: { clockId, startMs, endMs: performance.now() } };
    };
    try {
      lifetime.throwIfAborted();
      const frame = publicInfraFrame(row, memory.repositorySnapshotId), pool = documentCandidates(frame), candidate = pool[0];
      const signal = AbortSignal.any([lifetime, AbortSignal.timeout(180000)]);
      const retrieval = memoryServices?.perRun(`profile:${row.checkpoint_id}`, "neutral_memory_prefetch", row.family_id);
      const predictor = new InfraLocalPredictors(model, { ...manifest.predictor, memory, allowedFamilies: dataset.expected, excludeFamilies: [row.family_id],
        ...(retrieval ? { retrieveMemory: retrieval.retrieve, retrievalProfileHash: retrieval.profileHash } : {}) });
      const actorCall = async (suffix: string) => {
        const measured = await timed(() => localActorDecision(row.document_boundary, actor, {
          id: `profile:${row.checkpoint_id}:${suffix}`, seed: config.seed, maxOutputTokens: 4096, signal }));
        raw[`actor_${suffix}`] = measured; return measured;
      };
      const joint = async () => {
        const executor = new DocumentReadExecutor(corpus, frame.scope, { fetch: options.documentFetch }); executor.updateFrame(frame);
        const wrapped: ReadExecutor = { eligible: invocation => executor.eligible(invocation), validationPhysicalCalls: () => 0,
          read: async (invocation, readSignal) => {
            const observed = await timed(() => executor.read(invocation, AbortSignal.any([signal, readSignal]))); spans.toolMs = observed.span; return observed.result;
          },
          validate: (invocation, observation, readSignal) => executor.validate(invocation, observation, AbortSignal.any([signal, readSignal])),
          validateFreshness: async (invocation, observation, readSignal) => {
            const observed = await timed(() => executor.validateFreshness(invocation, observation, AbortSignal.any([signal, readSignal]))); spans.validationMs = observed.span; return observed.result;
          } };
        const schedulerEvents: unknown[] = [], scheduler = new SpeculationScheduler(`profile:${row.checkpoint_id}`, wrapped, event => schedulerEvents.push(event));
        const actorPromise = actorCall("concurrent");
        let goalRefresh: Promise<void> | undefined;
        const work = (async () => {
          const prediction = await timed(() => predictor.rawRank(frame, pool, frame.goals, signal));
          spans.predictionMs = prediction.span; raw.prediction = { neutral: prediction.result };
          goalRefresh = (async () => {
            const startMs = performance.now();
            try { raw.goalRefresh = { status: "completed", result: await predictor.inferGoals(frame, signal) }; }
            catch (error) { raw.goalRefresh = { status: "failed", errorType: error instanceof Error ? error.name : "GoalRefreshError" }; }
            finally { raw.goalRefreshSpan = { clockId, startMs, endMs: performance.now() }; }
          })();
          const startMs = performance.now(), admitted = scheduler.admit([{ ...candidate, probability: 1 }]);
          spans.schedulingMs = { clockId, startMs, endMs: performance.now() };
          if (admitted.length !== 1) throw new Error("Measured scheduler rejected the eligible profiling read");
          const promoted = await scheduler.promoteOnly(candidate.invocation);
          if (!promoted) throw new Error("Measured immutable receipt validation failed");
          raw.observationHash = hash(promoted.observation);
        })();
        // Both operations drain, including on failure; no unawaited model request survives a row.
        const settled = await Promise.allSettled([actorPromise, work]);
        try { await scheduler.close(); } finally { await goalRefresh; raw.schedulerEvents = schedulerEvents; }
        if (settled[0].status === "rejected") throw settled[0].reason;
        if (settled[1].status === "rejected") throw settled[1].reason;
        return settled[0].value;
      };
      const baseline = ordinal % 2 === 0 ? await actorCall("baseline") : null;
      const concurrent = await joint();
      const control = baseline ?? await actorCall("baseline");
      spans.actorLeadMs = control.span;
      spans.contentionMs = { method: "paired_difference", baseline: control.span, concurrent: concurrent.span };
      raw.actorBaseline = control.result; raw.actorConcurrent = concurrent.result;
      if (control.result.raw_data.acephaleCompiler.inputHash !== concurrent.result.raw_data.acephaleCompiler.inputHash) throw new Error("Actor comparison input mismatch");
      const requested = (result: typeof control.result) => result.tool_calls?.some(call => call.name === candidate.invocation.tool
        && hash(call.arguments) === hash(candidate.invocation.arguments));
      if (!requested(control.result) || !requested(concurrent.result)) errorType = "actor_did_not_request_profiled_read";
      const excess = concurrent.span.endMs - concurrent.span.startMs - (control.span.endMs - control.span.startMs);
      if (excess < 0) errorType = "paired_contention_unresolved_negative_excess";
      if (Object.keys(spans).length !== 6) errorType = "incomplete_measured_components";
    } catch (error) { errorType = lifetime.aborted ? "profile_deadline_or_not_started" : error instanceof Error ? error.name : "ProfileError"; raw.error = error instanceof Error ? error.message : "Component measurement failed"; }
    await memoryServices?.drain();
    raw.actorEvents = actorEvents.slice(actorOffset); raw.predictorEvents = predictorEvents.slice(predictorOffset);
    raw.status = errorType ? "failed" : "completed";
    if (errorType) raw.errorType = errorType;
    const name = `measurement-${String(ordinal).padStart(4, "0")}.json`; await write(join(directory, name), raw);
    const evidence = { path: name, sha256: createHash("sha256").update(await readFile(join(directory, name))).digest("hex") };
    rows.push({ ...identity, profileHash: hash(profile), status: raw.status, ...(errorType ? { errorType } : { spans }), evidence });
    await writeFile(join(directory, "rows.jsonl"), canonical(rows.at(-1)) + "\n", { flag: ordinal ? "a" : "wx", mode: 0o600 });
  }
  const body = { version: 2, kind: "measured_infra_opportunity", sourceDatasetHash: dataset.manifest.bundle_hash, profile,
    protocol, profilePlanHash: hash(plan), rowIds: plan.rowIds, rows };
  await write(join(directory, "measurements.json"), { ...body, contentHash: hash(body) });
  const complete = rows.filter(row => row.status === "completed").length;
  return { output: directory, declared: rows.length, completed: complete, failed: rows.length - complete,
    readyForAggregation: complete >= 10, actorWeightsUpdated: false, benchmarkClaim: false };
  } finally {
    try { await memoryServices?.close(); } finally { budget?.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [configuration, output] = process.argv.slice(2);
  if (!configuration || !output) throw new Error("Usage: acephale-infra-profile.ts CONFIG NEW_OUTPUT");
  runOpportunityProfile(configuration, output).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error instanceof Error ? error.message : "Component profiling failed"); process.exitCode = 1; });
}
