import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  currentSupplyAccessContext,
  requireSupplyWorkspace,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "./persistence";
import { recordSupplyResearchKnowledge } from "./supply-intelligence-persistence";

const ATLAS_DEMO_WORKSPACE = { externalKey: "system:atlas-procurement", name: "Atlas Robotics procurement" } as const;
const GUILD_DEMO_WORKSPACE = { externalKey: "system:guild-procurement", name: "GUILD procurement" } as const;
export const SOURCING_RESEARCH_CAPABILITY_KEY = "research.supplier_candidates";
const CAPABILITY_KEY = SOURCING_RESEARCH_CAPABILITY_KEY;
const CAPABILITY_VERSION = "1";
const PROVIDER_RUN_DSL_VERSION = "2";
const PROVIDER_RUN_DSL_NAMES = ["interactive_supplier_research", "queued_supplier_research_child"] as const;
const CAMPAIGN_CAPABILITY_KEY = "research.supplier_campaign";
const CAMPAIGN_DSL_NAME = "guild_continuous_supplier_research";
const CAMPAIGN_CAPABILITY_VERSION = "3";
const RUN_STALE_AFTER_MS = 5 * 60 * 1_000;
const OFFICE_DAILY_PROVIDER_CALL_CAP = 72;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function demoSourcingWorkspace(
  context: SupplyAccessContext,
  mode: "view" | "edit",
  demo: typeof ATLAS_DEMO_WORKSPACE | typeof GUILD_DEMO_WORKSPACE,
) {
  const accessContext = await currentSupplyAccessContext(context);
  const existing = await prisma.supplyWorkspace.findUnique({
    where: { officeId_externalKey: { officeId: accessContext.officeId, externalKey: demo.externalKey } },
    select: { id: true },
  });
  if (existing) {
    await requireSupplyWorkspace(accessContext, existing.id, mode);
    return existing;
  }
  if (mode === "view") {
    throw new SupplyPersistenceError("Supply workspace not found.", "not_found");
  }
  if (accessContext.role === "EMPLOYEE") {
    throw new SupplyPersistenceError("You cannot create the procurement workspace.", "forbidden");
  }
  let workspace: { id: string };
  try {
    workspace = await prisma.supplyWorkspace.upsert({
      where: { officeId_externalKey: { officeId: accessContext.officeId, externalKey: demo.externalKey } },
      update: { status: "ACTIVE" },
      create: {
        officeId: accessContext.officeId,
        createdByUserId: accessContext.userId,
        externalKey: demo.externalKey,
        name: demo.name,
        members: {
          create: {
            officeId: accessContext.officeId,
            userId: accessContext.userId,
            role: "OWNER",
          },
        },
      },
      select: { id: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    workspace = await prisma.supplyWorkspace.findUniqueOrThrow({
      where: { officeId_externalKey: { officeId: accessContext.officeId, externalKey: demo.externalKey } },
      select: { id: true },
    });
  }
  await requireSupplyWorkspace(accessContext, workspace.id, mode);
  return workspace;
}

export async function sourcingSystemWorkspace(context: SupplyAccessContext, mode: "view" | "edit", workspaceId?: string) {
  const accessContext = await currentSupplyAccessContext(context);
  if (workspaceId) return requireSupplyWorkspace(accessContext, workspaceId, mode);
  return demoSourcingWorkspace(accessContext, mode, ATLAS_DEMO_WORKSPACE);
}

export async function guildSourcingSystemWorkspace(context: SupplyAccessContext, mode: "view" | "edit") {
  return demoSourcingWorkspace(context, mode, GUILD_DEMO_WORKSPACE);
}

async function findDemoSourcingWorkspace(
  context: SupplyAccessContext,
  demo: typeof ATLAS_DEMO_WORKSPACE | typeof GUILD_DEMO_WORKSPACE,
) {
  const accessContext = await currentSupplyAccessContext(context);
  const workspace = await prisma.supplyWorkspace.findUnique({
    where: {
      officeId_externalKey: {
        officeId: accessContext.officeId,
        externalKey: demo.externalKey,
      },
    },
    select: { id: true },
  });
  if (!workspace) return null;
  await requireSupplyWorkspace(accessContext, workspace.id, "view");
  return workspace;
}

export async function findSourcingSystemWorkspace(context: SupplyAccessContext) {
  return findDemoSourcingWorkspace(context, ATLAS_DEMO_WORKSPACE);
}

export async function findGuildSourcingSystemWorkspace(context: SupplyAccessContext) {
  return findDemoSourcingWorkspace(context, GUILD_DEMO_WORKSPACE);
}

export async function sourcingWorkspaceForTask(
  context: SupplyAccessContext,
  taskId: string,
  mode: "view" | "edit",
  taskTypes?: string[],
) {
  const accessContext = await currentSupplyAccessContext(context);
  const task = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: taskId,
      officeId: accessContext.officeId,
      ...(taskTypes?.length ? { taskType: { in: taskTypes } } : {}),
    },
    select: { workspaceId: true },
  });
  if (!task) throw new SupplyPersistenceError("Supply workstream was not found.", "not_found");
  return requireSupplyWorkspace(accessContext, task.workspaceId, mode);
}

export type PersistedSourcingResearchRun = {
  id: string;
  workspaceId: string;
  status: string;
  input: Prisma.JsonValue;
  output: Prisma.JsonValue | null;
  error: Prisma.JsonValue | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
};

export type SourcingResearchPage = {
  runs: PersistedSourcingResearchRun[];
  nextCursor: string | null;
};

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;

type ResearchCursor = {
  createdAt: Date;
  id: string;
};

function encodeResearchCursor(run: Pick<PersistedSourcingResearchRun, "id" | "createdAt">) {
  return Buffer.from(JSON.stringify({ createdAt: run.createdAt.toISOString(), id: run.id }), "utf8").toString("base64url");
}

function decodeResearchCursor(value: string | undefined): ResearchCursor | null {
  if (!value) return null;
  if (value.length > 500) throw new SupplyPersistenceError("The sourcing queue cursor is invalid.", "invalid_input");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const createdAt = typeof parsed.createdAt === "string" ? new Date(parsed.createdAt) : null;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    if (!createdAt || Number.isNaN(createdAt.getTime()) || !id || id.length > 220) throw new Error("invalid cursor");
    return { createdAt, id };
  } catch {
    throw new SupplyPersistenceError("The sourcing queue cursor is invalid.", "invalid_input");
  }
}

function pageSize(value: number | undefined) {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new SupplyPersistenceError(`The sourcing queue page size must be between 1 and ${MAX_PAGE_SIZE}.`, "invalid_input");
  }
  return value;
}

export async function listSourcingResearchPage(
  context: SupplyAccessContext,
  options: { cursor?: string; limit?: number; workspaceId?: string } = {},
): Promise<SourcingResearchPage> {
  const workspace = options.workspaceId
    ? await sourcingSystemWorkspace(context, "view", options.workspaceId)
    : await findSourcingSystemWorkspace(context);
  const cursor = decodeResearchCursor(options.cursor);
  const limit = pageSize(options.limit);
  if (!workspace) return { runs: [], nextCursor: null };
  const where = {
    officeId: context.officeId,
    workspaceId: workspace.id,
    capabilityKey: CAPABILITY_KEY,
    ...(cursor ? {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    } : {}),
  } satisfies Prisma.SupplyCapabilityRunWhereInput;
  const select = {
    id: true,
    workspaceId: true,
    status: true,
    input: true,
    output: true,
    error: true,
    startedAt: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
    failedAt: true,
  } satisfies Prisma.SupplyCapabilityRunSelect;
  const rows = await prisma.supplyCapabilityRun.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select,
  });
  const hasMore = rows.length > limit;
  const runs = hasMore ? rows.slice(0, limit) : rows;
  return {
    runs,
    nextCursor: hasMore && runs.length ? encodeResearchCursor(runs[runs.length - 1]) : null,
  };
}

export async function listSourcingResearchRuns(context: SupplyAccessContext, includeRunIds: string[] = []) {
  const firstPage = await listSourcingResearchPage(context, { limit: 50 });
  const secondPage = firstPage.nextCursor
    ? await listSourcingResearchPage(context, { cursor: firstPage.nextCursor, limit: 10 })
    : null;
  const recent = [...firstPage.runs, ...(secondPage?.runs ?? [])];
  const missingIds = [...new Set(includeRunIds)].filter((id) => !recent.some((run) => run.id === id));
  if (!missingIds.length) return recent;
  const workspace = await findSourcingSystemWorkspace(context);
  if (!workspace) return recent;
  const where = {
    officeId: context.officeId,
    workspaceId: workspace.id,
    capabilityKey: CAPABILITY_KEY,
  } satisfies Prisma.SupplyCapabilityRunWhereInput;
  const select = {
    id: true,
    workspaceId: true,
    status: true,
    input: true,
    output: true,
    error: true,
    startedAt: true,
    createdAt: true,
    updatedAt: true,
    completedAt: true,
    failedAt: true,
  } satisfies Prisma.SupplyCapabilityRunSelect;
  const linked = await prisma.supplyCapabilityRun.findMany({
    where: { ...where, id: { in: missingIds } },
    select,
  });
  return [...recent, ...linked].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

const persistedRunSelect = {
  id: true,
  workspaceId: true,
  status: true,
  input: true,
  output: true,
  error: true,
  startedAt: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  failedAt: true,
} satisfies Prisma.SupplyCapabilityRunSelect;

function optionalIdempotencyKey(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 220) {
    throw new SupplyPersistenceError("Supplier research idempotency key is invalid.", "invalid_input");
  }
  return normalized;
}

export async function enqueueSourcingResearchRun(args: {
  context: SupplyAccessContext;
  input: Prisma.InputJsonValue;
  workspaceId?: string;
  parentRunId?: string | null;
  idempotencyKey?: string | null;
}): Promise<{ run: PersistedSourcingResearchRun; reused: boolean }> {
  const workspace = await sourcingSystemWorkspace(args.context, "edit", args.workspaceId);
  const inputHash = digest(args.input);
  const parentRunId = args.parentRunId ?? null;
  const idempotencyKey = optionalIdempotencyKey(args.idempotencyKey);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supply-research-enqueue:${args.context.officeId}:${workspace.id}:${inputHash}`}, 0))::text AS "advisoryLock"
    `;
    if (idempotencyKey) {
      await tx.$queryRaw<Array<{ advisoryLock: string }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${`supply-research-idempotency:${args.context.officeId}:${workspace.id}:${idempotencyKey}`}, 0))::text AS "advisoryLock"
      `;
    }

    if (parentRunId) {
      const parent = await tx.supplyCapabilityRun.findFirst({
        where: { id: parentRunId, officeId: args.context.officeId, workspaceId: workspace.id },
        select: { id: true },
      });
      if (!parent) throw new SupplyPersistenceError("Supplier research parent run was not found.", "invalid_input");
    }

    if (idempotencyKey) {
      const idempotent = await tx.supplyCapabilityRun.findFirst({
        where: {
          officeId: args.context.officeId,
          workspaceId: workspace.id,
          idempotencyKey,
        },
        select: { ...persistedRunSelect, capabilityKey: true, inputHash: true, parentRunId: true },
      });
      if (idempotent) {
        if (
          idempotent.capabilityKey !== CAPABILITY_KEY
          || idempotent.inputHash !== inputHash
          || idempotent.parentRunId !== parentRunId
        ) {
          throw new SupplyPersistenceError("Supplier research idempotency key was already used for another request.", "conflict");
        }
        const {
          capabilityKey: _capabilityKey,
          inputHash: _inputHash,
          parentRunId: _parentRunId,
          ...run
        } = idempotent;
        return { run, reused: true };
      }
    }

    const active = await tx.supplyCapabilityRun.findFirst({
      where: {
        officeId: args.context.officeId,
        workspaceId: workspace.id,
        parentRunId,
        capabilityKey: CAPABILITY_KEY,
        inputHash,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: persistedRunSelect,
    });
    if (active) return { run: active, reused: true };

    const run = await tx.supplyCapabilityRun.create({
      data: {
        officeId: args.context.officeId,
        workspaceId: workspace.id,
        invokedByUserId: args.context.userId,
        parentRunId,
        capabilityKey: CAPABILITY_KEY,
        capabilityVersion: "1",
        dslName: parentRunId ? "queued_supplier_research_child" : "interactive_supplier_research",
        dslVersion: "2",
        input: args.input,
        inputHash,
        idempotencyKey,
      },
      select: persistedRunSelect,
    });
    return { run, reused: false };
  }, { maxWait: 5_000, timeout: 15_000 });
}

export type SourcingResearchCampaignBatchWork = {
  input: Prisma.InputJsonValue;
  idempotencyKey: string;
};

export async function enqueueSourcingResearchCampaignBatch(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  parentRunId: string;
  reconciliationToken: string;
  work: SourcingResearchCampaignBatchWork[];
  campaignDailyCap: number;
  officeDailyCap: number;
  maxActive: number;
  now?: Date;
}) {
  const accessContext = await currentSupplyAccessContext(args.context);
  const workspace = await requireSupplyWorkspace(accessContext, args.workspaceId, "edit");
  const campaignDailyCap = Math.max(0, Math.trunc(args.campaignDailyCap));
  const officeDailyCap = Math.max(0, Math.trunc(args.officeDailyCap));
  const maxActive = Math.max(0, Math.trunc(args.maxActive));

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-research-office-provider-budget:${accessContext.officeId}`}, 0))::text AS "advisoryLock"
    `;
    const quotaNow = args.now ?? (await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `)[0]?.now ?? new Date();
    const dayStart = new Date(Date.UTC(quotaNow.getUTCFullYear(), quotaNow.getUTCMonth(), quotaNow.getUTCDate()));
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-research-campaign:${accessContext.officeId}:${args.parentRunId}`}, 0))::text AS "advisoryLock"
    `;

    const [parent] = await tx.$queryRaw<Array<{ id: string; parentRunId: string | null; status: string; output: unknown }>>`
      SELECT "id", "parentRunId", "status", "output"
      FROM "SupplyCapabilityRun"
      WHERE "id" = ${args.parentRunId}
        AND "officeId" = ${accessContext.officeId}
        AND "workspaceId" = ${workspace.id}
        AND "capabilityKey" = 'research.supplier_campaign'
      FOR UPDATE
    `;
    const lease = parent?.output && typeof parent.output === "object" && !Array.isArray(parent.output)
      ? (parent.output as Record<string, unknown>).reconciliationLease
      : null;
    const leaseToken = lease && typeof lease === "object" && !Array.isArray(lease)
      ? (lease as Record<string, unknown>).token
      : null;
    if (!parent || parent.status !== "RUNNING" || leaseToken !== args.reconciliationToken) {
      throw new SupplyPersistenceError("Running supplier research campaign was not found.", "conflict");
    }
    const campaignAncestryIds = [parent.id];
    let ancestorId = parent.parentRunId;
    while (ancestorId && campaignAncestryIds.length < 50) {
      const ancestor = await tx.supplyCapabilityRun.findFirst({
        where: {
          id: ancestorId,
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          capabilityKey: "research.supplier_campaign",
        },
        select: { id: true, parentRunId: true },
      });
      if (!ancestor || campaignAncestryIds.includes(ancestor.id)) {
        throw new SupplyPersistenceError("Supplier research campaign ancestry is invalid.", "conflict");
      }
      campaignAncestryIds.push(ancestor.id);
      ancestorId = ancestor.parentRunId;
    }
    if (ancestorId) {
      throw new SupplyPersistenceError("Supplier research campaign ancestry is too deep.", "conflict");
    }

    const [campaignAttemptsUsed, officeAttemptsUsed, activeAttempts] = await Promise.all([
      tx.supplyCapabilityRun.count({
        where: {
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          parentRunId: { in: campaignAncestryIds },
          capabilityKey: CAPABILITY_KEY,
          dslName: "queued_supplier_research_child",
          createdAt: { gte: dayStart },
        },
      }),
      tx.supplyCapabilityRun.count({
        where: {
          officeId: accessContext.officeId,
          capabilityKey: CAPABILITY_KEY,
          dslName: { in: [...PROVIDER_RUN_DSL_NAMES] },
          createdAt: { gte: dayStart },
        },
      }),
      tx.supplyCapabilityRun.count({
        where: {
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          parentRunId: args.parentRunId,
          capabilityKey: CAPABILITY_KEY,
          dslName: "queued_supplier_research_child",
          status: { in: ["QUEUED", "RUNNING"] },
        },
      }),
    ]);

    let campaignRemaining = Math.max(0, campaignDailyCap - campaignAttemptsUsed);
    let officeRemaining = Math.max(0, officeDailyCap - officeAttemptsUsed);
    let activeRemaining = Math.max(0, maxActive - activeAttempts);
    let queued = 0;
    let reused = 0;

    for (const item of args.work) {
      const idempotencyKey = optionalIdempotencyKey(item.idempotencyKey);
      if (!idempotencyKey) {
        throw new SupplyPersistenceError("Campaign supplier research requires an idempotency key.", "invalid_input");
      }
      const inputHash = digest(item.input);
      const existing = await tx.supplyCapabilityRun.findFirst({
        where: {
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          idempotencyKey,
        },
        select: { capabilityKey: true, inputHash: true, parentRunId: true },
      });
      if (existing) {
        if (
          existing.capabilityKey !== CAPABILITY_KEY
          || existing.inputHash !== inputHash
          || existing.parentRunId !== args.parentRunId
        ) {
          throw new SupplyPersistenceError("Supplier research idempotency key was already used for another request.", "conflict");
        }
        reused += 1;
        continue;
      }
      if (campaignRemaining < 1 || officeRemaining < 1 || activeRemaining < 1) break;

      await tx.supplyCapabilityRun.create({
        data: {
          officeId: accessContext.officeId,
          workspaceId: workspace.id,
          invokedByUserId: accessContext.userId,
          parentRunId: args.parentRunId,
          capabilityKey: CAPABILITY_KEY,
          capabilityVersion: "1",
          dslName: "queued_supplier_research_child",
          dslVersion: "2",
          input: item.input,
          inputHash,
          idempotencyKey,
          createdAt: quotaNow,
        },
        select: { id: true },
      });
      queued += 1;
      campaignRemaining -= 1;
      officeRemaining -= 1;
      activeRemaining -= 1;
    }

    return {
      queued,
      reused,
      campaignAttemptsUsed: campaignAttemptsUsed + queued,
      officeAttemptsUsed: officeAttemptsUsed + queued,
    };
  }, { maxWait: 5_000, timeout: 20_000 });
}

export async function getSourcingResearchRun(
  context: SupplyAccessContext,
  runId: string,
  workspaceId?: string,
): Promise<PersistedSourcingResearchRun> {
  const accessContext = await currentSupplyAccessContext(context);
  const scopedWorkspaceId = workspaceId ?? (await prisma.supplyCapabilityRun.findFirst({
    where: { id: runId, officeId: accessContext.officeId, capabilityKey: CAPABILITY_KEY },
    select: { workspaceId: true },
  }))?.workspaceId;
  if (!scopedWorkspaceId) throw new SupplyPersistenceError("Supplier research run was not found.", "not_found");
  await requireSupplyWorkspace(accessContext, scopedWorkspaceId, "view");
  const run = await prisma.supplyCapabilityRun.findFirst({
    where: {
      id: runId,
      officeId: accessContext.officeId,
      workspaceId: scopedWorkspaceId,
      capabilityKey: CAPABILITY_KEY,
    },
    select: persistedRunSelect,
  });
  if (!run) throw new SupplyPersistenceError("Supplier research run was not found.", "not_found");
  return run;
}

export type QueuedSourcingResearchRunReference = {
  id: string;
  officeId: string;
  workspaceId: string;
};

export async function listQueuedSourcingResearchRuns(limit: number): Promise<QueuedSourcingResearchRunReference[]> {
  const boundedLimit = Math.min(10, Math.max(1, Math.trunc(limit)));
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const offices = await prisma.office.findMany({ orderBy: { id: "asc" }, select: { id: true } });
  const candidates: Array<QueuedSourcingResearchRunReference & { createdAt: Date }> = [];
  for (const office of offices) {
    const callsStartedToday = await prisma.supplyCapabilityRun.count({
      where: {
        officeId: office.id,
        capabilityKey: CAPABILITY_KEY,
        dslName: { in: [...PROVIDER_RUN_DSL_NAMES] },
        startedAt: { gte: dayStart },
      },
    });
    if (callsStartedToday >= OFFICE_DAILY_PROVIDER_CALL_CAP) continue;
    candidates.push(...await prisma.$queryRaw<Array<QueuedSourcingResearchRunReference & { createdAt: Date }>>`
      SELECT child."id", child."officeId", child."workspaceId", child."createdAt"
      FROM "SupplyCapabilityRun" child
      WHERE child."officeId" = ${office.id}
        AND child."capabilityKey" = ${CAPABILITY_KEY}
        AND child."capabilityVersion" = ${CAPABILITY_VERSION}
        AND child."dslVersion" = ${PROVIDER_RUN_DSL_VERSION}
        AND child."status" = 'QUEUED'
        AND (
          (
            child."dslName" = 'interactive_supplier_research'
            AND child."parentRunId" IS NULL
          )
          OR (
            child."dslName" = 'queued_supplier_research_child'
            AND child."input"->>'requiredProvider' IN ('EXA', 'OPENAI')
            AND EXISTS (
              SELECT 1
              FROM "SupplyCapabilityRun" parent
              WHERE parent."id" = child."parentRunId"
                AND parent."officeId" = child."officeId"
                AND parent."workspaceId" = child."workspaceId"
                AND parent."capabilityKey" = ${CAMPAIGN_CAPABILITY_KEY}
                AND parent."capabilityVersion" = ${CAMPAIGN_CAPABILITY_VERSION}
                AND parent."dslName" = ${CAMPAIGN_DSL_NAME}
                AND parent."dslVersion" = ${CAMPAIGN_CAPABILITY_VERSION}
                AND parent."status" = 'RUNNING'
                AND parent."input"->>'requiredProvider' = child."input"->>'requiredProvider'
            )
          )
        )
      ORDER BY child."createdAt" ASC, child."id" ASC
      LIMIT ${boundedLimit}
    `);
  }
  return candidates
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
    .slice(0, boundedLimit)
    .map(({ createdAt: _createdAt, ...reference }) => reference);
}

export type ClaimedSourcingResearchRun = QueuedSourcingResearchRunReference & {
  input: Prisma.JsonValue;
  context: SupplyAccessContext;
};

export type ClaimSourcingResearchRunResult =
  | { state: "claimed"; run: ClaimedSourcingResearchRun }
  | { state: "unavailable" }
  | { state: "failed" };

function sanitizedFailureMessage(message: string) {
  const normalized = message
    .replace(/\u2014/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || "Supplier research failed.").slice(0, 300);
}

async function failClaimedSourcingResearchRun(args: QueuedSourcingResearchRunReference & { message: string }) {
  return prisma.supplyCapabilityRun.updateMany({
    where: {
      id: args.id,
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      capabilityKey: CAPABILITY_KEY,
      status: "RUNNING",
    },
    data: {
      status: "FAILED",
      error: { message: sanitizedFailureMessage(args.message) },
      failedAt: new Date(),
    },
  });
}

export async function claimSourcingResearchRun(
  reference: QueuedSourcingResearchRunReference,
): Promise<ClaimSourcingResearchRunResult> {
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-research-office-provider-budget:${reference.officeId}`}, 0))::text AS "advisoryLock"
    `;
    const quotaNow = (await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `)[0]?.now ?? new Date();
    type QueueMetadata = {
      id: string;
      invokedByUserId: string | null;
      capabilityVersion: string;
      dslName: string | null;
      dslVersion: string;
      parentRunId: string | null;
      requiredProvider: string | null;
    };
    const [discovered] = await tx.$queryRaw<Array<QueueMetadata>>`
      SELECT "id", "invokedByUserId", "capabilityVersion", "dslName", "dslVersion", "parentRunId", "input"->>'requiredProvider' AS "requiredProvider"
      FROM "SupplyCapabilityRun"
      WHERE "id" = ${reference.id}
        AND "officeId" = ${reference.officeId}
        AND "workspaceId" = ${reference.workspaceId}
        AND "capabilityKey" = ${CAPABILITY_KEY}
        AND "status" = 'QUEUED'
    `;
    if (!discovered) return "unavailable" as const;
    let lockedQueue: QueueMetadata;
    if (discovered.dslName === "queued_supplier_research_child") {
      type CampaignParentMetadata = {
        id: string;
        capabilityKey: string;
        capabilityVersion: string;
        dslName: string;
        dslVersion: string;
        status: string;
        requiredProvider: string | null;
      };
      // Campaign reconciliation and supersession own locks in parent-then-child
      // order. Discover without a lock, then use the same order here so a
      // worker claim cannot deadlock a terminal parent transition.
      const [parent] = discovered.parentRunId ? await tx.$queryRaw<Array<CampaignParentMetadata>>`
        SELECT
          "id",
          "capabilityKey",
          "capabilityVersion",
          "dslName",
          "dslVersion",
          "status",
          "input"->>'requiredProvider' AS "requiredProvider"
        FROM "SupplyCapabilityRun"
        WHERE "id" = ${discovered.parentRunId}
          AND "officeId" = ${reference.officeId}
          AND "workspaceId" = ${reference.workspaceId}
        FOR UPDATE
      ` : [];
      const [queued] = await tx.$queryRaw<Array<QueueMetadata>>`
        SELECT "id", "invokedByUserId", "capabilityVersion", "dslName", "dslVersion", "parentRunId", "input"->>'requiredProvider' AS "requiredProvider"
        FROM "SupplyCapabilityRun"
        WHERE "id" = ${reference.id}
          AND "officeId" = ${reference.officeId}
          AND "workspaceId" = ${reference.workspaceId}
          AND "capabilityKey" = ${CAPABILITY_KEY}
          AND "status" = 'QUEUED'
        FOR UPDATE
      `;
      if (!queued
        || queued.dslName !== discovered.dslName
        || queued.invokedByUserId !== discovered.invokedByUserId
        || queued.capabilityVersion !== discovered.capabilityVersion
        || queued.dslVersion !== discovered.dslVersion
        || queued.parentRunId !== discovered.parentRunId
        || queued.requiredProvider !== discovered.requiredProvider) {
        return "unavailable" as const;
      }
      lockedQueue = queued;
      const requiredProvider = queued.requiredProvider === "EXA" || queued.requiredProvider === "OPENAI"
        ? queued.requiredProvider
        : null;
      const parentIsCurrent = Boolean(parent
        && queued.capabilityVersion === CAPABILITY_VERSION
        && queued.dslVersion === PROVIDER_RUN_DSL_VERSION
        && parent.capabilityKey === CAMPAIGN_CAPABILITY_KEY
        && parent.capabilityVersion === CAMPAIGN_CAPABILITY_VERSION
        && parent.dslName === CAMPAIGN_DSL_NAME
        && parent.dslVersion === CAMPAIGN_CAPABILITY_VERSION
        && parent.status === "RUNNING"
        && parent.requiredProvider === requiredProvider
        && requiredProvider);
      if (!parentIsCurrent) {
        const cancelled = await tx.supplyCapabilityRun.updateMany({
          where: {
            id: reference.id,
            officeId: reference.officeId,
            workspaceId: reference.workspaceId,
            capabilityKey: CAPABILITY_KEY,
            dslName: "queued_supplier_research_child",
            parentRunId: queued.parentRunId,
            status: "QUEUED",
          },
          data: {
            status: "CANCELLED",
            error: { message: "CAMPAIGN_SCOPE_SUPERSEDED: Supplier research campaign is no longer running." },
            cancelledAt: quotaNow,
          },
        });
        return cancelled.count === 1 ? "cancelled" as const : "unavailable" as const;
      }
    } else if (discovered.dslName === "interactive_supplier_research" && discovered.parentRunId === null) {
      const [queued] = await tx.$queryRaw<Array<QueueMetadata>>`
        SELECT "id", "invokedByUserId", "capabilityVersion", "dslName", "dslVersion", "parentRunId", "input"->>'requiredProvider' AS "requiredProvider"
        FROM "SupplyCapabilityRun"
        WHERE "id" = ${reference.id}
          AND "officeId" = ${reference.officeId}
          AND "workspaceId" = ${reference.workspaceId}
          AND "capabilityKey" = ${CAPABILITY_KEY}
          AND "capabilityVersion" = ${CAPABILITY_VERSION}
          AND "dslName" = 'interactive_supplier_research'
          AND "dslVersion" = ${PROVIDER_RUN_DSL_VERSION}
          AND "parentRunId" IS NULL
          AND "status" = 'QUEUED'
        FOR UPDATE
      `;
      if (!queued) return "unavailable" as const;
      lockedQueue = queued;
    } else {
      return "unavailable" as const;
    }
    const invokedBy = lockedQueue.invokedByUserId ? await tx.user.findFirst({
      where: {
        id: lockedQueue.invokedByUserId,
        officeId: reference.officeId,
        isActive: true,
      },
      select: { id: true, role: true, canViewWholeOffice: true },
    }) : null;
    const workspace = invokedBy ? await tx.supplyWorkspace.findFirst({
      where: {
        id: reference.workspaceId,
        officeId: reference.officeId,
        status: "ACTIVE",
      },
      select: {
        members: {
          where: {
            officeId: reference.officeId,
            userId: invokedBy.id,
            isActive: true,
          },
          select: { role: true },
          take: 1,
        },
      },
    }) : null;
    const hasOfficeWideEditAccess = Boolean(invokedBy
      && invokedBy.role !== "EMPLOYEE"
      && (invokedBy.canViewWholeOffice || invokedBy.role === "ADMIN" || invokedBy.role === "MANAGER"));
    const memberRole = workspace?.members[0]?.role;
    const hasMemberEditAccess = Boolean(invokedBy
      && invokedBy.role !== "EMPLOYEE"
      && memberRole
      && ["OWNER", "EDITOR"].includes(memberRole));
    if (!workspace || (!hasOfficeWideEditAccess && !hasMemberEditAccess)) {
      const cancelled = await tx.supplyCapabilityRun.updateMany({
        where: {
          id: reference.id,
          officeId: reference.officeId,
          workspaceId: reference.workspaceId,
          capabilityKey: CAPABILITY_KEY,
          invokedByUserId: lockedQueue.invokedByUserId,
          status: "QUEUED",
        },
        data: {
          status: "CANCELLED",
          error: { message: "ACCESS_REVOKED: Supplier research requester can no longer edit this workspace." },
          cancelledAt: quotaNow,
        },
      });
      return cancelled.count === 1 ? "cancelled" as const : "unavailable" as const;
    }
    const dayStart = new Date(Date.UTC(quotaNow.getUTCFullYear(), quotaNow.getUTCMonth(), quotaNow.getUTCDate()));
    const callsStartedToday = await tx.supplyCapabilityRun.count({
      where: {
        officeId: reference.officeId,
        capabilityKey: CAPABILITY_KEY,
        dslName: { in: [...PROVIDER_RUN_DSL_NAMES] },
        startedAt: { gte: dayStart },
      },
    });
    if (callsStartedToday >= OFFICE_DAILY_PROVIDER_CALL_CAP) return "unavailable" as const;
    const updated = await tx.supplyCapabilityRun.updateMany({
      where: {
        id: reference.id,
        officeId: reference.officeId,
        workspaceId: reference.workspaceId,
        capabilityKey: CAPABILITY_KEY,
        status: "QUEUED",
      },
      data: {
        status: "RUNNING",
        startedAt: quotaNow,
        error: Prisma.DbNull,
      },
    });
    return updated.count === 1 ? "claimed" as const : "unavailable" as const;
  }, { maxWait: 5_000, timeout: 15_000 });
  if (claimed !== "claimed") return { state: "unavailable" };
  const run = await prisma.supplyCapabilityRun.findFirst({
    where: {
      id: reference.id,
      officeId: reference.officeId,
      workspaceId: reference.workspaceId,
      capabilityKey: CAPABILITY_KEY,
      status: "RUNNING",
    },
    select: {
      id: true,
      officeId: true,
      workspaceId: true,
      input: true,
      invokedBy: {
        select: { id: true, officeId: true, role: true, canViewWholeOffice: true, isActive: true },
      },
    },
  });
  if (!run) return { state: "unavailable" };
  if (!run.invokedBy || !run.invokedBy.isActive || run.invokedBy.officeId !== run.officeId) {
    await failClaimedSourcingResearchRun({
      ...reference,
      message: "ACCESS_REVOKED: Supplier research requester no longer has access.",
    });
    return { state: "failed" };
  }
  const context = {
    officeId: run.officeId,
    userId: run.invokedBy.id,
    role: run.invokedBy.role,
    canViewWholeOffice: run.invokedBy.canViewWholeOffice,
  } satisfies SupplyAccessContext;
  try {
    await requireSupplyWorkspace(context, run.workspaceId, "edit");
  } catch (error) {
    if (error instanceof SupplyPersistenceError && ["forbidden", "not_found"].includes(error.code)) {
      await failClaimedSourcingResearchRun({
        ...reference,
        message: "ACCESS_REVOKED: Supplier research requester can no longer edit this workspace.",
      });
      return { state: "failed" };
    }
    throw error;
  }
  return {
    state: "claimed",
    run: {
      id: run.id,
      officeId: run.officeId,
      workspaceId: run.workspaceId,
      input: run.input,
      context,
    },
  };
}

export async function failStaleRunningSourcingResearchRuns() {
  const offices = await prisma.office.findMany({ select: { id: true } });
  const staleBefore = new Date(Date.now() - RUN_STALE_AFTER_MS);
  let count = 0;
  for (const office of offices) {
    const failed = await prisma.supplyCapabilityRun.updateMany({
      where: {
        officeId: office.id,
        capabilityKey: CAPABILITY_KEY,
        status: "RUNNING",
        updatedAt: { lt: staleBefore },
      },
      data: {
        status: "FAILED",
        error: { message: "WORKER_INTERRUPTED: Supplier research stopped before completion." },
        failedAt: new Date(),
      },
    });
    count += failed.count;
  }
  return { count };
}

export async function startSourcingResearchRun(
  context: SupplyAccessContext,
  input: Prisma.InputJsonValue,
  workspaceId?: string,
) {
  const workspace = await sourcingSystemWorkspace(context, "edit", workspaceId);
  const queued = await prisma.supplyCapabilityRun.create({
    data: {
      officeId: context.officeId,
      workspaceId: workspace.id,
      invokedByUserId: context.userId,
      capabilityKey: CAPABILITY_KEY,
      capabilityVersion: "1",
      dslName: "interactive_supplier_research",
      dslVersion: "1",
      input,
      inputHash: digest(input),
    },
    select: { id: true, workspaceId: true },
  });
  return prisma.supplyCapabilityRun.update({
    where: { id: queued.id },
    data: { status: "RUNNING", startedAt: new Date() },
    select: { id: true, workspaceId: true },
  });
}

export async function completeSourcingResearchRun(args: {
  context: SupplyAccessContext;
  runId: string;
  workspaceId: string;
  output: Prisma.InputJsonValue;
}) {
  await requireSupplyWorkspace(args.context, args.workspaceId, "edit");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ advisoryLock: string }>>`
      SELECT pg_advisory_xact_lock(hashtextextended(${`supply-research:${args.context.officeId}:${args.workspaceId}`}, 0))::text AS "advisoryLock"
    `;
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyCapabilityRun" WHERE "id" = ${args.runId} AND "officeId" = ${args.context.officeId} AND "workspaceId" = ${args.workspaceId} AND "capabilityKey" = ${CAPABILITY_KEY} FOR UPDATE`);
    const current = await tx.supplyCapabilityRun.findFirst({
      where: {
        id: args.runId,
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        capabilityKey: CAPABILITY_KEY,
        status: "RUNNING",
      },
      select: { input: true },
    });
    if (!current) throw new Error("Running sourcing research was not found in this office.");
    await recordSupplyResearchKnowledge({
      tx,
      context: args.context,
      workspaceId: args.workspaceId,
      runId: args.runId,
      input: current.input,
      output: args.output,
    });
    const completed = await tx.supplyCapabilityRun.updateMany({
      where: { id: args.runId, officeId: args.context.officeId, workspaceId: args.workspaceId, capabilityKey: CAPABILITY_KEY, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        output: args.output,
        outputHash: digest(args.output),
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) throw new Error("Running sourcing research changed before completion.");
    return tx.supplyCapabilityRun.findFirstOrThrow({
      where: { id: args.runId, officeId: args.context.officeId, workspaceId: args.workspaceId, capabilityKey: CAPABILITY_KEY },
      select: {
        id: true,
        status: true,
        input: true,
        output: true,
        createdAt: true,
        completedAt: true,
        officeId: true,
        workspaceId: true,
      },
    });
  }, { maxWait: 5_000, timeout: 45_000 });
}

export async function failSourcingResearchRun(args: {
  context: SupplyAccessContext;
  runId: string;
  workspaceId: string;
  message: string;
}) {
  await requireSupplyWorkspace(args.context, args.workspaceId, "edit");
  await failClaimedSourcingResearchRun({
    id: args.runId,
    officeId: args.context.officeId,
    workspaceId: args.workspaceId,
    message: args.message,
  });
}
