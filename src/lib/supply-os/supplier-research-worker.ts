import "server-only";

import type { Prisma } from "@prisma/client";
import {
  searchComponentSuppliers,
  supplierResearchError,
} from "./component-supplier-research";
import {
  parseSupplierResearchRouteBody,
  type SupplierResearchRouteInput,
} from "./supplier-research-route-contract";
import {
  claimSourcingResearchRun,
  completeSourcingResearchRun,
  failSourcingResearchRun,
  failStaleRunningSourcingResearchRuns,
  listQueuedSourcingResearchRuns,
  type ClaimSourcingResearchRunResult,
  type QueuedSourcingResearchRunReference,
} from "./sourcing-research-persistence";
import type { SupplierResearchProvider } from "./supplier-research-contract";

type SupplierResearchWorkerResult =
  | { state: "succeeded"; runId: string }
  | { state: "failed"; runId: string; code: string }
  | { state: "skipped"; runId: string };

export type SupplierResearchQueryVariant = "exact-identity" | "official-catalog" | "capability-qa";

export type SupplierResearchWorkerDependencies = {
  claimRun: (reference: QueuedSourcingResearchRunReference) => Promise<ClaimSourcingResearchRunResult>;
  search: (input: SupplierResearchRouteInput & {
    officeId: string;
    workspaceId: string;
    queryVariant?: SupplierResearchQueryVariant;
    queryCycle?: number;
    excludeDomains?: string[];
    requiredProvider?: SupplierResearchProvider;
  }) => Promise<unknown>;
  completeRun: typeof completeSourcingResearchRun;
  failRun: typeof failSourcingResearchRun;
  supplierFailure: typeof supplierResearchError;
};

const defaultDependencies: SupplierResearchWorkerDependencies = {
  claimRun: claimSourcingResearchRun,
  search: (input) => searchComponentSuppliers({
    ...input,
    manufacturer: input.manufacturer ?? undefined,
    mpn: input.mpn ?? undefined,
    specification: input.specification ?? undefined,
    targetCountry: input.targetCountry ?? undefined,
    requestedQuantity: input.requestedQuantity ?? undefined,
    requestedUnit: input.requestedUnit ?? undefined,
    sourceRegion: input.sourceRegion ?? undefined,
    deliveryLocation: input.deliveryLocation ?? undefined,
    needByDate: input.needByDate ?? undefined,
  }),
  completeRun: completeSourcingResearchRun,
  failRun: failSourcingResearchRun,
  supplierFailure: supplierResearchError,
};

function trustedQueryVariant(input: Prisma.JsonValue): SupplierResearchQueryVariant | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = (input as Prisma.JsonObject).queryVariant;
  return value === "exact-identity" || value === "official-catalog" || value === "capability-qa"
    ? value
    : undefined;
}

function trustedExploration(input: Prisma.JsonValue) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const row = input as Prisma.JsonObject;
  const queryCycle = typeof row.queryCycle === "number" && Number.isInteger(row.queryCycle) && row.queryCycle >= 0 && row.queryCycle <= 2
    ? row.queryCycle
    : undefined;
  const excludeDomains = Array.isArray(row.excludeDomains)
    ? [...new Set(row.excludeDomains.flatMap((value) => {
      if (typeof value !== "string") return [];
      const normalized = value.trim().toLowerCase().replace(/^www\./, "");
      return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized) ? [normalized] : [];
    }))].slice(0, 8)
    : undefined;
  return {
    ...(queryCycle === undefined ? {} : { queryCycle }),
    ...(excludeDomains?.length ? { excludeDomains } : {}),
  };
}

function trustedRequiredProvider(input: Prisma.JsonValue): SupplierResearchProvider | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const provider = (input as Prisma.JsonObject).requiredProvider;
  return provider === "EXA" || provider === "OPENAI" ? provider : undefined;
}

function hasCampaignMetadata(input: Prisma.JsonValue) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const row = input as Prisma.JsonObject;
  return row.campaignId !== undefined || row.campaignKey !== undefined || row.campaignItemKey !== undefined;
}

async function persistFailure(args: {
  claimed: Extract<ClaimSourcingResearchRunResult, { state: "claimed" }>;
  code: string;
  message: string;
  dependencies: SupplierResearchWorkerDependencies;
}): Promise<SupplierResearchWorkerResult> {
  try {
    await args.dependencies.failRun({
      context: args.claimed.run.context,
      runId: args.claimed.run.id,
      workspaceId: args.claimed.run.workspaceId,
      message: `${args.code}: ${args.message}`,
    });
    return { state: "failed", runId: args.claimed.run.id, code: args.code };
  } catch {
    return { state: "failed", runId: args.claimed.run.id, code: "TERMINAL_WRITE_FAILED" };
  }
}

export async function runSourcingResearchWorker(
  reference: QueuedSourcingResearchRunReference,
  dependencies: SupplierResearchWorkerDependencies = defaultDependencies,
): Promise<SupplierResearchWorkerResult> {
  const claimed = await dependencies.claimRun(reference);
  if (claimed.state === "unavailable") return { state: "skipped", runId: reference.id };
  if (claimed.state === "failed") return { state: "failed", runId: reference.id, code: "ACCESS_REVOKED" };

  const parsed = parseSupplierResearchRouteBody(claimed.run.input);
  if (!parsed.ok) {
    return persistFailure({
      claimed,
      code: "INVALID_REQUEST",
      message: "Supplier research request is invalid.",
      dependencies,
    });
  }

  const requiredProvider = trustedRequiredProvider(claimed.run.input);
  if (hasCampaignMetadata(claimed.run.input) && !requiredProvider) {
    return persistFailure({
      claimed,
      code: "INVALID_REQUEST",
      message: "Campaign supplier research requires a pinned provider.",
      dependencies,
    });
  }

  let output: unknown;
  try {
    const queryVariant = trustedQueryVariant(claimed.run.input);
    const exploration = trustedExploration(claimed.run.input);
    output = await dependencies.search({
      ...parsed.input,
      officeId: claimed.run.officeId,
      workspaceId: claimed.run.workspaceId,
      ...(queryVariant ? { queryVariant } : {}),
      ...(requiredProvider ? { requiredProvider } : {}),
      ...exploration,
    });
  } catch (error) {
    const failure = dependencies.supplierFailure(error);
    return persistFailure({
      claimed,
      code: failure.code,
      message: failure.message,
      dependencies,
    });
  }

  try {
    await dependencies.completeRun({
      context: claimed.run.context,
      runId: claimed.run.id,
      workspaceId: claimed.run.workspaceId,
      output: JSON.parse(JSON.stringify(output)) as Prisma.InputJsonValue,
    });
    return { state: "succeeded", runId: claimed.run.id };
  } catch {
    return persistFailure({
      claimed,
      code: "PERSISTENCE_FAILURE",
      message: "Supplier research result could not be saved.",
      dependencies,
    });
  }
}

export async function runQueuedSourcingResearchWorkers(options: { limit?: number } = {}) {
  const limit = Math.min(2, Math.max(1, Math.trunc(options.limit ?? 2)));
  const stale = await failStaleRunningSourcingResearchRuns();
  const queued = await listQueuedSourcingResearchRuns(limit);
  const results = await Promise.all(queued.map((run) => runSourcingResearchWorker(run)));
  return {
    scanned: queued.length,
    succeeded: results.filter((result) => result.state === "succeeded").length,
    failed: results.filter((result) => result.state === "failed").length,
    skipped: results.filter((result) => result.state === "skipped").length,
    staleFailed: stale.count,
  };
}
