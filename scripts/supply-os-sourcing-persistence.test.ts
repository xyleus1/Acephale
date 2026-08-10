import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createSupplyWorkspace, listSupplyWorkspaces, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import {
  completeSourcingResearchRun,
  listSourcingResearchRuns,
  startSourcingResearchRun,
} from "../src/lib/supply-os/sourcing-research-persistence";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

async function cleanup() {
  const ids = [officeId, foreignOfficeId].filter(Boolean);
  if (ids.length) await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
    await tx.office.deleteMany({ where: { id: { in: ids } } });
  }).catch(() => undefined);
}

async function makeContext(label: string) {
  const office = await prisma.office.create({ data: { name: `Sourcing ${label} ${suffix}` } });
  const user = await prisma.user.create({
    data: {
      officeId: office.id,
      email: `sourcing-${label}-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: `${label} operator`,
      role: "ADMIN",
      canViewWholeOffice: true,
    },
  });
  return {
    officeId: office.id,
    userId: user.id,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice,
  } satisfies SupplyAccessContext;
}

async function main() {
  try {
    const context = await makeContext("owner");
    officeId = context.officeId;
    const visibleWorkspace = await createSupplyWorkspace(context, { name: "Visible robotics workspace" });
    const input = {
      componentItemKey: "VIS-DPT-410",
      componentName: "Stereo depth camera",
      manufacturer: null,
      mpn: null,
      specification: "Industrial stereo depth camera",
      targetCountry: "United States",
      requestText: "Find four stereo depth cameras",
    };
    const started = await startSourcingResearchRun(context, input);
    await completeSourcingResearchRun({
      context,
      runId: started.id,
      workspaceId: started.workspaceId,
      output: { candidates: [{ id: "candidate-1", companyName: "Example supplier" }], degraded: false, warnings: [] },
    });

    const stale = await startSourcingResearchRun(context, { ...input, componentItemKey: "STALE-1" });
    await prisma.supplyCapabilityRun.update({
      where: { id: stale.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1_000) },
    });
    const runs = await listSourcingResearchRuns(context);
    assert.equal(runs.length, 2);
    const completed = runs.find((run) => run.id === started.id);
    assert.equal((completed?.input as typeof input).componentItemKey, "VIS-DPT-410");
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(((completed?.output as { candidates?: unknown[] })?.candidates ?? []).length, 1);
    assert.equal(runs.find((run) => run.id === stale.id)?.status, "FAILED", "stale research must become retryable");
    const stored = await prisma.supplyCapabilityRun.findUniqueOrThrow({ where: { id: started.id } });
    assert.ok(stored.inputHash);
    assert.ok(stored.outputHash);

    const listed = await listSupplyWorkspaces(context);
    assert.ok(listed.some((workspace) => workspace.id === visibleWorkspace.id), "ordinary null-key workspaces must remain visible");
    assert.ok(listed.every((workspace) => !workspace.externalKey?.startsWith("system:")), "the system procurement workspace must stay out of the company directory");

    const foreign = await makeContext("foreign");
    foreignOfficeId = foreign.officeId;
    assert.equal((await listSourcingResearchRuns(foreign)).length, 0, "another office must not see sourcing research runs");

    console.log("Supply OS sourcing persistence checks passed.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
