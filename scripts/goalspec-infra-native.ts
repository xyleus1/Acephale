import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import { freezeInfraManifest, type InfraExperimentManifestV2 } from "../src/lib/goalspec/infra-manifest";
import { LocalChatModelPort } from "../src/lib/goalspec/infra-model";
import { InfraSession, type InfraSessionPolicy } from "../src/lib/goalspec/infra-session";
import { validateMemoryArtifact, type FrozenExperienceMemory } from "../src/lib/goalspec/experience-memory";
import { SpeculationScheduler, SpeculativeCapacity } from "../src/lib/goalspec/scheduler";
import { createInfraNativeCandidates } from "../services/goalspec-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/goalspec-runtime/infra-compiler-identity";
import { NativeGateway, NativeReadExecutor } from "../services/goalspec-runtime/gateway-client";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { InfraLocalPredictors, validateInfraCalibration, type InfraProbabilityCalibration } from "../services/goalspec-runtime/infra-predictors";
import { InfraNativeBoundaryWorker } from "../services/goalspec-runtime/infra-native-worker";
import { localActorMessages } from "../services/goalspec-runtime/local-actor";
import { InfraTelemetry } from "../services/goalspec-runtime/infra-telemetry";
import { ResearchService, type BoundaryWorker } from "../services/goalspec-runtime/service";
import type { PublicBoundary } from "../services/goalspec-runtime/actor";
import { validateInfraOpportunityArtifact, validateInfraGoalReliabilityArtifact,
  type InfraOpportunityArtifact, type InfraGoalReliabilityArtifact } from "../services/goalspec-runtime/infra-artifacts";
export { checkedArtifact, wilsonLower } from "../services/goalspec-runtime/infra-artifacts";
export type { InfraOpportunityArtifact, InfraGoalReliabilityArtifact } from "../services/goalspec-runtime/infra-artifacts";

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
}
export interface InfraNativeArtifacts {
  manifest: InfraExperimentManifestV2;
  memory?: FrozenExperienceMemory;
  calibration?: InfraProbabilityCalibration;
  opportunity?: InfraOpportunityArtifact;
  goalReliability?: InfraGoalReliabilityArtifact;
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
  if (configuration.version !== 1 || !["collection", "development", "heldout"].includes(configuration.stage)
    || !configuration.snapshotId || !Array.isArray(configuration.runs) || !configuration.runs.length
    || typeof configuration.stream !== "boolean" || !Number.isSafeInteger(configuration.maximumLifetimeSeconds)
    || configuration.maximumLifetimeSeconds < 1 || configuration.maximumLifetimeSeconds > 8 * 3600) throw new Error("Invalid native service configuration");
  const families = configuration.stage === "collection" ? manifest.data.trainingFamilies
    : configuration.stage === "development" ? manifest.data.developmentFamilies : manifest.data.heldoutFamilies;
  const runIds = new Set<string>();
  for (const run of configuration.runs) {
    if (!run.runId || !run.taskId || runIds.has(run.runId) || !families.includes(run.familyId)
      || !["retail", "airline"].includes(run.domain) || !["base", "neutral_memory_prefetch", "goalspec"].includes(run.arm)
      || !manifest.seeds.includes(run.seed) || !Number.isSafeInteger(run.maxBoundaries) || run.maxBoundaries < 1 || run.maxBoundaries > 1000
      || !Array.isArray(run.tools) || !run.tools.length || new Set(run.tools.map(tool => tool.function.name)).size !== run.tools.length) throw new Error("Invalid native run or split identity");
    if (configuration.stage === "collection" && run.arm !== "base") throw new Error("Training collection must be demand-only");
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
  if (!speculative) return;
  if (!configuration.predictorBaseUrl || !artifacts.memory || !artifacts.calibration || !artifacts.opportunity) throw new Error("Speculation requires measured opportunity, calibrated predictions and frozen memory");
  const learningFamilies = [...manifest.data.trainingFamilies, ...manifest.data.developmentFamilies];
  const artifactScope = { datasetHash: manifest.data.datasetHash, allowedFamilies: learningFamilies, excludedFamilies: manifest.data.heldoutFamilies };
  const memory = validateMemoryArtifact(artifacts.memory), calibration = validateInfraCalibration(artifacts.calibration);
  const opportunity = validateInfraOpportunityArtifact(artifacts.opportunity, artifactScope);
  if (memory.contentHash !== manifest.data.memoryHash || memory.repositorySnapshotId !== configuration.snapshotId
    || calibration.contentHash !== manifest.data.calibrationHash || calibration.sourceDatasetHash !== manifest.data.datasetHash
    || opportunity.version !== 1 || opportunity.sourceDatasetHash !== manifest.data.datasetHash
    || !Number.isSafeInteger(opportunity.sampleCount) || opportunity.sampleCount < 1 || !opportunity.families.length) throw new Error("Native artifact provenance mismatch");
  const heldout = new Set(manifest.data.heldoutFamilies);
  const learning = new Set(learningFamilies);
  if (memory.runs.some(run => !manifest.data.trainingFamilies.includes(run.familyId) || run.split !== "train")
    || [...calibration.fittingFamilies, ...calibration.validationFamilies, ...opportunity.families].some(family => heldout.has(family) || !learning.has(family))) throw new Error("Native held-out contamination");
  if (configuration.runs.some(run => run.arm === "goalspec")) {
    if (!artifacts.goalReliability) throw new Error("Goal conditioning requires an audited reliability artifact");
    validateInfraGoalReliabilityArtifact(artifacts.goalReliability, artifactScope);
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
  validateInfraNativeConfiguration(configuration, artifacts);
  const checkpoint = await json(configuration.ledgerCheckpointPath);
  if (hash(checkpoint) !== artifacts.manifest.budgets.ledgerCheckpointHash) throw new Error("Budget checkpoint does not match the frozen manifest");
  return { configuration, artifacts };
}

export function buildInfraNativeWorkers(configuration: InfraNativeConfiguration, artifacts: InfraNativeArtifacts,
  gateway: NativeGateway, record: (event: Record<string, unknown>) => void,
  makeModel: (role: "actor" | "predictor") => LocalChatModelPort = role => {
    const identity = artifacts.manifest[role];
    return new LocalChatModelPort({ baseUrl: role === "actor" ? configuration.actorBaseUrl : configuration.predictorBaseUrl!,
      model: identity.servedModel, contextWindow: identity.contextWindow, inputBudget: identity.inputBudget, maxOutputTokens: identity.outputCap,
      stream: configuration.stream, record });
  }): { runId: string; worker: BoundaryWorker }[] {
  validateInfraNativeConfiguration(configuration, artifacts);
  const capacity = new SpeculativeCapacity(4), actor = makeModel("actor");
  const predictor = configuration.runs.some(run => run.arm !== "base") ? makeModel("predictor") : undefined;
  return configuration.runs.map(run => {
    const scope = { tenantId: `custom-tau-${run.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
      environmentVersion: ENVIRONMENT, toolSchemaHash: hash(run.tools) };
    const workerConfiguration = { runId: run.runId, scope, snapshotId: configuration.snapshotId, maxBoundaries: run.maxBoundaries, seed: run.seed };
    if (run.arm === "base") return { runId: run.runId, worker: new InfraNativeBoundaryWorker(workerConfiguration, actor, record) };
    const reads = new NativeReadExecutor(gateway, run.runId, scope, new Set(READS[run.domain]), new NativeReadPolicy(run.domain, scope));
    const scheduler = new SpeculationScheduler(run.runId, reads, event => record({ ...event, arm: run.arm }), capacity);
    const predictors = new InfraLocalPredictors(predictor!, { calibration: artifacts.calibration!, memory: artifacts.memory,
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
      rank: (frame, candidates, goals, signal) => predictors.rank(frame, candidates, goals, signal),
      inferGoals: (frame, signal) => predictors.inferGoals(frame, signal),
      goalReliability: run.arm === "goalspec" ? artifacts.goalReliability!.reliability : 0,
    }, record);
    return { runId: run.runId, worker: new InfraNativeBoundaryWorker(workerConfiguration, actor, record, runtime, reads) };
  });
}

export async function runInfraNativeService(configurationPath: string, artifactDirectory: string, options: {
  gatewayUrl: string; gatewayToken: string; signal?: AbortSignal;
}) {
  const { configuration, artifacts } = await loadInfraNativeConfiguration(configurationPath);
  const directory = resolve(artifactDirectory);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "configuration.json"), canonical(configuration) + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "manifest.json"), canonical(artifacts.manifest) + "\n", { flag: "wx", mode: 0o600 });
  const publicTrace = join(directory, "public-boundaries.jsonl");
  await writeFile(publicTrace, "", { flag: "wx", mode: 0o600 });
  const telemetry = await InfraTelemetry.create(directory);
  const gateway = new NativeGateway(options.gatewayUrl, options.gatewayToken), service = new ResearchService(gateway);
  const controller = new AbortController(), stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(stop, configuration.maximumLifetimeSeconds * 1000);
  let decisions = 0;
  try {
    const runs = buildInfraNativeWorkers(configuration, artifacts, gateway, telemetry.record);
    for (const { runId, worker } of runs) service.register(runId, {
      close: () => worker.close(),
      decision: async (boundary, boundaryId) => {
        const publicInput = { runId, boundaryId, policy: boundary.policy, messages: localActorMessages(boundary), tools: boundary.tools };
        await appendFile(publicTrace, canonical({ type: "public_checkpoint", ...publicInput, inputHash: hash(publicInput) }) + "\n", { mode: 0o600 });
        const response = await telemetry.span("native.actor_decision", runId, { stage: configuration.stage }, () => worker.decision(boundary, boundaryId));
        await appendFile(publicTrace, canonical({ type: "public_response", runId, boundaryId, response }) + "\n", { mode: 0o600 });
        return response;
      },
    });
    telemetry.record({ type: "infra_native_service_started", configurationHash: hash(configuration), manifestHash: hash(artifacts.manifest), runs: runs.map(run => run.runId) });
    const limit = configuration.runs.reduce((sum, run) => sum + run.maxBoundaries + 1, 0);
    while (!controller.signal.aborted && decisions < limit) {
      if (await service.step(controller.signal)) decisions++;
      else if ((await gateway.request<{ closed: boolean }>("/status", {}, controller.signal)).closed) break;
      else await new Promise(resolve => setTimeout(resolve, 25));
    }
    return { decisions, aborted: controller.signal.aborted };
  } catch (error) { if (!controller.signal.aborted) throw error; return { decisions, aborted: true }; }
  finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", stop);
    try { await service.close(); }
    finally { telemetry.record({ type: "infra_native_service_closed", decisions, aborted: controller.signal.aborted }); await telemetry.close(); }
  }
}

async function main() {
  const [configurationPath, artifactDirectory] = process.argv.slice(2);
  if (!configurationPath || !artifactDirectory) throw new Error("Usage: goalspec-infra-native <configuration.json> <new-artifact-directory>");
  const gatewayUrl = process.env.GOALSPEC_GATEWAY_URL, gatewayToken = process.env.GOALSPEC_GATEWAY_TOKEN;
  if (!gatewayUrl || !gatewayToken) throw new Error("Configure native gateway URL and token securely in the process environment");
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { console.log(JSON.stringify(await runInfraNativeService(configurationPath, artifactDirectory, { gatewayUrl, gatewayToken, signal: controller.signal }))); }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : "Native infra service failed"); process.exitCode = 1; });
}
