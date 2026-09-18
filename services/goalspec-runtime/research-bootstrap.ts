import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BootstrapContext } from "./host";
import type { BoundaryWorker } from "./service";
import { NativeBoundaryWorker } from "./worker";
import { NativeReadExecutor } from "./gateway-client";
import { maximumCost, researchProvider, TrialLedger, PRICE_SOURCE } from "./provider";
import { RESEARCH_MODELS, type ModelPort } from "../../src/lib/goalspec/model";
import { ALLOCATIONS, type Allocation } from "../../src/lib/goalspec/budget";
import { canonical, hash } from "../../src/lib/goalspec/canonical";
import { FrozenRepository, type Experience } from "../../src/lib/goalspec/repository";
import { PostgresExperienceRepository, researchDatabase } from "../../src/lib/goalspec/postgres-store";
import { GoalSpecSession, type Predictors } from "../../src/lib/goalspec/session";
import { ContractPredictors, countTokens } from "../../src/lib/goalspec/predictors";
import { SpeculationScheduler } from "../../src/lib/goalspec/scheduler";
import type { ActorRuntime, PublicBoundary } from "./actor";
import { type AdmissionEstimate } from "../../src/lib/goalspec/current-bindings";
import { memoryQuery, retrieveMemory, validateMemoryArtifact } from "../../src/lib/goalspec/experience-memory";
import { NativeReadPolicy } from "./native-read-policy";
import { nativeDeterministicCandidates } from "./native-bindings";
import { nativeCandidateGraph, nativeCandidateGraphV5 } from "./native-candidate-graph";
import { GoalSpecSessionV4, type V4SessionPolicy } from "../../src/lib/goalspec/session-v4";
import { LocalController, loadControllerArtifact } from "../../src/lib/goalspec/controller";
import { LocalActionKindController } from "../../src/lib/goalspec/controller-action-kind";
import { predictGoalStateDeltas } from "../../src/lib/goalspec/goal-state-protocol-v4c";
import { GoalSpecSessionV5, type V5SessionPolicy } from "../../src/lib/goalspec/session-v5";
import { LocalControllerV5 } from "../../src/lib/goalspec/controller-v5";

export type ResearchRun = { runId: string; arm: "base" | "neutral" | "paste" | "salesforce" | "goalspec" | "v4" | "literal" | "hypotheses"; domain: "retail" | "airline";
  familyId?: string;
  allocation: Allocation; maxCostMicrodollars: number; maxBoundaries: number; tools: PublicBoundary["tools"]; evaluator?: boolean };
export type ResearchManifest = { schemaVersion: 1; snapshotId: string; recordsPath?: string; heldoutFamilies: string[]; runs: ResearchRun[]; maxDecisions?: number;
  awaitReady?: boolean; runtimeVersion?: "v3" | "v4" | "v5"; memoryPath?: string;
  v5Configuration?: { controllerPath: string; legacyConfigurationPath: string; estimate: V5SessionPolicy["estimate"];
    actorContext: V5SessionPolicy["actorContext"]; goalConditioning: boolean; exposeEvidence: boolean;
    experimentalUncalibratedGoalWeight?: number };
  v4Configuration?: { controllerPath: string; actionKindPath?: string; experiment?: V4SessionPolicy["experiment"];
    estimate: V4SessionPolicy["estimate"] };
  sessionConfiguration?: { eagerWaitMs: number; maxCandidateCalls: number; estimate: AdmissionEstimate } };
const READS = {
  retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"],
  airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"],
};
/** One shared Responses retry policy for every v3 arm and model role.
 * The ModelPort reserves both attempts before dispatch and retains ambiguous
 * usage. Only the audited socket cause can retry, never semantic/model failures.
 * This intentionally overrides the legacy single-attempt call-site default.
 */
export function researchModelWithTransportPolicy(model: ModelPort, v3: boolean): ModelPort {
  return v3 ? { complete: request => model.complete({ ...request, retries: 1, retryableCauseCodes: ["UND_ERR_SOCKET"] }) } : model;
}

export function researchScope(run: Pick<ResearchRun, "domain" | "tools">) {
  return { tenantId: `custom-tau-${run.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
    environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(run.tools) };
}
export async function build(context: BootstrapContext) {
  const manifestPath = process.env.GOALSPEC_MANIFEST_PATH;
  if (!manifestPath) throw new Error("GOALSPEC_MANIFEST_PATH required");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as ResearchManifest;
  return buildResearch(context, manifest);
}
export type ResearchProviderFactory = (...args: Parameters<typeof researchProvider>) => {
  model: ModelPort; embed(text: string): Promise<number[]>;
};
export async function buildResearch({ gateway, ledger, record }: BootstrapContext, manifest: ResearchManifest,
  providerFactory: ResearchProviderFactory = researchProvider) {
  if (manifest.schemaVersion !== 1 || !manifest.snapshotId || !Array.isArray(manifest.runs) || !manifest.runs.length
    || new Set(manifest.runs.map(r => r.runId)).size !== manifest.runs.length) throw new Error("Invalid research manifest");
  const records: Experience[] = manifest.recordsPath ? JSON.parse(readFileSync(resolve(manifest.recordsPath), "utf8")) : [];
  const frozen = new FrozenRepository(manifest.snapshotId, records, manifest.heldoutFamilies);
  const memory = manifest.memoryPath ? validateMemoryArtifact(JSON.parse(readFileSync(resolve(manifest.memoryPath), "utf8"))) : undefined;
  if (memory && memory.repositorySnapshotId !== manifest.snapshotId) throw new Error("Episodic memory snapshot mismatch");
  const v5 = manifest.runtimeVersion === "v5";
  const v4 = manifest.runtimeVersion === "v4" || v5;
  const v3 = manifest.runtimeVersion === "v3" || v4;
  if (v4 && !manifest.v4Configuration?.controllerPath) throw new Error("Frozen v4 controller artifact required");
  if (v4) {
    const estimate = manifest.v4Configuration!.estimate;
    const fields = ["toolMs", "validationMs", "schedulingMs", "predictionMs", "contentionMs", "contextMs", "measuredExposureBenefitMs"];
    if (!estimate || Object.keys(estimate).length !== fields.length || fields.some(field => !Object.hasOwn(estimate, field))
      || Object.values(estimate).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Complete nonnegative v4 utility estimates required");
    const experiment = manifest.v4Configuration!.experiment;
    if (experiment && (!experiment.seed || !Number.isFinite(experiment.exposureProbability) || experiment.exposureProbability <= 0
      || experiment.exposureProbability >= 1 || !Number.isInteger(experiment.maximumStarts) || experiment.maximumStarts < 0
      || experiment.maximumStarts > 12 || (experiment.waitMs !== undefined
        && (!Number.isFinite(experiment.waitMs) || experiment.waitMs < 0 || experiment.waitMs > 250)))) throw new Error("Invalid bounded v4 experiment");
  }
  const controller = v4 ? new LocalController(loadControllerArtifact(JSON.parse(readFileSync(resolve(manifest.v4Configuration!.controllerPath), "utf8")))) : undefined;
  const actionKind = v4 && manifest.v4Configuration!.actionKindPath
    ? new LocalActionKindController(JSON.parse(readFileSync(resolve(manifest.v4Configuration!.actionKindPath), "utf8"))) : undefined;
  if (v5 && (!manifest.v5Configuration || !["none", "literal", "hypotheses"].includes(manifest.v5Configuration.actorContext)
    || typeof manifest.v5Configuration.goalConditioning !== "boolean" || typeof manifest.v5Configuration.exposeEvidence !== "boolean"
    || !manifest.v5Configuration.controllerPath || !manifest.v5Configuration.estimate
    || Object.keys(manifest.v5Configuration.estimate).sort().join(",") !== "contentionMs,contextMs,measuredExposureBenefitMs,predictionMs,schedulingMs,toolMs,validationMs"
    || Object.values(manifest.v5Configuration.estimate).some(value => !Number.isFinite(value) || value < 0)
    || manifest.v5Configuration.experimentalUncalibratedGoalWeight !== undefined
      && (!Number.isFinite(manifest.v5Configuration.experimentalUncalibratedGoalWeight)
        || manifest.v5Configuration.experimentalUncalibratedGoalWeight < 0 || manifest.v5Configuration.experimentalUncalibratedGoalWeight > 1))) throw new Error("Complete v5 configuration required");
  const controllerV5 = v5 ? new LocalControllerV5(JSON.parse(readFileSync(resolve(manifest.v5Configuration!.controllerPath), "utf8"))) : undefined;
  if (!v3 && manifest.runs.some(run => run.arm === "paste" || run.arm === "salesforce")) throw new Error("Paper arms require v3 runtime");
  // Keep the frozen v3 configuration reproducible. V4 starts with zero causal
  // exposure credit and requires an explicit, separately budgeted experiment.
  const sessionConfiguration = manifest.sessionConfiguration ?? { eagerWaitMs: 80, maxCandidateCalls: 6,
    estimate: { toolMs: 0, validationMs: 8.5, schedulingMs: 1, exposedPredictionMs: 0, actorRoundMs: 1000 } };
  if (!Number.isInteger(sessionConfiguration.eagerWaitMs) || sessionConfiguration.eagerWaitMs < 0 || sessionConfiguration.eagerWaitMs > 250
    || !Number.isInteger(sessionConfiguration.maxCandidateCalls) || sessionConfiguration.maxCandidateCalls < 0 || sessionConfiguration.maxCandidateCalls > 12
    || Object.values(sessionConfiguration.estimate).some(value => !Number.isFinite(value) || value < 0)) throw new Error("Invalid v3 session configuration");
  const db = process.env.GOALSPEC_DATABASE_URL ? researchDatabase(process.env.GOALSPEC_DATABASE_URL, process.env.DATABASE_URL) : undefined;
  try {
  let snapshotContentHash: string | undefined;
  if (db) {
    try {
      const snapshots = await db.$queryRaw<{ content_hash: string }[]>`SELECT content_hash FROM goalspec.repository_snapshot WHERE id = ${manifest.snapshotId} AND publication_state = 'frozen'`;
      if (snapshots.length !== 1) throw new Error("Frozen research snapshot unavailable");
      const stored = await db.$queryRaw<{ id: string; familyId: string; text: string; pattern: Experience["pattern"]; split: string }[]>`
        SELECT p.id, e.family_id AS "familyId", p.text_content AS text, p.payload AS pattern, e.split
        FROM goalspec.workflow_pattern p JOIN goalspec.episode e ON e.id = p.episode_id WHERE p.snapshot_id = ${manifest.snapshotId}`;
      const expected = records.map(({ id, familyId, text, pattern, split }) => ({ id, familyId, text, pattern, split }));
      const sort = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => a.id.localeCompare(b.id));
      if (hash(sort(stored)) !== hash(sort(expected))) throw new Error("Published repository differs from frozen manifest");
      snapshotContentHash = snapshots[0].content_hash;
    } catch (error) { await db.$disconnect(); throw error; }
  }
  const repository = db ? new PostgresExperienceRepository(db) : frozen;
  const runs: { runId: string; worker: BoundaryWorker }[] = [];
  // Reserve the complete paired cohort before the first provider call.
  for (const run of manifest.runs) {
    if (!(v5 ? ["base", "neutral", "paste", "salesforce", "goalspec", "v4", "literal", "hypotheses"] : ["base", "neutral", "paste", "salesforce", "goalspec"]).includes(run.arm) || !Object.hasOwn(READS, run.domain)
      || !Object.hasOwn(ALLOCATIONS, run.allocation) || !Number.isInteger(run.maxBoundaries) || run.maxBoundaries < 1
      || typeof run.runId !== "string" || !run.runId.trim() || run.evaluator !== undefined && typeof run.evaluator !== "boolean"
      || !Number.isSafeInteger(run.maxCostMicrodollars) || run.maxCostMicrodollars < 1 || !Array.isArray(run.tools)) throw new Error("Invalid research run");
  }
  const workerIds = manifest.runs.flatMap(run => [run.runId, `${run.runId}:user`, ...(run.evaluator ? [`${run.runId}:evaluator`] : [])]);
  if (new Set(workerIds).size !== workerIds.length) throw new Error("Colliding derived worker IDs");
  ledger.reserveMany(manifest.runs.map(run => ({ id: `trial:${run.runId}`, allocation: run.allocation, maximum: run.maxCostMicrodollars })));
  record({ type: "research_manifest", manifestHash: hash(manifest), snapshotHash: frozen.digest,
    runtimeVersion: v5 ? "goalspec-v5" : v4 ? "goalspec-v4" : v3 ? "goalspec-v3" : "goalspec-v2-background", predictorProtocol: "compact-v2",
    controllerConfiguration: v4 ? manifest.v4Configuration : null,
    ...(v5 ? { v5Configuration: manifest.v5Configuration } : {}),
    memoryHash: memory?.contentHash ?? null, sessionConfiguration: v3 ? sessionConfiguration : null,
    transportPolicy: v3 ? { maximumAttempts: 2, retryableCauseCodes: ["UND_ERR_SOCKET"], sdkRetries: 0,
      unknownReservationRetained: true } : null,
    repositoryBackend: db ? "postgres_pgvector" : "frozen_file", snapshotContentHash: snapshotContentHash ?? null,
    priceSource: PRICE_SOURCE, priceVerified: "2026-09-14", runs: manifest.runs.map(r => ({ id: r.runId, arm: r.arm, allowance: r.maxCostMicrodollars })) });
  for (const run of manifest.runs) {
    const parent = `trial:${run.runId}`;
    const trialLedger = new TrialLedger(ledger, parent, run.allocation);
    const runRecord = (event: unknown) => record({ runId: run.runId, event });
    const provider = providerFactory(trialLedger, run.allocation, runRecord);
    const model = researchModelWithTransportPolicy(provider.model, v3);
    const scope = researchScope(run);
    const reads = new NativeReadExecutor(gateway, run.runId, scope, new Set(READS[run.domain]), v3 ? new NativeReadPolicy(run.domain, scope) : undefined);
    let runtime: ActorRuntime | undefined;
    if (run.arm !== "base") {
      const tools = Object.fromEntries(run.tools.filter(t => (READS[run.domain] as string[]).includes(t.function.name))
        .map(t => [t.function.name, t.function.parameters]));
      const predictors = new ContractPredictors(model, provider.embed,
        tools, run.allocation, maximumCost(RESEARCH_MODELS.goal, 8192, 1024), runRecord, undefined, 0.8,
        v3 && memory && run.arm !== "paste" ? frame => {
          const retrieved = retrieveMemory(frame, memoryQuery(frame), memory);
          runRecord({ type: "memory_retrieval", boundary: frame.boundary, queryHash: retrieved.queryHash,
            artifactHash: retrieved.artifactHash, episodeIds: retrieved.episodeIds,
            transitions: retrieved.transitions.length, recurringConfusions: retrieved.confusions.length });
          return retrieved.hints;
        } : undefined);
      const used: Predictors = run.arm === "neutral" ? {
        inferGoals: async () => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) }),
        embed: q => predictors.embed(q), bindPatterns: (f, r) => predictors.bindPatterns(f, r),
        candidates: (f, r) => predictors.candidates(f, r), calibrated: c => predictors.calibrated(c),
        validateArguments: (c, f) => predictors.validateArguments(c, f),
      } : predictors;
      let boundFrame: Parameters<typeof nativeCandidateGraph>[0] | undefined;
      let bindingProofs = new Map<string, string>();
      const bindV4: V4SessionPolicy["bindCurrent"] = frame => {
        const graph = nativeCandidateGraph(frame, tools, invocation => reads.eligible(invocation));
        boundFrame = frame;
        bindingProofs = new Map(graph.map(candidate => [candidate.id, hash({ invocation: candidate.invocation, bindings: candidate.bindings })]));
        return graph;
      };
      const useV5 = v5 && run.arm !== "v4" && run.arm !== "paste";
      const bindV5: V5SessionPolicy["bindCurrent"] = frame => {
        // Rank the same current-source universe used by v5 training. Policy
        // eligibility remains an independent scheduler admission condition.
        const graph = nativeCandidateGraphV5(frame, tools, () => true);
        boundFrame = frame;
        bindingProofs = new Map(graph.map(candidate => [candidate.id, hash({ invocation: candidate.invocation, bindings: candidate.bindings })]));
        return graph;
      };
      const v5Context = run.arm === "literal" ? "literal" : run.arm === "hypotheses" ? "hypotheses"
        : run.arm === "neutral" || run.arm === "salesforce" ? "none" : manifest.v5Configuration?.actorContext ?? "none";
      const v5Goals = useV5 && !["neutral", "salesforce", "literal"].includes(run.arm) && manifest.v5Configuration!.goalConditioning;
      const session = useV5 ? new GoalSpecSessionV5(frozen, used, new SpeculationScheduler(run.runId, reads, runRecord), runRecord, {
        controller: controllerV5!, memory, actorContext: v5Context, goalConditioning: v5Goals, inferGoals: v5Goals || v5Context === "hypotheses",
        memoryAllowedFamilies: controllerV5!.artifact.lineage.trainingFamilies,
        exposeEvidence: manifest.v5Configuration!.exposeEvidence && v5Context !== "none", query: memoryQuery,
        ...(run.familyId ? { familyId: run.familyId } : {}),
        experimentalUncalibratedGoalWeight: manifest.v5Configuration!.experimentalUncalibratedGoalWeight,
        bindCurrent: bindV5, validateCurrent: (candidate, frame) => (boundFrame?.sources === frame.sources
          && boundFrame.scope === frame.scope && boundFrame.runId === frame.runId && boundFrame.boundary === frame.boundary
          && bindingProofs.get(candidate.id) === hash({ invocation: candidate.invocation, bindings: candidate.bindings }))
          || predictors.validateArguments(candidate, frame),
        nonMutating: invocation => reads.nonMutating(invocation), countTokens,
        inferState: (previous, frame) => predictGoalStateDeltas(model, previous, frame, {
          allocation: run.allocation, maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.goal, 8192, 1024), record: runRecord }),
        estimate: manifest.v5Configuration!.estimate,
      }) : v4 && (run.arm === "goalspec" || run.arm === "v4") ? new GoalSpecSessionV4(frozen, used,
        new SpeculationScheduler(run.runId, reads, runRecord), runRecord, {
          controller, actionKind, inferGoals: true, exposeEvidence: true, query: memoryQuery,
          bindCurrent: bindV4,
          validateCurrent: (candidate, frame) => boundFrame === frame
            && bindingProofs.get(candidate.id) === hash({ invocation: candidate.invocation, bindings: candidate.bindings }),
          nonMutating: invocation => reads.nonMutating(invocation), countTokens,
          inferState: (previous, frame) => predictGoalStateDeltas(model, previous, frame, {
            allocation: run.allocation, maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.goal, 8192, 1024), record: runRecord }),
          estimate: manifest.v4Configuration!.estimate, experiment: manifest.v4Configuration!.experiment,
        }) : new GoalSpecSession(v3 ? frozen : repository, used, new SpeculationScheduler(run.runId, reads, runRecord), runRecord,
        v3 ? { version: "v3", exposeEvidence: run.arm === "goalspec", inferGoals: run.arm === "goalspec",
          predictCandidates: run.arm !== "paste", query: memoryQuery,
          bindCurrent: run.arm === "goalspec" ? frame => nativeDeterministicCandidates(frame, tools, invocation => reads.eligible(invocation)) : undefined,
          nonMutating: invocation => reads.nonMutating(invocation),
          ...sessionConfiguration } : undefined);
      runtime = run.arm === "neutral" && !v5 ? {
        scheduler: session.scheduler, close: () => session.close(), async boundary(frame, relevant) {
          const result = await session.boundary(frame, relevant);
          return { ...result, actorContext: result.actorContext.slice(result.actorContext.indexOf("[VERIFIED PREFETCHED EVIDENCE]")) };
        },
      } : session;
    }
    const actor = new NativeBoundaryWorker({ runId: run.runId, scope, snapshotId: manifest.snapshotId,
      allocation: run.allocation, maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.actor, 32768, 4096), maxBoundaries: run.maxBoundaries }, model, runRecord, runtime, runtime ? reads : undefined);
    let closes = 0;
    const finish = () => { if (++closes === (run.evaluator ? 3 : 2)) ledger.finishParent(parent); };
    let actorClosed = false, userClosed = false;
    runs.push({ runId: run.runId, worker: { decision: (b, id) => actor.decision(b, id), async close() { if (!actorClosed) { actorClosed = true; await actor.close(); finish(); } } } });
    let userCalls = 0;
    runs.push({ runId: `${run.runId}:user`, worker: {
      async decision(boundary, boundaryId) {
        if (userClosed || userCalls++ >= run.maxBoundaries) throw new Error("User step budget exhausted");
        if (boundary.tools.length || countTokens(canonical(boundary)) > 8192 - 128) throw new Error("User context budget or tool contract violated");
        const result = await model.complete({ id: `${boundaryId}:user`, model: RESEARCH_MODELS.user,
          input: boundary.messages.map(m => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const, content: m.content ?? "" })),
          instructions: boundary.policy, maxOutputTokens: 1024, allocation: run.allocation,
          maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.user, 8192, 1024), retries: 0 });
        if (result.calls.length || result.refusals.length) throw new Error("Invalid user simulator response");
        return { role: "user", content: result.text, usage: result.usage };
      }, async close() { if (!userClosed) { userClosed = true; finish(); } },
    } });
    if (run.evaluator) {
      let evaluatorClosed = false, evaluatorCalls = 0;
      runs.push({ runId: `${run.runId}:evaluator`, worker: {
        async decision(boundary, boundaryId) {
          if (evaluatorClosed || evaluatorCalls++ >= run.maxBoundaries) throw new Error("Evaluator step budget exhausted");
          if (boundary.tools.length || boundary.messages.some(message => !["user", "assistant"].includes(message.role))
            || countTokens(canonical(boundary)) > 32768 - 128) throw new Error("Evaluator context budget or contract violated");
          const result = await model.complete({ id: `${boundaryId}:evaluator`, model: RESEARCH_MODELS.teacher,
            input: boundary.messages.map(message => ({ role: message.role as "user" | "assistant", content: message.content ?? "" })),
            instructions: boundary.policy, maxOutputTokens: 4096, allocation: run.allocation,
            maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.teacher, 32768, 4096), retries: 0 });
          if (result.calls.length || result.refusals.length) throw new Error("Invalid independent evaluator response");
          return { role: "assistant", content: result.text, usage: result.usage };
        }, async close() { if (!evaluatorClosed) { evaluatorClosed = true; finish(); } },
      } });
    }
  }
  return { runs, concurrency: 3, ready: manifest.awaitReady ? async () => { await gateway.request("/ready", { manifestHash: hash(manifest) }); } : undefined,
    close: async () => { await db?.$disconnect(); },
    maxDecisions: manifest.maxDecisions ?? manifest.runs.reduce((sum, run) => sum + (run.maxBoundaries + 1) * (run.evaluator ? 3 : 2), 0) };
  } catch (error) { await db?.$disconnect(); throw error; }
}
