import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import Ajv from "ajv";
import { copy, hash } from "../goalspec/canonical";
import type { ExecutionFrame, GoalSet, Scope } from "../goalspec/contracts/generated";
import { validateContract } from "../goalspec/contracts/validate";
import { InfraSession, type InfraSessionPolicy } from "../goalspec/infra-session";
import { ReadAuthorizationDeniedError, SpeculationScheduler, type ReadExecutor } from "../goalspec/scheduler";
import type { FrozenRepository } from "../goalspec/repository";
import { validateBusinessSnapshot, type DeryaBusinessSnapshot } from "./derya-bootstrap";
import { installDeryaGoalSpec, type ChatIdentity, type DeryaManagedRuntime, type DeryaRuntimeFactory } from "./derya-chat";
import { auditedDeryaConnection, authorizeDeryaRead, DeryaReadExecutor, DERYA_READ_TOOLS, type ScopedProjection } from "./derya-read-executor";
import { deryaProjection } from "./derya-projections";

export interface DeryaInfraConfiguration {
  databaseUrl: string;
  environmentVersion: string;
  tools: Record<string, Record<string, unknown>>;
  snapshot(scope: Scope): Promise<DeryaBusinessSnapshot | undefined>;
  policy(context: {
    runId: string; scope: Scope; snapshot: DeryaBusinessSnapshot;
    repository: FrozenRepository; tools: Record<string, Record<string, unknown>>;
    record(event: Record<string, unknown>): void;
  }): InfraSessionPolicy | Promise<InfraSessionPolicy>;
  record(event: Record<string, unknown>): void;
}

/** Trusted server composition and test injection only, never chat parameters. */
export interface DeryaInfraDependencies {
  connection: typeof auditedDeryaConnection;
  projection: ScopedProjection;
  install: typeof installDeryaGoalSpec;
}
const defaultDependencies: DeryaInfraDependencies = {
  connection: auditedDeryaConnection, projection: deryaProjection, install: installDeryaGoalSpec,
};
const transactionOptions = { isolationLevel: "RepeatableRead" as const, timeout: 4500, maxWait: 500 };
const emptyGoals = (): GoalSet => ({ schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) });

/**
 * Installs the lossless infrastructure profile into the existing generic chat loop.
 * The existing actor is untouched. No import or default environment flag enables it.
 */
export function configureDeryaInfra(configuration: DeryaInfraConfiguration,
  overrides: Partial<DeryaInfraDependencies> = {}) {
  const url = new URL(configuration.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !configuration.environmentVersion) throw new Error("Invalid Derya infrastructure configuration");
  const dependencies = { ...defaultDependencies, ...overrides };
  const tools = copy(configuration.tools);
  if (!Object.keys(tools).length || Object.keys(tools).some(name => !(DERYA_READ_TOOLS as readonly string[]).includes(name))) throw new Error("Only audited Derya read schemas are allowed");
  const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true });
  const validators = new Map(Object.entries(tools).map(([name, schema]) => [name, ajv.compile(schema)]));
  const schemaHash = hash(tools), environmentVersion = configuration.environmentVersion, databaseUrl = configuration.databaseUrl;
  let db: PrismaClient | undefined, closed = false, telemetryFailed = false;
  let closing: Promise<void> | undefined;
  const sessions = new Set<DeryaManagedRuntime>();
  const creating = new Set<ReturnType<DeryaRuntimeFactory>>();
  const record = (event: Record<string, unknown>) => {
    // Do not let an observability failure interrupt cancellation or physical drain.
    try { configuration.record(event); } catch { telemetryFailed = true; }
  };

  async function create(inputIdentity: ChatIdentity): ReturnType<DeryaRuntimeFactory> {
    const identity = { ...inputIdentity };
    if (closed || telemetryFailed || identity.accessKind !== "operator" || !identity.canViewWholeOffice
      || !identity.userId || !identity.officeId) return;
    db ??= dependencies.connection(databaseUrl, record);
    const client = db;
    const currentUser = (authorization?: string) => client.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const user = await authorizeDeryaRead(tx, { userId: identity.userId, officeId: identity.officeId, accessKind: "operator" }, authorization);
      if (!user.canViewWholeOffice) throw new ReadAuthorizationDeniedError("Office-wide operator access required");
      return user;
    }, transactionOptions);
    let user: Awaited<ReturnType<typeof currentUser>>;
    try { user = await currentUser(); }
    catch (error) { if (error instanceof ReadAuthorizationDeniedError) return; throw error; }
    if (closed || telemetryFailed) return;
    const scope: Scope = { tenantId: user.officeId, principalId: user.id, authorizationVersion: hash(user),
      environmentVersion, toolSchemaHash: schemaHash };
    const loaded = await configuration.snapshot(copy(scope));
    if (closed || telemetryFailed || !loaded) return;
    const snapshot = copy(loaded), repository = validateBusinessSnapshot(snapshot, scope);
    const runId = `derya-infra:${randomUUID()}`;
    const runRecord = (event: Record<string, unknown>) => record({ ...event, runId });
    const policy = await configuration.policy({ runId, scope: copy(scope), snapshot: copy(snapshot), repository,
      tools: copy(tools), record: runRecord });
    if (closed || telemetryFailed) return;
    if (policy.memoryHash !== repository.digest) throw new Error("Derya infrastructure memory must match the verified business snapshot");
    let unavailable = false, stopping: Promise<void> | undefined, innerClosing: Promise<void> | undefined;
    const healthy = () => !closed && !telemetryFailed && !unavailable && !stopping;
    const audited = new DeryaReadExecutor(client, dependencies.projection, schemaHash, environmentVersion,
      { id: user.id, officeId: user.officeId, accessKind: "operator" },
      (type, latencyMs) => runRecord({ type, latencyMs }), { mode: "off" });
    const allowed = (invocation: Parameters<ReadExecutor["eligible"]>[0]) => healthy()
      && hash(invocation.scope) === hash(scope) && audited.eligible(invocation)
      && (validators.get(invocation.tool)?.(invocation.arguments) ?? false);
    const executor: ReadExecutor = {
      eligible: allowed,
      async read(invocation, signal) {
        if (!allowed(invocation)) throw new ReadAuthorizationDeniedError("Derya infrastructure read unavailable");
        const result = await audited.read(invocation, signal);
        if (!healthy()) throw new ReadAuthorizationDeniedError("Derya infrastructure became unavailable");
        return result;
      },
      async validate(invocation, previous, signal) {
        if (!allowed(invocation)) throw new ReadAuthorizationDeniedError("Derya infrastructure validation unavailable");
        const result = await audited.validate(invocation, previous, signal);
        if (!healthy()) throw new ReadAuthorizationDeniedError("Derya infrastructure became unavailable");
        return result;
      },
      async validateFreshness(invocation, previous, signal) {
        if (!allowed(invocation)) return { status: "denied", reason: "Derya infrastructure validation unavailable" };
        const result = await audited.validateFreshness(invocation, previous, signal);
        return healthy() ? result : { status: "denied", reason: "Derya infrastructure became unavailable" };
      },
    };
    const scheduler = new SpeculationScheduler(runId, executor, event => runRecord(event));
    const inner = new InfraSession(scheduler, { ...policy }, runRecord);
    const closeInner = () => innerClosing ??= inner.close();
    // Generic chat calls scheduler.mutationBatch. Route that entry through the
    // session's prediction fence while the session retains the raw scheduler.
    const chatScheduler = new Proxy(scheduler, {
      get(target, property) {
        if (property === "mutationBatch") return inner.mutationBatch.bind(inner);
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const decisions = new Set<ReturnType<DeryaManagedRuntime["boundary"]>>();
    let lastBoundary = -1;
    const runtime: DeryaManagedRuntime = {
      scheduler: chatScheduler,
      actorContextMode: "current-only",
      settlePredictions: () => inner.settled(),
      boundary(input: ExecutionFrame, _relevant: string[]) {
        const checkpoint = copy(input);
        const pending = (async () => {
          if (!healthy()) throw new Error("Derya infrastructure unavailable");
          if (decisions.size) throw new Error("A Derya infrastructure checkpoint is already active");
          validateContract("ExecutionFrame", checkpoint);
          if (checkpoint.runId !== runId || checkpoint.snapshotId !== snapshot.snapshotId || hash(checkpoint.scope) !== hash(scope)
            || checkpoint.boundary <= lastBoundary) throw new Error("Derya infrastructure checkpoint identity changed");
          lastBoundary = checkpoint.boundary;
          try { await currentUser(scope.authorizationVersion); }
          catch (error) { unavailable = true; await closeInner(); throw error; }
          if (!healthy()) throw new Error("Derya infrastructure unavailable");
          const frame = copy({ ...checkpoint, goals: emptyGoals() });
          inner.observe(frame);
          // Predictions and prefetched results never enter this actor's prompt.
          return { frame, evidence: [], actorContext: "" };
        })();
        decisions.add(pending);
        void pending.then(() => decisions.delete(pending), () => decisions.delete(pending));
        return pending;
      },
      close() {
        if (stopping) return stopping;
        unavailable = true;
        const drain = closeInner();
        stopping = (async () => {
          try { await Promise.allSettled([...decisions]); await drain; }
          finally { sessions.delete(runtime); }
        })();
        return stopping;
      },
    };
    sessions.add(runtime);
    const frame: ExecutionFrame = { schemaVersion: 1, runId, boundary: 0, scope, snapshotId: snapshot.snapshotId,
      requestedObjective: "", policy: "", sources: { _binding_events: [], _signatures: [] }, goals: emptyGoals() };
    runRecord({ type: "derya_infra_runtime_created", snapshotHash: repository.digest, schemaHash,
      actorModel: "existing_gpt-5.6", actorContext: "none", exposeEvidence: false, fullProjectionRevalidation: true });
    return { runtime, frame };
  }
  const factory: DeryaRuntimeFactory = identity => {
    const task = create(identity); creating.add(task);
    void task.then(() => creating.delete(task), () => creating.delete(task));
    return task;
  };
  const uninstall = dependencies.install(factory);
  return {
    close() {
      if (closing) return closing;
      closed = true; uninstall();
      closing = (async () => {
        await Promise.allSettled([...creating]);
        await Promise.allSettled([...sessions].map(session => session.close()));
        await db?.$disconnect();
      })();
      return closing;
    },
  };
}
