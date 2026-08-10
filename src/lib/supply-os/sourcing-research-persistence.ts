import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireSupplyWorkspace,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "./persistence";

const DEMO_WORKSPACE_KEY = "system:atlas-procurement";
const CAPABILITY_KEY = "research.supplier_candidates";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function sourcingSystemWorkspace(context: SupplyAccessContext, mode: "view" | "edit") {
  const existing = await prisma.supplyWorkspace.findUnique({
    where: { officeId_externalKey: { officeId: context.officeId, externalKey: DEMO_WORKSPACE_KEY } },
    select: { id: true },
  });
  if (existing) {
    await requireSupplyWorkspace(context, existing.id, mode);
    return existing;
  }
  if (context.role === "EMPLOYEE") {
    throw new SupplyPersistenceError("You cannot create the procurement workspace.", "forbidden");
  }
  let workspace: { id: string };
  try {
    workspace = await prisma.supplyWorkspace.upsert({
      where: { officeId_externalKey: { officeId: context.officeId, externalKey: DEMO_WORKSPACE_KEY } },
      update: { status: "ACTIVE" },
      create: {
        officeId: context.officeId,
        createdByUserId: context.userId,
        externalKey: DEMO_WORKSPACE_KEY,
        name: "Atlas Robotics procurement",
        members: {
          create: {
            officeId: context.officeId,
            userId: context.userId,
            role: "OWNER",
          },
        },
      },
      select: { id: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    workspace = await prisma.supplyWorkspace.findUniqueOrThrow({
      where: { officeId_externalKey: { officeId: context.officeId, externalKey: DEMO_WORKSPACE_KEY } },
      select: { id: true },
    });
  }
  await requireSupplyWorkspace(context, workspace.id, mode);
  return workspace;
}

export type PersistedSourcingResearchRun = {
  id: string;
  status: string;
  input: Prisma.JsonValue;
  output: Prisma.JsonValue | null;
  createdAt: Date;
  completedAt: Date | null;
};

export async function listSourcingResearchRuns(context: SupplyAccessContext, includeRunIds: string[] = []) {
  const workspace = await sourcingSystemWorkspace(context, "view");
  const staleBefore = new Date(Date.now() - 5 * 60 * 1_000);
  await prisma.supplyCapabilityRun.updateMany({
    where: {
      officeId: context.officeId,
      workspaceId: workspace.id,
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
  const recent = await prisma.supplyCapabilityRun.findMany({
    where: {
      ...where,
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select,
  });
  const missingIds = [...new Set(includeRunIds)].filter((id) => !recent.some((run) => run.id === id));
  if (!missingIds.length) return recent;
  const linked = await prisma.supplyCapabilityRun.findMany({
    where: { ...where, id: { in: missingIds } },
    select,
  });
  return [...recent, ...linked].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export async function startSourcingResearchRun(
  context: SupplyAccessContext,
  input: Prisma.InputJsonValue,
) {
  const workspace = await sourcingSystemWorkspace(context, "edit");
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
  const update = await prisma.supplyCapabilityRun.updateMany({
    where: {
      id: args.runId,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      capabilityKey: CAPABILITY_KEY,
    },
    data: {
      status: "SUCCEEDED",
      output: args.output,
      outputHash: digest(args.output),
      completedAt: new Date(),
    },
  });
  if (update.count !== 1) throw new Error("Sourcing research run was not found in this office.");
  const run = await prisma.supplyCapabilityRun.findFirst({
    where: {
      id: args.runId,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      capabilityKey: CAPABILITY_KEY,
    },
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
  if (!run) throw new Error("Sourcing research run was not found after completion.");
  return run;
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
    },
    data: {
      status: "FAILED",
      error: { message: args.message.slice(0, 300) },
      failedAt: new Date(),
    },
  });
}
