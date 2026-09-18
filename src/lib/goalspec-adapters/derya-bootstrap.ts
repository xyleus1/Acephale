import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { copy, hash } from "../goalspec/canonical";
import type { ExecutionFrame, Scope } from "../goalspec/contracts/generated";
import type { ModelPort } from "../goalspec/model";
import type { Allocation } from "../goalspec/budget";
import { ContractPredictors, countTokens } from "../goalspec/predictors";
import { FrozenRepository, type Experience } from "../goalspec/repository";
import { GoalSpecSessionV4, type V4SessionPolicy } from "../goalspec/session-v4";
import { LocalController, type ControllerArtifact } from "../goalspec/controller";
import { LocalActionKindController, type ActionKindArtifact } from "../goalspec/controller-action-kind";
import { bindCurrentSources } from "../goalspec/current-bindings";
import { predictGoalStateDeltas } from "../goalspec/goal-state-protocol-v4c";
import { SpeculationScheduler } from "../goalspec/scheduler";
import { installDeryaGoalSpec, type ChatIdentity, type DeryaRuntimeFactory } from "./derya-chat";
import { auditedDeryaConnection, DeryaReadExecutor, DERYA_READ_TOOLS } from "./derya-read-executor";
import { deryaProjection } from "./derya-projections";
import { GoalSpecSessionV5, type V5SessionPolicy } from "../goalspec/session-v5";
import { LocalControllerV5, type ControllerV5Artifact } from "../goalspec/controller-v5";
import type { FrozenExperienceMemory } from "../goalspec/experience-memory";
import type { DeryaEpochOptions } from "./derya-epochs";
import type { DeryaManagedRuntime } from "./derya-chat";

export interface DeryaBusinessSnapshot {
  schemaVersion: 1;
  purpose: "derya_business";
  source: "derya_native_verified";
  snapshotId: string;
  tenantId: string;
  records: Experience[];
  recordsHash: string;
}

export interface DeryaBootstrapConfiguration {
  // Trusted server composition only. The existing actor remains gpt-5.6;
  // this model port is exclusively for the pinned miniature predictors.
  databaseUrl: string;
  environmentVersion: string;
  tools: Record<string, Record<string, unknown>>;
  model: ModelPort;
  embed: (query: string) => Promise<number[]>;
  snapshot: (scope: Scope) => Promise<DeryaBusinessSnapshot | undefined>;
  record: (event: Record<string, unknown>) => void;
  maximumPredictionAttemptMicrodollars: number;
  allocation: Allocation;
  calibrationThreshold?: number;
  controllerArtifact?: ControllerArtifact;
  actionKindArtifact?: ActionKindArtifact;
  utilityEstimate?: V4SessionPolicy["estimate"];
  epochOptions?: DeryaEpochOptions;
  v5?: { controllerArtifact: ControllerV5Artifact; memory?: FrozenExperienceMemory;
    actorContext: V5SessionPolicy["actorContext"]; goalConditioning: boolean; exposeEvidence: boolean };
}

export function validateBusinessSnapshot(snapshot: DeryaBusinessSnapshot, scope: Scope) {
  if (snapshot.schemaVersion !== 1 || snapshot.purpose !== "derya_business"
    || snapshot.source !== "derya_native_verified" || snapshot.tenantId !== scope.tenantId
    || !snapshot.snapshotId || snapshot.recordsHash !== hash(snapshot.records)) {
    throw new Error("Unverified or foreign business snapshot");
  }
  for (const row of snapshot.records) {
    if (row.pattern.verificationTier !== "native_verified" || hash(row.pattern.scope) !== hash(scope)
      || row.pattern.snapshotId !== snapshot.snapshotId || row.split !== "train") {
      throw new Error("Business workflow scope or verification mismatch");
    }
  }
  return new FrozenRepository(snapshot.snapshotId, snapshot.records);
}

// Call once from trusted application server composition. The registered factory
// is already consumed by agent-chat's generic loop. Connections are created only
// on the first authorized operator request, never while importing the module.
export function configureDeryaGoalSpec(configuration: DeryaBootstrapConfiguration) {
  const url = new URL(configuration.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !configuration.environmentVersion
    || !Number.isSafeInteger(configuration.maximumPredictionAttemptMicrodollars)
    || configuration.maximumPredictionAttemptMicrodollars < 1) throw new Error("Invalid Derya GoalSpec server configuration");
  const tools = copy(configuration.tools);
  if (!Object.keys(tools).length || Object.keys(tools).some(name => !(DERYA_READ_TOOLS as readonly string[]).includes(name))) {
    throw new Error("Only audited Derya read schemas may be configured");
  }
  const threshold = configuration.calibrationThreshold ?? .8;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Invalid calibration threshold");
  const schemaHash = hash(tools);
  let db: PrismaClient | undefined;
  let closed = false;
  let telemetryFailed = false;
  let closing: Promise<void> | undefined;
  const sessions = new Set<DeryaManagedRuntime>();
  const creating = new Set<Promise<Awaited<ReturnType<DeryaRuntimeFactory>>>>();
  // A sink failure cannot interrupt scheduler accounting, cancellation or drain.
  // Mark the bootstrap unhealthy and fail closed at the next decision instead.
  const record = (event: Record<string, unknown>) => {
    try { configuration.record(event); } catch { telemetryFailed = true; }
  };
  async function create(identity: ChatIdentity): ReturnType<DeryaRuntimeFactory> {
    if (closed || telemetryFailed || identity.accessKind !== "operator" || !identity.canViewWholeOffice) return;
    db ??= auditedDeryaConnection(configuration.databaseUrl, record);
    const client = db;
    const user = await client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return tx.user.findFirst({ where: { id: identity.userId, officeId: identity.officeId, isActive: true },
        select: { id: true, officeId: true, role: true, canViewWholeOffice: true } });
    }, { isolationLevel: "RepeatableRead", timeout: 4_500, maxWait: 500 });
    if (closed || telemetryFailed || !user?.canViewWholeOffice) return;
    const scope: Scope = { tenantId: user.officeId, principalId: user.id, authorizationVersion: hash(user),
      environmentVersion: configuration.environmentVersion, toolSchemaHash: schemaHash };
    const snapshot = await configuration.snapshot(copy(scope));
    if (closed || telemetryFailed || !snapshot) return;
    const repository = validateBusinessSnapshot(snapshot, scope);
    const runId = `derya:${randomUUID()}`;
    const runRecord = (event: unknown) => record({ ...(event as Record<string, unknown>), runId });
    const executor = new DeryaReadExecutor(client, deryaProjection, schemaHash, configuration.environmentVersion,
      { id: user.id, officeId: user.officeId, accessKind: "operator" },
      (type, latencyMs) => runRecord({ type, latencyMs }), configuration.epochOptions);
    const predictors = new ContractPredictors(configuration.model, configuration.embed, tools,
      configuration.allocation, configuration.maximumPredictionAttemptMicrodollars, runRecord,
      undefined, threshold);
    const scheduler = new SpeculationScheduler(runId, executor, runRecord);
    const common: Omit<V4SessionPolicy, "controller" | "actionKind"> = {
      inferGoals: true, exposeEvidence: true, query: frame => frame.requestedObjective,
      bindCurrent: frame => bindCurrentSources(frame, tools), nonMutating: invocation => Object.hasOwn(tools, invocation.tool),
      countTokens, inferState: (previous, frame) => predictGoalStateDeltas(configuration.model, previous, frame, {
        allocation: configuration.allocation, maximumAttemptMicrodollars: configuration.maximumPredictionAttemptMicrodollars, record: runRecord }),
      estimate: configuration.utilityEstimate ?? { toolMs: 0, validationMs: 0, schedulingMs: 1, predictionMs: 0,
        contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 },
    };
    const inner = configuration.v5 ? new GoalSpecSessionV5(repository, predictors, scheduler, runRecord, {
      ...common, controller: new LocalControllerV5(configuration.v5.controllerArtifact), memory: configuration.v5.memory,
      actorContext: configuration.v5.actorContext, goalConditioning: configuration.v5.goalConditioning,
      inferGoals: configuration.v5.goalConditioning || configuration.v5.actorContext === "hypotheses",
      exposeEvidence: configuration.v5.exposeEvidence,
    }) : new GoalSpecSessionV4(repository, predictors, scheduler, runRecord, { ...common,
      controller: configuration.controllerArtifact ? new LocalController(configuration.controllerArtifact) : undefined,
      actionKind: configuration.actionKindArtifact ? new LocalActionKindController(configuration.actionKindArtifact) : undefined });
    const decisions = new Set<Promise<Awaited<ReturnType<GoalSpecSessionV4["boundary"]>>>>();
    let stopping: Promise<void> | undefined;
    const runtime: DeryaManagedRuntime = {
      scheduler, actorContextMode: configuration.v5 ? "current-only" : "legacy",
      settlePredictions: () => inner.settlePredictions(),
      boundary(frame: ExecutionFrame, relevant: string[]) {
        const pending = (async () => {
          if (closed || telemetryFailed || stopping) throw new Error("Derya GoalSpec bootstrap unavailable");
          const current = await client.$transaction(async tx => {
            await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
            return tx.user.findFirst({ where: { id: user!.id, officeId: user!.officeId, isActive: true },
              select: { id: true, officeId: true, role: true, canViewWholeOffice: true } });
          }, { isolationLevel: "RepeatableRead", timeout: 4_500, maxWait: 500 });
          if (!current?.canViewWholeOffice || hash(current) !== scope.authorizationVersion) throw new Error("Derya GoalSpec authorization changed");
          if (closed || telemetryFailed || stopping) throw new Error("Derya GoalSpec bootstrap unavailable");
          return inner.boundary(frame, relevant);
        })();
        decisions.add(pending);
        void pending.then(() => decisions.delete(pending), () => decisions.delete(pending));
        return pending;
      },
      close() {
        stopping ??= (async () => {
          try {
            await Promise.allSettled([...decisions]);
            await inner.close();
          } finally { sessions.delete(runtime); }
        })();
        return stopping;
      },
    };
    sessions.add(runtime);
    const frame: ExecutionFrame = { schemaVersion: 1, runId, boundary: 0, scope,
      snapshotId: snapshot.snapshotId, requestedObjective: "", policy: "",
      sources: { _binding_events: [], _signatures: [] },
      goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
    runRecord({ type: "derya_runtime_created", snapshotHash: repository.digest, schemaHash });
    return { runtime, frame };
  }
  const factory: DeryaRuntimeFactory = identity => {
    const pending = create(identity);
    creating.add(pending);
    void pending.then(() => creating.delete(pending), () => creating.delete(pending));
    return pending;
  };
  const uninstall = installDeryaGoalSpec(factory);
  return {
    close() {
      if (closing) return closing;
      closed = true;
      uninstall();
      closing = (async () => {
        await Promise.allSettled([...creating]);
        await Promise.allSettled([...sessions].map(session => session.close()));
        await db?.$disconnect();
      })();
      return closing;
    },
  };
}
