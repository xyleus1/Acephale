import { PrismaClient, type Prisma } from "@prisma/client";
import { copy, hash } from "../goalspec/canonical";
import type { Invocation } from "../goalspec/contracts/generated";
import { ReadAuthorizationDeniedError, type Observation, type ReadExecutor, type ReadValidation } from "../goalspec/scheduler";
import { captureEpochSnapshot, epochReceiptMatches, epochsEqual, validateEpochOptions, type DeryaEpochOptions, type EpochSnapshot } from "./derya-epochs";

export const DERYA_READ_TOOLS = ["search_jobs", "search_inquiries", "search_companies", "get_job", "list_open_inquiries"] as const;
export type DeryaReadTool = typeof DERYA_READ_TOOLS[number];
export type ScopedProjection = (tx: Prisma.TransactionClient, name: DeryaReadTool, input: Invocation["arguments"], officeId: string, access?: { companyOwnerId?: string }) => Promise<Observation>;
export type DeryaReadPrincipal = { userId?: string; officeId: string; accessKind?: string };
export type DeryaToolResult = { ok: true; result: Observation } | { ok: false; error: string };
export function deryaToolResult(observation: Observation): DeryaToolResult {
  if (observation && typeof observation === "object" && !Array.isArray(observation)) {
    if (observation.ok === true && "result" in observation) return { ok: true, result: observation.result };
    if (observation.ok === false && typeof observation.error === "string") return { ok: false, error: observation.error };
  }
  throw new Error("Audited Derya projection returned an invalid tool envelope");
}
const transactionOptions = { isolationLevel: "RepeatableRead" as const, timeout: 4_500, maxWait: 500 };

export async function authorizeDeryaRead(tx: Prisma.TransactionClient, principal: DeryaReadPrincipal, expectedAuthorization?: string) {
  if (!principal.userId || (principal.accessKind !== undefined && principal.accessKind !== "operator")) throw new ReadAuthorizationDeniedError("Derya operator read denied");
  const user = await tx.user.findFirst({ where: { id: principal.userId, officeId: principal.officeId, isActive: true },
    select: { id: true, officeId: true, role: true, canViewWholeOffice: true } });
  if (!user || (expectedAuthorization !== undefined && (!user.canViewWholeOffice || hash(user) !== expectedAuthorization))) {
    throw new ReadAuthorizationDeniedError("Authorization changed");
  }
  return user;
}

// Ordinary tool calls and speculation use the same projection/ownership checks.
// Scoped company visibility follows global-search.ts; loads and RFQs retain its
// office-wide operator policy. Scoped reads never participate in epoch reuse.
export async function readDeryaAuthoritative(db: PrismaClient, projection: ScopedProjection, name: DeryaReadTool,
  input: Invocation["arguments"], principal: DeryaReadPrincipal): Promise<DeryaToolResult> {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const user = await authorizeDeryaRead(tx, principal);
    const wholeOffice = user.canViewWholeOffice || user.role === "ADMIN" || user.role === "MANAGER";
    return deryaToolResult(await projection(tx, name, input, principal.officeId, wholeOffice ? undefined : { companyOwnerId: user.id }));
  }, transactionOptions);
}
class EpochUnavailableError extends Error {}

// Use a dedicated read connection so every physical SQL query, including Prisma
// relation hydration and authorization, has its own latency/count event.
export function auditedDeryaConnection(url: string, record: (event: { type: string; durationMs: number }) => void) {
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: "event", level: "query" }] });
  client.$on("query", event => record({ type: "physical_sql_query", durationMs: event.duration }));
  return client;
}

// This wrapper never calls dispatchTool, inspect_brain, or cache/extraction helpers.
// The supplied projection must be the reviewed complete tool projection.
export class DeryaReadExecutor implements ReadExecutor {
  private snapshots = new Map<string, { epoch: EpochSnapshot; observationHash: string }>();
  private epochProofFailed = false;
  constructor(private db: PrismaClient, private projection: ScopedProjection, private schemaHash: string,
    private environmentVersion: string, private principal: { id: string; officeId: string; accessKind: string },
    private recordQuery: (kind: string, latencyMs: number) => void, private epochs: DeryaEpochOptions = { mode: "off" }) {
    validateEpochOptions(epochs);
    this.epochs = copy(epochs);
    this.principal = { ...principal };
  }
  eligible(i: Invocation) {
    return this.principal.accessKind === "operator" && i.scope.tenantId === this.principal.officeId
      && i.scope.principalId === this.principal.id && i.scope.toolSchemaHash === this.schemaHash
      && i.scope.environmentVersion === this.environmentVersion && (DERYA_READ_TOOLS as readonly string[]).includes(i.tool);
  }
  private async observe(i: Invocation, signal: AbortSignal, kind: string, previous?: Observation): Promise<Observation> {
    if (!this.eligible(i)) throw new ReadAuthorizationDeniedError("Derya read denied");
    if (signal.aborted) throw new Error("Read cancelled");
    const started = Date.now();
    try {
      const observe = (checkEpoch: boolean) => this.db.$transaction(async tx => {
        // First SQL statement fixes transaction characteristics before any query.
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await authorizeDeryaRead(tx, { userId: i.scope.principalId, officeId: i.scope.tenantId, accessKind: this.principal.accessKind }, i.scope.authorizationVersion);
        if (signal.aborted) throw new Error("Read cancelled");
        let epoch: EpochSnapshot | undefined;
        if (checkEpoch) {
          try { epoch = await captureEpochSnapshot(tx); }
          catch { throw new EpochUnavailableError("Epoch coverage unavailable"); }
        }
        const key = hash(i), prior = this.snapshots.get(key);
        const matches = previous !== undefined && epoch && prior && prior.observationHash === hash(previous)
          && epochsEqual(prior.epoch, epoch, i.tool as DeryaReadTool);
        if (matches && epoch && !this.epochProofFailed && epochReceiptMatches(this.epochs, epoch, i.tool as DeryaReadTool)) {
          this.recordQuery("epoch_verified_reuse", Date.now() - started);
          return { observation: previous, epoch };
        }
        const observation = await this.projection(tx, i.tool as DeryaReadTool, i.arguments, i.scope.tenantId);
        if (checkEpoch && previous !== undefined) {
          // Shadow always executes the entire projection. Counter agreement and
          // result agreement are separate measurable claims.
          this.recordQuery(!epoch ? "epoch_coverage_unavailable" : matches
            ? (hash(observation) === hash(previous) ? "epoch_shadow_equal" : "epoch_shadow_mismatch") : "epoch_changed", Date.now() - started);
          if (matches && hash(observation) !== hash(previous)) { this.snapshots.clear(); this.epochProofFailed = true; }
        }
        return { observation, epoch };
      }, transactionOptions);
      let result: { observation: Observation; epoch?: EpochSnapshot };
      try { result = await observe(!!this.epochs.mode && this.epochs.mode !== "off"); }
      catch (error) {
        if (!(error instanceof EpochUnavailableError)) throw error;
        this.recordQuery("epoch_coverage_unavailable", Date.now() - started);
        result = await observe(false); // A failed SQL transaction cannot be reused.
      }
      if (signal.aborted) throw new Error("Read cancelled");
      if (result.epoch) this.snapshots.set(hash(i), { epoch: result.epoch, observationHash: hash(result.observation) });
      else this.snapshots.delete(hash(i));
      if (this.snapshots.size > 32) this.snapshots.delete(this.snapshots.keys().next().value!);
      return result.observation;
    } finally { this.recordQuery(kind, Date.now() - started); }
  }
  read(i: Invocation, signal: AbortSignal) { return this.observe(i, signal, "speculative_transaction"); }
  validate(i: Invocation, previous: Observation, signal: AbortSignal) { return this.observe(i, signal, "validation_transaction", previous); }
  async validateFreshness(i: Invocation, previous: Observation, signal: AbortSignal): Promise<ReadValidation> {
    try { return { status: "verified", observation: await this.validate(i, previous, signal) }; }
    catch (error) {
      return error instanceof ReadAuthorizationDeniedError ? { status: "denied", reason: error.message }
        : { status: "stale", reason: "Fresh observation unavailable" };
    }
  }
}

export function requireSuccessfulProof(proof: { checked: boolean; blocked: boolean; valid?: boolean }) {
  if (!proof.checked || proof.blocked || proof.valid !== true) throw new Error("Successful action validation required");
}
