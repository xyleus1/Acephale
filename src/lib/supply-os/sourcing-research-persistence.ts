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

const DEMO_WORKSPACE_KEY = "system:atlas-procurement";
const CAPABILITY_KEY = "research.supplier_candidates";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function sourcingSystemWorkspace(context: SupplyAccessContext, mode: "view" | "edit", workspaceId?: string) {
  const accessContext = await currentSupplyAccessContext(context);
  if (workspaceId) return requireSupplyWorkspace(accessContext, workspaceId, mode);
  const existing = await prisma.supplyWorkspace.findUnique({
    where: { officeId_externalKey: { officeId: accessContext.officeId, externalKey: DEMO_WORKSPACE_KEY } },
    select: { id: true },
  });
  if (existing) {
    await requireSupplyWorkspace(accessContext, existing.id, mode);
    return existing;
  }
  if (accessContext.role === "EMPLOYEE") {
    throw new SupplyPersistenceError("You cannot create the procurement workspace.", "forbidden");
  }
  let workspace: { id: string };
  try {
    workspace = await prisma.supplyWorkspace.upsert({
      where: { officeId_externalKey: { officeId: accessContext.officeId, externalKey: DEMO_WORKSPACE_KEY } },
      update: { status: "ACTIVE" },
      create: {
        officeId: accessContext.officeId,
        createdByUserId: accessContext.userId,
        externalKey: DEMO_WORKSPACE_KEY,
        name: "Atlas Robotics procurement",
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
      where: { officeId_externalKey: { officeId: accessContext.officeId, externalKey: DEMO_WORKSPACE_KEY } },
      select: { id: true },
    });
  }
  await requireSupplyWorkspace(accessContext, workspace.id, mode);
  return workspace;
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
  status: string;
  input: Prisma.JsonValue;
  output: Prisma.JsonValue | null;
  createdAt: Date;
  completedAt: Date | null;
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

async function markAbandonedResearchFailed(context: SupplyAccessContext, workspaceId: string) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1_000);
  await prisma.supplyCapabilityRun.updateMany({
    where: {
      officeId: context.officeId,
      workspaceId,
      capabilityKey: CAPABILITY_KEY,
      status: { in: ["QUEUED", "RUNNING"] },
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "FAILED",
      error: { message: "Supplier research stopped before completion." },
      failedAt: new Date(),
    },
  });
}

export async function listSourcingResearchPage(
  context: SupplyAccessContext,
  options: { cursor?: string; limit?: number; workspaceId?: string } = {},
): Promise<SourcingResearchPage> {
  const workspace = await sourcingSystemWorkspace(context, "view", options.workspaceId);
  await markAbandonedResearchFailed(context, workspace.id);
  const cursor = decodeResearchCursor(options.cursor);
  const limit = pageSize(options.limit);
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
    status: true,
    input: true,
    output: true,
    createdAt: true,
    completedAt: true,
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
  const workspace = await sourcingSystemWorkspace(context, "view");
  const where = {
    officeId: context.officeId,
    workspaceId: workspace.id,
    capabilityKey: CAPABILITY_KEY,
  } satisfies Prisma.SupplyCapabilityRunWhereInput;
  const select = {
    id: true,
    status: true,
    input: true,
    output: true,
    createdAt: true,
    completedAt: true,
  } satisfies Prisma.SupplyCapabilityRunSelect;
  const linked = await prisma.supplyCapabilityRun.findMany({
    where: { ...where, id: { in: missingIds } },
    select,
  });
  return [...recent, ...linked].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
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
  await prisma.supplyCapabilityRun.updateMany({
    where: {
      id: args.runId,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      capabilityKey: CAPABILITY_KEY,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "FAILED",
      error: { message: args.message.slice(0, 300) },
      failedAt: new Date(),
    },
  });
}
