import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, copy, hash } from "../src/lib/acephale/canonical";
import { freezeInfraManifest, type InfraExperimentManifestV2 } from "../src/lib/acephale/infra-manifest";
import { LocalChatModelPort } from "../src/lib/acephale/infra-model";
import { InfraSession, type InfraSessionPolicy } from "../src/lib/acephale/infra-session";
import { validateMemoryArtifact, type FrozenExperienceMemory } from "../src/lib/acephale/experience-memory";
import { SpeculationScheduler, SpeculativeCapacity } from "../src/lib/acephale/scheduler";
import { createInfraNativeCandidates } from "../services/acephale-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/acephale-runtime/infra-compiler-identity";
import { infraOpportunityProfile } from "../services/acephale-runtime/infra-opportunity-profile";
import { infraRelevantGoalEvidence } from "../services/acephale-runtime/infra-predictor-input";
import { infraNativePublicCheckpointInput } from "../services/acephale-runtime/infra-actor-event";
import { createInfraMemoryServices, loadFrozenEpisodeEmbeddings } from "../services/acephale-runtime/infra-memory-services";
import { episodicRetrievalProfileHash, validateEpisodeEmbeddings, type FrozenEpisodeEmbeddings } from "../src/lib/acephale/episodic-retrieval";
import { TrialLedger } from "../services/acephale-runtime/provider";
import { NativeGateway, NativeReadExecutor } from "../services/acephale-runtime/gateway-client";
import { NativeReadPolicy } from "../services/acephale-runtime/native-read-policy";
import { INFRA_PREDICTOR_CONTRACT_HASH, InfraLocalPredictors, validateInfraCalibration, type InfraProbabilityCalibration } from "../services/acephale-runtime/infra-predictors";
import { InfraNativeBoundaryWorker } from "../services/acephale-runtime/infra-native-worker";
import { InfraTelemetry } from "../services/acephale-runtime/infra-telemetry";
import { nativeSplitGuard } from "../services/acephale-runtime/infra-split-guard";
import { ResearchService, type BoundaryWorker } from "../services/acephale-runtime/service";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { ImmutableEventLog } from "../services/acephale-runtime/artifacts";
import { attachInfraHostedWorkers, validateInfraHosted, validateInfraLedgerCheckpoint,
  type InfraHostedConfiguration } from "../services/acephale-runtime/infra-hosted-workers";
import type { PublicBoundary } from "../services/acephale-runtime/actor";
import { validateInfraOpportunityArtifact, validateInfraGoalReliabilityArtifact,
  type InfraOpportunityArtifact, type InfraGoalReliabilityArtifact } from "../services/acephale-runtime/infra-artifacts";
export { checkedArtifact, wilsonLower } from "../services/acephale-runtime/infra-artifacts";
export type { InfraOpportunityArtifact, InfraGoalReliabilityArtifact } from "../services/acephale-runtime/infra-artifacts";

const ENVIRONMENT = "2174a603f6d014ef94473ffa95957f6ce27100db";
const READS = {
  retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"],
  airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"],
};
export interface InfraNativeRun {
  runId: string; taskId: string; familyId: string; domain: "retail" | "airline"; arm: InfraSessionPolicy["arm"];
  seed: number; maxBoundaries: number; tools: PublicBoundary["tools"];
}
export interface InfraNativeConfiguration {
  version: 1; stage: "collection" | "development" | "heldout";
  manifestPath: string; ledgerCheckpointPath: string; actorBaseUrl: string; predictorBaseUrl?: string;
  memoryPath?: string; calibrationPath?: string; opportunityPath?: string; goalReliabilityPath?: string;
  snapshotId: string; runs: InfraNativeRun[]; maximumLifetimeSeconds: number; stream: boolean;
  taskBundleHash?: string; hosted?: InfraHostedConfiguration;
  otlpBaseUrl?: string; splitGuardPath?: string;
  episodicEmbeddingsPath?: string;
  shadowPrediction?: boolean;
}
export interface InfraNativeArtifacts {
  manifest: InfraExperimentManifestV2;
  memory?: FrozenExperienceMemory;
  calibration?: InfraProbabilityCalibration;
  opportunity?: InfraOpportunityArtifact;
  goalReliability?: InfraGoalReliabilityArtifact;
  embeddings?: FrozenEpisodeEmbeddings;
}
export function infraNativeToolsHash(runs: InfraNativeRun[]) {
  const domains = new Map<string, PublicBoundary["tools"]>();
  for (const run of runs) {
    const previous = domains.get(run.domain);
    if (previous && hash(previous) !== hash(run.tools)) throw new Error("Native domain has inconsistent tool schemas");
    domains.set(run.domain, run.tools);
  }
  return hash([...domains].sort(([a], [b]) => a.localeCompare(b)).map(([domain, tools]) => ({ domain, tools })));
}
export function validateInfraNativeConfiguration(configuration: InfraNativeConfiguration, artifacts: InfraNativeArtifacts): void {
  const { manifest } = freezeInfraManifest(artifacts.manifest);
  // Validate before the Python launcher or Node service persists configuration.
  // Construction is local-only and sends no request.
  new LocalChatModelPort({ baseUrl: configuration.actorBaseUrl, model: manifest.actor.servedModel });
  if (configuration.predictorBaseUrl) new LocalChatModelPort({ baseUrl: configuration.predictorBaseUrl,
    model: manifest.predictor.servedModel });
  if (configuration.otlpBaseUrl) {
    const endpoint = new URL(configuration.otlpBaseUrl);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.protocol === "http:" && !["127.0.0.1", "localhost", "alloy"].includes(endpoint.hostname)) throw new Error("Native OTLP destination must be credential-free TLS or private loopback");
  }
  if (configuration.splitGuardPath && (!configuration.otlpBaseUrl || !configuration.predictorBaseUrl)) throw new Error("Split native execution requires model and OTLP tunnel destinations");
  if (configuration.version !== 1 || !["collection", "development", "heldout"].includes(configuration.stage)
    || !configuration.snapshotId || !Array.isArray(configuration.runs) || !configuration.runs.length
    || typeof configuration.stream !== "boolean" || !Number.isSafeInteger(configuration.maximumLifetimeSeconds)
    || configuration.maximumLifetimeSeconds < 1 || configuration.maximumLifetimeSeconds > 8 * 3600) throw new Error("Invalid native service configuration");
  if (configuration.hosted) {
    validateInfraHosted(configuration.hosted, configuration.stage);
    if (!/^[a-f0-9]{64}$/.test(configuration.taskBundleHash ?? "")) throw new Error("Hosted native runs require a frozen task bundle");
  }
  const families = configuration.stage === "collection" ? [...manifest.data.trainingFamilies, ...manifest.data.developmentFamilies]
    : configuration.stage === "development" ? manifest.data.developmentFamilies : manifest.data.heldoutFamilies;
  const runIds = new Set<string>();
  for (const run of configuration.runs) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(run.runId) || !run.taskId || runIds.has(run.runId) || !families.includes(run.familyId)
      || !["retail", "airline"].includes(run.domain) || !["base", "neutral_memory_prefetch", "acephale"].includes(run.arm)
      || !manifest.seeds.includes(run.seed) || !Number.isSafeInteger(run.maxBoundaries) || run.maxBoundaries < 1 || run.maxBoundaries > 1000
      || !Array.isArray(run.tools) || !run.tools.length || new Set(run.tools.map(tool => tool.function.name)).size !== run.tools.length) throw new Error("Invalid native run or split identity");
    if (configuration.stage === "collection" && run.arm !== "base") throw new Error("Training collection must be demand-only");
    if (configuration.hosted && run.maxBoundaries < configuration.hosted.maxSteps) throw new Error("Native boundary budget is below the declared step limit");
    runIds.add(run.runId);
  }
  if (manifest.data.environmentRevision !== ENVIRONMENT || manifest.data.toolSchemaHash !== infraNativeToolsHash(configuration.runs)
    || manifest.protocol.scheduleHash !== hash(configuration.runs)) throw new Error("Native environment, tool or schedule manifest mismatch");
  if (configuration.stage !== "collection") {
    const blocks = new Map<string, InfraNativeRun[]>();
    for (const run of configuration.runs) {
      const key = hash([run.familyId, run.taskId, run.domain, run.seed]);
      blocks.set(key, [...(blocks.get(key) ?? []), run]);
    }
    if ([...blocks.values()].some(block => block.length !== 3 || new Set(block.map(run => run.arm)).size !== 3
      || new Set(block.map(run => run.maxBoundaries)).size !== 1)) throw new Error("Comparison native schedule requires complete matched three-arm blocks");
  }
  const speculative = configuration.runs.some(run => run.arm !== "base");
  if (configuration.shadowPrediction !== undefined && typeof configuration.shadowPrediction !== "boolean") throw new Error("Invalid shadow prediction flag");
  if (configuration.shadowPrediction) {
    if (configuration.stage !== "collection" || speculative || !configuration.predictorBaseUrl || !artifacts.memory
      || artifacts.embeddings || configuration.episodicEmbeddingsPath
      || configuration.runs.some(run => !manifest.data.trainingFamilies.includes(run.familyId))) {
      throw new Error("Shadow prediction requires base-only training collection, a predictor and frozen lexical memory");
    }
    const memory = validateMemoryArtifact(artifacts.memory);
    if (memory.contentHash !== manifest.data.memoryHash || memory.repositorySnapshotId !== configuration.snapshotId
      || memory.runs.some(run => run.split !== "train" || !manifest.data.trainingFamilies.includes(run.familyId))) {
      throw new Error("Shadow training memory provenance mismatch");
    }
  }
  if (configuration.episodicEmbeddingsPath && (!artifacts.memory || !artifacts.embeddings || !configuration.hosted)) {
    throw new Error("Episodic retrieval requires frozen memory/embeddings and reserved native trial budgets");
  }
  if (!speculative) return;
  if (!configuration.predictorBaseUrl || !artifacts.memory || !artifacts.calibration || !artifacts.opportunity) throw new Error("Speculation requires measured opportunity, calibrated predictions and frozen memory");
  const learningFamilies = [...manifest.data.trainingFamilies, ...manifest.data.developmentFamilies];
  const artifactScope = { datasetHash: manifest.data.datasetHash, allowedFamilies: learningFamilies, excludedFamilies: manifest.data.heldoutFamilies,
    opportunityProfile: infraOpportunityProfile(manifest, "native", { stream: configuration.stream,
      retrievalHash: artifacts.embeddings ? episodicRetrievalProfileHash(validateEpisodeEmbeddings(artifacts.embeddings, artifacts.memory)) : undefined }) };
  const memory = validateMemoryArtifact(artifacts.memory), calibration = validateInfraCalibration(artifacts.calibration);
  const opportunity = validateInfraOpportunityArtifact(artifacts.opportunity, artifactScope);
  if (memory.contentHash !== manifest.data.memoryHash || memory.repositorySnapshotId !== configuration.snapshotId
    || calibration.contentHash !== manifest.data.calibrationHash || calibration.sourceDatasetHash !== manifest.data.datasetHash
    || opportunity.version !== 2 || opportunity.sourceDatasetHash !== manifest.data.datasetHash
    || !Number.isSafeInteger(opportunity.sampleCount) || opportunity.sampleCount < 1 || !opportunity.families.length) throw new Error("Native artifact provenance mismatch");
  const heldout = new Set(manifest.data.heldoutFamilies);
  const learning = new Set(learningFamilies);
  if (memory.runs.some(run => !manifest.data.trainingFamilies.includes(run.familyId) || run.split !== "train")
    || calibration.fittingFamilies.some(family => !manifest.data.trainingFamilies.includes(family))
    || calibration.validationFamilies.some(family => !manifest.data.developmentFamilies.includes(family))
    || [...calibration.fittingFamilies, ...calibration.validationFamilies, ...opportunity.families].some(family => heldout.has(family) || !learning.has(family))) throw new Error("Native held-out contamination");
  if (configuration.runs.some(run => run.arm === "acephale")) {
    if (!calibration.conditionalCalibration) throw new Error("Goal conditioning requires separate conditional calibration");
    if (!artifacts.goalReliability) throw new Error("Goal conditioning requires an audited reliability artifact");
    validateInfraGoalReliabilityArtifact(artifacts.goalReliability, { ...artifactScope,
      allowedFamilies: manifest.data.trainingFamilies, predictor: {
      model: { repository: manifest.predictor.repository, revision: manifest.predictor.revision },
      memoryHash: memory.contentHash, predictorContractHash: INFRA_PREDICTOR_CONTRACT_HASH,
      candidateCompilerHash: infraCandidateCompilerHash("native"),
      retrievalHash: artifactScope.opportunityProfile.retrievalHash,
    } });
  }
}

export async function loadInfraNativeConfiguration(path: string) {
  const directory = dirname(resolve(path));
  const json = async (relative: string) => JSON.parse(await readFile(resolve(directory, relative), "utf8"));
  const configuration = JSON.parse(await readFile(resolve(path), "utf8")) as InfraNativeConfiguration;
  const artifacts: InfraNativeArtifacts = {
    manifest: await json(configuration.manifestPath),
    ...(configuration.memoryPath ? { memory: await json(configuration.memoryPath) } : {}),
    ...(configuration.calibrationPath ? { calibration: await json(configuration.calibrationPath) } : {}),
    ...(configuration.opportunityPath ? { opportunity: await json(configuration.opportunityPath) } : {}),
    ...(configuration.goalReliabilityPath ? { goalReliability: await json(configuration.goalReliabilityPath) } : {}),
  };
  if (configuration.episodicEmbeddingsPath) {
    if (!artifacts.memory) throw new Error("Episodic retrieval requires frozen memory");
    artifacts.embeddings = await loadFrozenEpisodeEmbeddings(resolve(directory, configuration.episodicEmbeddingsPath), artifacts.memory);
  }
  validateInfraNativeConfiguration(configuration, artifacts);
  const checkpoint = await json(configuration.ledgerCheckpointPath);
  if (hash(checkpoint) !== artifacts.manifest.budgets.ledgerCheckpointHash) throw new Error("Budget checkpoint does not match the frozen manifest");
  nativeSplitGuard(configuration, artifacts.manifest, resolve(path));
  return { configuration, artifacts };
}

export function buildInfraNativeWorkers(configuration: InfraNativeConfiguration, artifacts: InfraNativeArtifacts,
  gateway: NativeGateway, record: (event: Record<string, unknown>) => void,
  makeModel: (role: "actor" | "predictor") => LocalChatModelPort = role => {
    const identity = artifacts.manifest[role];
    return new LocalChatModelPort({ baseUrl: role === "actor" ? configuration.actorBaseUrl : configuration.predictorBaseUrl!,
      model: identity.servedModel, contextWindow: identity.contextWindow, inputBudget: identity.inputBudget, maxOutputTokens: identity.outputCap,
      stream: configuration.stream, record });
  }, memoryServices?: ReturnType<typeof createInfraMemoryServices>): { runId: string; worker: BoundaryWorker }[] {
  validateInfraNativeConfiguration(configuration, artifacts);
  const capacity = new SpeculativeCapacity(4), actor = makeModel("actor");
  const predictor = configuration.shadowPrediction || configuration.runs.some(run => run.arm !== "base") ? makeModel("predictor") : undefined;
  return configuration.runs.map(run => {
    const scope = { tenantId: `custom-tau-${run.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
      environmentVersion: ENVIRONMENT, toolSchemaHash: hash(run.tools) };
    const workerConfiguration = { runId: run.runId, scope, snapshotId: configuration.snapshotId, maxBoundaries: run.maxBoundaries, seed: run.seed };
    if (run.arm === "base") {
      if (!configuration.shadowPrediction) return { runId: run.runId, worker: new InfraNativeBoundaryWorker(workerConfiguration, actor, record) };
      const policy = new NativeReadPolicy(run.domain, scope);
      const toolsByName = Object.fromEntries(run.tools.map(tool => [tool.function.name, tool.function.parameters]));
      const compiler = createInfraNativeCandidates(artifacts.memory!, toolsByName, invocation => policy.eligible(invocation), {
        allowedFamilies: artifacts.manifest.data.trainingFamilies, excludeFamilies: [...artifacts.manifest.data.heldoutFamilies, run.familyId],
      });
      const shadow = new InfraLocalPredictors(predictor!, { memory: artifacts.memory!, record,
        allowedFamilies: artifacts.manifest.data.trainingFamilies, excludeFamilies: [...artifacts.manifest.data.heldoutFamilies, run.familyId] });
      return { runId: run.runId, worker: new InfraNativeBoundaryWorker(workerConfiguration, actor, record, undefined, undefined,
        async (frame, signal) => { policy.updateFrame(frame); const candidates = compiler.candidates(frame);
          return { candidates, decision: await shadow.rawRank(frame, candidates, frame.goals, signal) }; }) };
    }
    const reads = new NativeReadExecutor(gateway, run.runId, scope, new Set(READS[run.domain]), new NativeReadPolicy(run.domain, scope));
    const scheduler = new SpeculationScheduler(run.runId, reads, event => record({ ...event, arm: run.arm }), capacity);
    const retriever = memoryServices?.perRun(run.runId, run.arm, run.familyId);
    if (artifacts.embeddings && !retriever) throw new Error("Episodic retrieval configuration is not connected to its execution port");
    const predictors = new InfraLocalPredictors(predictor!, { calibration: artifacts.calibration!, memory: artifacts.memory,
      ...(retriever ? { retrieveMemory: retriever.retrieve, retrievalProfileHash: retriever.profileHash } : {}),
      expectedCandidateCompilerHash: infraCandidateCompilerHash("native"),
      allowedFamilies: artifacts.manifest.data.trainingFamilies, excludeFamilies: [...artifacts.manifest.data.heldoutFamilies, run.familyId], record });
    const toolsByName = Object.fromEntries(run.tools.map(tool => [tool.function.name, tool.function.parameters]));
    const compiled = createInfraNativeCandidates(artifacts.memory!, toolsByName, invocation => reads.eligible(invocation), {
      allowedFamilies: artifacts.manifest.data.trainingFamilies, excludeFamilies: [...artifacts.manifest.data.heldoutFamilies, run.familyId],
    });
    record({ type: "infra_native_workflows_compiled", runId: run.runId, workflowHash: compiled.workflowHash,
      memoryHash: artifacts.memory!.contentHash, patternCount: compiled.patternCount });
    const candidatePool = compiled.candidates;
    const runtime = new InfraSession(scheduler, { arm: run.arm, memoryHash: artifacts.memory!.contentHash,
      opportunity: () => copy(artifacts.opportunity!.estimate), candidates: candidatePool,
      validateBinding: (candidate, frame) => candidatePool(frame).some(current => hash(current.invocation) === hash(candidate.invocation)
        && hash(current.bindings) === hash(candidate.bindings)),
      rank: (frame, candidates, goals, signal, getLatestGoals) => predictors.rank(frame, candidates, goals, signal, getLatestGoals),
      inferGoals: (frame, signal) => predictors.inferGoals(frame, signal),
      relevantGoalEvidence: infraRelevantGoalEvidence,
      goalReliability: run.arm === "acephale" ? artifacts.goalReliability!.reliability : 0,
    }, record);
    const worker = new InfraNativeBoundaryWorker(workerConfiguration, actor, record, runtime, reads);
    return { runId: run.runId, worker: { decision: (boundary, id) => worker.decision(boundary, id),
      async close() { await worker.close(); await memoryServices?.drain(); } } };
  });
}

export async function runInfraNativeService(configurationPath: string, artifactDirectory: string, options: {
  gatewayUrl: string; gatewayToken: string; signal?: AbortSignal; budgetDirectory?: string;
}) {
  const { configuration, artifacts } = await loadInfraNativeConfiguration(configurationPath);
  const guard = nativeSplitGuard(configuration, artifacts.manifest, resolve(configurationPath));
  const guardIdentity = guard?.();
  const directory = resolve(artifactDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "configuration.json"), canonical(configuration) + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "manifest.json"), canonical(artifacts.manifest) + "\n", { flag: "wx", mode: 0o600 });
  const publicTrace = join(directory, "public-boundaries.jsonl");
  await writeFile(publicTrace, "", { flag: "wx", mode: 0o600 });
  const telemetry = await InfraTelemetry.create(directory, configuration.otlpBaseUrl);
  const gateway = new NativeGateway(options.gatewayUrl, options.gatewayToken), service = new ResearchService(gateway);
  const controller = new AbortController();
  let serviceClosing: Promise<void> | undefined;
  const closeService = () => {
    if (!serviceClosing) { serviceClosing = service.close(); void serviceClosing.catch(() => {}); }
    return serviceClosing;
  };
  // Gateway cancellation alone cannot interrupt a worker already inside model inference.
  // Every stop path closes the worker owner immediately and awaits the same drain below.
  const stop = () => { controller.abort(); void closeService(); };
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  const timer = setTimeout(stop, configuration.maximumLifetimeSeconds * 1000);
  const guardTimer = guard ? setInterval(() => {
    try { guard(); } catch {
      if (!serviceClosing) {
        telemetry.record({ type: "infra_split_guard_interruption" }); stop();
      }
    }
  }, 500) : undefined;
  let decisions = 0;
  let budget: DurableBudget | undefined, costs: ImmutableEventLog | undefined;
  let memoryServices: ReturnType<typeof createInfraMemoryServices> | undefined;
  try {
    controller.signal.throwIfAborted();
    if (configuration.hosted) {
      if (!options.budgetDirectory) throw new Error("Original budget directory required for hosted native workers");
      const ledgerPath = resolve(options.budgetDirectory, "budget.jsonl");
      const ledgerStat = await stat(ledgerPath);
      if (!ledgerStat.isFile() || ledgerStat.size === 0) throw new Error("Original nonempty budget journal is required");
      budget = new DurableBudget(ledgerPath);
      const checkpoint = JSON.parse(await readFile(resolve(dirname(configurationPath), configuration.ledgerCheckpointPath), "utf8"));
      validateInfraLedgerCheckpoint(checkpoint, budget.ledger, ledgerPath);
      costs = new ImmutableEventLog(join(resolve(options.budgetDirectory), `events-${randomUUID()}.jsonl`));
      costs.append({ type: "research_manifest", manifestHash: hash(configuration), experimentManifestHash: hash(artifacts.manifest),
        actor: artifacts.manifest.actor, predictor: artifacts.manifest.predictor, accountingScope: "hosted_native_user_and_judge" });
    }
    if (artifacts.embeddings) {
      const allocation = configuration.hosted!.allocation;
      memoryServices = createInfraMemoryServices({ memory: artifacts.memory!, embeddings: artifacts.embeddings,
        databaseUrl: process.env.ACEPHALE_RESEARCH_DATABASE_URL,
        budget: budget!.ledger, allocation, budgetForRun: runId => ({ ledger: new TrialLedger(budget!.ledger, `infra:${runId}`, allocation), allocation }),
        allowedFamilies: artifacts.manifest.data.trainingFamilies, excludeFamilies: artifacts.manifest.data.heldoutFamilies,
        record: event => { telemetry.record(event); costs!.append(event); } });
    }
    controller.signal.throwIfAborted();
    const runs = buildInfraNativeWorkers(configuration, artifacts, gateway, telemetry.record, undefined, memoryServices);
    const workers = configuration.hosted ? attachInfraHostedWorkers(runs, configuration.hosted, budget!.ledger, event => costs!.append(event)) : runs;
    const actorIds = new Set(runs.map(run => run.runId));
    for (const { runId, worker } of workers) service.register(runId, !actorIds.has(runId) ? worker : {
      close: () => worker.close(),
      decision: async (boundary, boundaryId) => {
        const publicInput = infraNativePublicCheckpointInput(runId, boundaryId, boundary);
        await appendFile(publicTrace, canonical({ type: "public_checkpoint", ...publicInput, inputHash: hash(publicInput) }) + "\n", { mode: 0o600 });
        const response = await telemetry.span("native.actor_decision", runId, { stage: configuration.stage }, () => worker.decision(boundary, boundaryId));
        await appendFile(publicTrace, canonical({ type: "public_response", runId, boundaryId, response }) + "\n", { mode: 0o600 });
        return response;
      },
    });
    telemetry.record({ type: "infra_native_service_started", configurationHash: hash(configuration), manifestHash: hash(artifacts.manifest), runs: runs.map(run => run.runId),
      ...(guardIdentity ? { splitGuard: guardIdentity } : {}), otlpDestination: configuration.otlpBaseUrl ?? null });
    // Acknowledgment occurs only after all actor, simulator, judge and budget
    // workers have been initialized. Native timers must start after this receipt.
    await gateway.request("/ready", { manifestHash: hash(configuration), experimentManifestHash: hash(artifacts.manifest) }, controller.signal);
    const limit = configuration.runs.reduce((sum, run) => sum + run.maxBoundaries + 1
      + (configuration.hosted ? 2 * (configuration.hosted.maxSteps + 1) : 0), 0);
    while (!controller.signal.aborted && decisions < limit) {
      if (await service.step(controller.signal)) decisions++;
      else if ((await gateway.request<{ closed: boolean }>("/status", {}, controller.signal)).closed) break;
      else await new Promise(resolve => setTimeout(resolve, 25));
    }
    return { decisions, aborted: controller.signal.aborted };
  } catch (error) { if (!controller.signal.aborted) throw error; return { decisions, aborted: true }; }
  finally {
    clearTimeout(timer); if (guardTimer) clearInterval(guardTimer); options.signal?.removeEventListener("abort", stop);
    try { await closeService(); }
    finally {
      try { await memoryServices?.close(); costs?.append({ type: "service_closed", decisions, aborted: controller.signal.aborted }); costs?.close(); }
      finally {
        budget?.close();
        telemetry.record({ type: "infra_native_service_closed", decisions, aborted: controller.signal.aborted }); await telemetry.close();
        await writeFile(join(directory, "telemetry-export-receipt.json"), canonical(telemetry.exportSummary()) + "\n", { flag: "wx", mode: 0o600 });
        if (configuration.otlpBaseUrl && telemetry.exportSummary().failed) throw new Error("Native telemetry export was not accepted by the configured collector");
      }
    }
  }
}

export async function writeInfraLedgerCheckpoint(ledgerPath: string, output: string) {
  const path = resolve(ledgerPath), metadata = await stat(path);
  if (!metadata.isFile() || metadata.size === 0) throw new Error("Existing nonempty original budget journal required; replacement ledgers are forbidden");
  const budget = new DurableBudget(path);
  try {
    const entries = budget.ledger.snapshot();
    const checkpoint = { version: 1, ledgerPathHash: hash(path), entriesHash: hash(entries), entries };
    await writeFile(resolve(output), canonical(checkpoint) + "\n", { flag: "wx", mode: 0o600 });
    return { checkpointHash: hash(checkpoint), reservations: entries.length };
  } finally { budget.close(); }
}

async function main() {
  if (process.argv[2] === "checkpoint") {
    const [, ledgerPath, output] = process.argv.slice(2);
    if (!ledgerPath || !output) throw new Error("Usage: acephale-infra-native checkpoint <original-budget.jsonl> <new-checkpoint.json>");
    console.log(JSON.stringify(await writeInfraLedgerCheckpoint(ledgerPath, output))); return;
  }
  const [configurationPath, artifactDirectory] = process.argv.slice(2);
  if (!configurationPath || !artifactDirectory) throw new Error("Usage: acephale-infra-native <configuration.json> <new-artifact-directory>");
  const gatewayUrl = process.env.ACEPHALE_GATEWAY_URL, gatewayToken = process.env.ACEPHALE_GATEWAY_TOKEN;
  if (!gatewayUrl || !gatewayToken) throw new Error("Configure native gateway URL and token securely in the process environment");
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const result = await runInfraNativeService(configurationPath, artifactDirectory, { gatewayUrl, gatewayToken,
      budgetDirectory: process.env.ACEPHALE_BUDGET_DIRECTORY, signal: controller.signal });
    console.log(JSON.stringify(result));
    if (result.aborted) process.exitCode = 1;
  }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : "Native infra service failed"); process.exitCode = 1; });
}
