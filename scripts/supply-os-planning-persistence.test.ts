import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createSupplyWorkspace, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import {
  computeAndPersistSupplyPlanning,
  listSupplyPlanningResults,
} from "../src/lib/supply-os/planning-persistence";
import type { SupplyPlanningOutput } from "../src/lib/supply-os/planning-engine";

const suffix = randomUUID().slice(0, 8);
let officeId = "";

async function cleanup() {
  if (!officeId) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_snapshot_mutation = 'on'");
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
    await tx.office.delete({ where: { id: officeId } });
  }).catch(() => undefined);
}

async function main() {
  try {
    const office = await prisma.office.create({ data: { name: `Planning Verify ${suffix}` } });
    officeId = office.id;
    const user = await prisma.user.create({
      data: {
        officeId,
        email: `planning-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Planning Owner",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const context: SupplyAccessContext = {
      officeId,
      userId: user.id,
      role: user.role,
      canViewWholeOffice: user.canViewWholeOffice,
    };
    const workspace = await createSupplyWorkspace(context, { name: "Planning test workspace" });
    const snapshot = await prisma.supplySnapshot.create({
      data: {
        officeId,
        workspaceId: workspace.id,
        createdByUserId: user.id,
        version: 1,
        status: "DRAFT",
        sourceHash: "source-v1",
      },
    });
    const facility = await prisma.supplyLocation.create({
      data: { officeId, workspaceId: workspace.id, snapshotId: snapshot.id, locationKey: "F1", name: "Factory 1", kind: "FACTORY" },
    });
    const product = await prisma.supplyItem.create({
      data: { officeId, workspaceId: workspace.id, snapshotId: snapshot.id, itemKey: "P1", name: "Product", itemType: "PRODUCT", unitOfMeasure: "EA" },
    });
    const component = await prisma.supplyItem.create({
      data: { officeId, workspaceId: workspace.id, snapshotId: snapshot.id, itemKey: "C1", name: "Radio component", itemType: "COMPONENT", unitOfMeasure: "EA", metadata: { requiresFccReview: true } },
    });
    const bom = await prisma.supplyBomVersion.create({
      data: { officeId, workspaceId: workspace.id, snapshotId: snapshot.id, productItemId: product.id, revision: "1" },
    });
    await prisma.supplyBomLine.create({
      data: { officeId, workspaceId: workspace.id, snapshotId: snapshot.id, bomVersionId: bom.id, parentItemId: product.id, componentItemId: component.id, lineNumber: 1, quantity: 1, unitOfMeasure: "EA", scrapRate: 0, sourceRefs: ["bom-evidence"] },
    });
    await prisma.supplyInventoryPosition.create({
      data: { officeId, workspaceId: workspace.id, snapshotId: snapshot.id, positionKey: "I1", itemId: component.id, locationId: facility.id, unitOfMeasure: "EA", quantityOnHand: 4, quantityAllocated: 0, quantityInTransit: 0, quantityOnOrder: 0, asOf: new Date("2026-08-08T00:00:00.000Z") },
    });
    await prisma.supplyDemand.create({
      data: { officeId, workspaceId: workspace.id, snapshotId: snapshot.id, demandKey: "D1", itemId: product.id, locationId: facility.id, sourceType: "ORDER", quantity: 5, unitOfMeasure: "EA", dueAt: new Date("2026-08-20T00:00:00.000Z"), sourceRefs: ["demand-evidence"] },
    });
    await prisma.supplySupplierTerm.create({
      data: {
        officeId,
        workspaceId: workspace.id,
        snapshotId: snapshot.id,
        termKey: "C1-current",
        itemId: component.id,
        facilityId: facility.id,
        supplierKey: "S1",
        supplierName: "Supplier 1",
        isCurrent: true,
        unitOfMeasure: "EA",
        currency: "USD",
        unitPrice: 10,
        modeledFreightPerUnit: 1,
        evidencedDutyPerUnit: 0.5,
        dutyEvidenceRefs: ["duty-evidence"],
        leadTimeMinDays: 2,
        leadTimeMaxDays: 4,
        availableQuantity: 1,
        availableAt: new Date("2026-08-15T00:00:00.000Z"),
        evidenceRefs: ["term-evidence"],
      },
    });
    await prisma.supplyFccProfile.create({
      data: {
        officeId,
        workspaceId: workspace.id,
        snapshotId: snapshot.id,
        itemId: component.id,
        moduleAuthorization: "EVIDENCED",
        moduleAuthorizationEvidenceRefs: ["fcc-grant"],
        hostIntegrationConstraints: [],
        labeling: "EVIDENCED",
        labelingEvidenceRefs: ["fcc-label"],
        rfExposure: "EVIDENCED",
        rfExposureEvidenceRefs: ["fcc-rf"],
        testing: "EVIDENCED",
        testingEvidenceRefs: ["fcc-test"],
        testingGaps: [],
        reviewRequirements: [],
        blockedReasons: [],
      },
    });
    await prisma.supplySnapshot.update({
      where: { id: snapshot.id },
      data: { status: "PUBLISHED", publishedAt: new Date("2026-08-08T00:00:00.000Z") },
    });
    const approvedRule = await prisma.supplyEquivalenceRule.create({
      data: {
        officeId,
        workspaceId: workspace.id,
        approvedByUserId: user.id,
        ruleKey: "remove-C1",
        fromItemKey: "C1",
        action: "REMOVE",
        status: "APPROVED",
        ruleHash: "approved-rule-hash",
        approvedAt: new Date("2026-08-08T00:00:00.000Z"),
        evidenceRefs: ["engineering-approval"],
      },
    });
    await assert.rejects(
      () => prisma.supplyEquivalenceRule.update({ where: { id: approvedRule.id }, data: { status: "REVOKED" } }),
      /append-only/i,
      "approved equivalence rules must not be rewritten",
    );

    await assert.rejects(
      () => computeAndPersistSupplyPlanning(context, {
        workspaceId: workspace.id,
        snapshotId: snapshot.id,
        productItemKey: "P1",
        scenarios: [{ scenarioKey: "current", family: "current_purchasing_plan", rank: 1, expectedCost: 1, feasible: true }],
      }),
      /unsupported fields: expectedCost, feasible, rank/i,
      "client-authored rank, cost, and feasibility must be rejected before persistence",
    );

    const result = await computeAndPersistSupplyPlanning(context, {
      workspaceId: workspace.id,
      snapshotId: snapshot.id,
      productItemKey: "P1",
      scenarios: [{ scenarioKey: "current", family: "current_purchasing_plan" }],
    });
    const output = result.output as unknown as SupplyPlanningOutput;
    assert.equal(output.scenarios[0]?.buildableUnits, 5);
    assert.equal(output.recommendationOrder[0], "current");
    assert.equal(result.snapshotHash, output.snapshotHash);
    assert.equal(result.normalizedInputHash, output.normalizedInputHash);
    assert.equal(result.outputHash, output.deterministicOutputHash);
    assert.equal(result.engineVersion, output.engineVersion);
    assert.ok(Array.isArray(result.assumptions));
    assert.ok(Array.isArray(result.unknowns));
    assert.ok(Array.isArray(result.evidenceReferences));

    const replay = await computeAndPersistSupplyPlanning(context, {
      workspaceId: workspace.id,
      snapshotId: snapshot.id,
      productItemKey: "P1",
      scenarios: [{ scenarioKey: "current", family: "current_purchasing_plan" }],
    });
    assert.equal(replay.id, result.id, "identical canonical planning inputs must be idempotent");
    await assert.rejects(
      () => prisma.supplyPlanningResult.update({ where: { id: result.id }, data: { outputHash: "tampered" } }),
      /append-only/i,
      "persisted planning results must be immutable",
    );

    const newer = await prisma.supplySnapshot.create({
      data: { officeId, workspaceId: workspace.id, createdByUserId: user.id, version: 2, status: "DRAFT", sourceHash: "source-v2" },
    });
    await prisma.supplySnapshot.update({
      where: { id: newer.id },
      data: { status: "PUBLISHED", publishedAt: new Date("2026-08-09T00:00:00.000Z") },
    });
    const listed = await listSupplyPlanningResults(context, workspace.id);
    const prior = listed.find((row) => row.id === result.id);
    assert.equal(prior?.isStale, true, "a newer published snapshot must make prior results visibly stale");
    assert.equal(prior?.outputHash, result.outputHash, "stale detection must not mutate prior results");

    console.log("Supply OS planning persistence checks passed.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
