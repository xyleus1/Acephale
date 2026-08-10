import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SupplyAccessContext } from "./persistence";

const DEMO_WORKSPACE_KEY = "system:atlas-procurement";
const CAPABILITY_KEY = "research.supplier_candidates";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function sourcingWorkspace(context: SupplyAccessContext) {
  return prisma.supplyWorkspace.upsert({
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
}

export type PersistedSourcingResearchRun = {
  id: string;
  status: string;
  input: Prisma.JsonValue;
  output: Prisma.JsonValue | null;
  createdAt: Date;
  completedAt: Date | null;
};

export async function listSourcingResearchRuns(context: SupplyAccessContext) {
  const workspace = await sourcingWorkspace(context);
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
  return prisma.supplyCapabilityRun.findMany({
    where: {
      officeId: context.officeId,
      workspaceId: workspace.id,
      capabilityKey: CAPABILITY_KEY,
    },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      status: true,
      input: true,
      output: true,
      createdAt: true,
      completedAt: true,
    },
  });
}

export async function startSourcingResearchRun(
  context: SupplyAccessContext,
  input: Prisma.InputJsonValue,
) {
  const workspace = await sourcingWorkspace(context);
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
