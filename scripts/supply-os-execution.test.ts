import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  canonicalSupplyJson,
  createSupplyDecision,
  createSupplyExecutionTask,
  decideSupplyApproval,
  getSupplyControlState,
  proposeSupplyDecision,
  releaseSupplyExecutionTask,
  requestSupplyDecisionApproval,
  requestSupplyTaskApproval,
  supplyJsonHash,
  type CreateSupplyDecisionInput,
} from "../src/lib/supply-os/execution";
import {
  createSupplyWorkspace,
  publishSupplyImport,
  stageSupplyCsvImport,
  type SupplyAccessContext,
} from "../src/lib/supply-os/persistence";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.startsWith("derya_supply_os_execution_verify_")) {
  throw new Error("Supply OS execution tests require an explicit disposable derya_supply_os_execution_verify_* database.");
}

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

function decisionFixture(snapshotId: string, key: string): CreateSupplyDecisionInput {
  return {
    snapshotId,
    decisionType: "SOURCING_STRATEGY",
    subjectType: "PRODUCT",
    subjectRef: `ROBOT-${key}`,
    title: `Robot build strategy ${key}`,
    objective: "Meet the build target without weakening compliance evidence.",
    riskLevel: "HIGH",
    proposal: { selectedScenario: "assembled-radio", targetQuantity: 30 },
    rationale: "The assembled radio option reduces integration work and preserves a cited compliance path.",
    constraints: { destinationCountry: "US", certification: "FCC" },
    idempotencyKey: `decision:${key}`,
    evidence: [
      {
        evidenceKey: `erp:${key}`,
        kind: "erp_export",
        sourceType: "ERP_CSV",
        sourceRecordId: `export-${key}`,
        title: "Published ERP inventory and demand export",
        payload: { availableRadioModules: 20, targetRobots: 30 },
        confidence: 1,
        observedAt: "2026-08-08T12:00:00.000Z",
        usage: "CONSTRAINT",
      },
      {
        evidenceKey: `quote:${key}`,
        kind: "supplier_quote",
        sourceType: "SUPPLIER_QUOTE",
        sourceRecordId: `quote-${key}`,
        title: "Assembled radio module quote",
        payload: { unitPrice: 82.5, currency: "USD", leadTimeDays: 18 },
        confidence: 0.95,
        observedAt: "2026-08-08T13:00:00.000Z",
        usage: "SUPPORTS",
      },
    ],
    scenarios: [
      {
        scenarioKey: "current-build",
        name: "Current component sourcing",
        kind: "BASELINE",
        assumptions: { integrationLaborHours: 120 },
        measures: { totalCost: 34_000, leadTimeDays: 31 },
        currency: "USD",
        expectedCost: 34_000,
        expectedLeadTimeDays: 31,
        riskLevel: "HIGH",
        feasible: true,
        rank: 2,
        evidence: [{ evidenceKey: `erp:${key}`, usage: "CONSTRAINT" }],
      },
      {
        scenarioKey: "assembled-radio",
        name: "Buy assembled radio module",
        kind: "PROPOSED",
        assumptions: { integrationLaborHours: 45 },
        measures: { totalCost: 31_400, leadTimeDays: 20 },
        supplierPlan: { supplier: "Verified Radio Inc" },
        compliancePlan: { boundary: "FCC engineering review remains required" },
        currency: "USD",
        expectedCost: "31400",
        expectedLeadTimeDays: 20,
        riskLevel: "MEDIUM",
        feasible: true,
        rank: 1,
        evidence: [
          { evidenceKey: `erp:${key}`, usage: "CONSTRAINT" },
          { evidenceKey: `quote:${key}`, usage: "SUPPORTS" },
        ],
      },
    ],
  };
}

async function cleanup() {
  const ids = [officeId, foreignOfficeId].filter(Boolean);
  if (!ids.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_snapshot_mutation = 'on'");
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
    await tx.office.deleteMany({ where: { id: { in: ids } } });
  }).catch(() => undefined);
}

async function main() {
  try {
    const office = await prisma.office.create({ data: { name: `Execution Verify ${suffix}` } });
    officeId = office.id;
    const owner = await prisma.user.create({
      data: {
        officeId,
        email: `owner-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Supply Admin",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const manager = await prisma.user.create({
      data: {
        officeId,
        email: `manager-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Supply Manager",
        role: "MANAGER",
        canViewWholeOffice: true,
      },
    });
    const ownerContext: SupplyAccessContext = {
      officeId,
      userId: owner.id,
      role: owner.role,
      canViewWholeOffice: owner.canViewWholeOffice,
    };
    const managerContext: SupplyAccessContext = {
      officeId,
      userId: manager.id,
      role: manager.role,
      canViewWholeOffice: manager.canViewWholeOffice,
    };

    const workspace = await createSupplyWorkspace(ownerContext, { name: "Robot supply control" });
    const files = {
      locations: "location_key,name,kind,country_code\nAUS,Austin Assembly,FACTORY,US",
      items: "item_key,name,item_type,unit\nROBOT-1,Warehouse Robot,PRODUCT,EA\nRADIO-1,Radio Module,COMPONENT,EA",
      bom: "parent_item_key,component_item_key,quantity,unit\nROBOT-1,RADIO-1,1,EA",
      inventory: "position_key,item_key,location_key,on_hand,allocated,unit,as_of\nINV-1,RADIO-1,AUS,24,4,EA,2026-08-08",
      demand: "demand_key,item_key,location_key,quantity,unit,due_at\nDEM-1,ROBOT-1,AUS,30,EA,2026-09-01",
    } as const;
    const staged = await stageSupplyCsvImport(ownerContext, workspace.id, {
      sourceName: "Execution verification bundle",
      files,
    });
    const published = await publishSupplyImport(ownerContext, staged.id);
    const snapshotId = published.snapshot!.id;

    const draftInput = decisionFixture(snapshotId, `approve-${suffix}`);
    const draft = await createSupplyDecision(ownerContext, workspace.id, draftInput);
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.proposalHash, null);
    assert.equal(draft.scenarios.length, 2);
    assert.equal(draft.evidenceLinks.length, 2);

    const replay = await createSupplyDecision(ownerContext, workspace.id, draftInput);
    assert.equal(replay.id, draft.id, "decision creation must be idempotent");

    const proposed = await proposeSupplyDecision(ownerContext, draft.id);
    assert.equal(proposed.status, "PROPOSED");
    assert.match(proposed.proposalHash!, /^[a-f0-9]{64}$/);
    const proposedReplay = await proposeSupplyDecision(ownerContext, draft.id);
    assert.equal(proposedReplay.proposalHash, proposed.proposalHash, "proposal sealing must be deterministic");

    const decisionApproval = await requestSupplyDecisionApproval(ownerContext, draft.id, {
      reason: "Approve the selected sourcing scenario.",
      idempotencyKey: `approval:decision:${suffix}`,
    });
    assert.equal(decisionApproval.scopeHash, proposed.proposalHash);
    assert.equal(decisionApproval.requiredRole, "MANAGER");
    await assert.rejects(
      () => decideSupplyApproval(ownerContext, decisionApproval.id, { decision: "APPROVE" }),
      /different eligible approver/i,
    );
    await decideSupplyApproval(managerContext, decisionApproval.id, {
      decision: "APPROVE",
      note: "Evidence and assumptions reviewed.",
    });
    const approvedDecision = await prisma.supplyDecision.findUniqueOrThrow({ where: { id: draft.id } });
    assert.equal(approvedDecision.status, "APPROVED");
    assert.ok(approvedDecision.finalizedAt);
    await assert.rejects(
      () => prisma.supplyDecision.update({ where: { id: draft.id }, data: { proposal: { changed: true } } }),
      /immutable/i,
    );

    const task = await createSupplyExecutionTask(managerContext, draft.id, {
      scenarioId: proposed.scenarios.find((scenario) => scenario.scenarioKey === "assembled-radio")!.id,
      taskKey: `place-order:${suffix}`,
      input: { plan: draft.id, action: "place_order" },
      externalSystem: "ERP_SANDBOX",
      idempotencyKey: `task:place-order:${suffix}`,
    });
    assert.equal(task.status, "PLANNED");
    assert.equal(task.inputHash, supplyJsonHash({ plan: draft.id, action: "place_order" }));
    const taskReplay = await createSupplyExecutionTask(managerContext, draft.id, {
      scenarioId: task.scenarioId,
      taskKey: `place-order:${suffix}`,
      input: { action: "place_order", plan: draft.id },
      externalSystem: "ERP_SANDBOX",
      idempotencyKey: `task:place-order:${suffix}`,
    });
    assert.equal(taskReplay.id, task.id, "task creation must be idempotent across JSON key order");

    const taskApproval = await requestSupplyTaskApproval(managerContext, task.id, {
      reason: "Authorize ERP order release.",
      context: { quotedTotal: 31_400, currency: "USD" },
      idempotencyKey: `approval:task:${suffix}`,
    });
    assert.equal(taskApproval.requiredRole, "ADMIN");
    assert.equal(taskApproval.scopeHash, task.inputHash);
    await assert.rejects(
      () => decideSupplyApproval(managerContext, taskApproval.id, { decision: "APPROVE" }),
      /requires ADMIN authority/i,
    );
    await decideSupplyApproval(ownerContext, taskApproval.id, {
      decision: "APPROVE",
      note: "Approved exact task input hash.",
    });
    const released = await releaseSupplyExecutionTask(managerContext, task.id);
    assert.equal(released.status, "READY");
    assert.equal(released.startedAt, null, "release must not start execution");
    assert.equal(released.result, null, "release must not fabricate an external result");
    assert.equal(released.externalRef, null, "release must not create an external reference");
    assert.deepEqual(released.events.map((event) => event.eventType), ["TASK_PLANNED", "TASK_RELEASED"]);
    await releaseSupplyExecutionTask(managerContext, task.id);
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: task.id } }), 2);

    const rejectedTask = await createSupplyExecutionTask(managerContext, draft.id, {
      taskKey: `request-quote:${suffix}`,
      input: { plan: draft.id, action: "request_quote" },
      idempotencyKey: `task:request-quote:${suffix}`,
    });
    const rejectedTaskApproval = await requestSupplyTaskApproval(managerContext, rejectedTask.id, {
      idempotencyKey: `approval:rejected-task:${suffix}`,
    });
    await assert.rejects(
      () => decideSupplyApproval(managerContext, rejectedTaskApproval.id, { decision: "APPROVE" }),
      /different eligible approver/i,
    );
    await decideSupplyApproval(ownerContext, rejectedTaskApproval.id, { decision: "REJECT", note: "Quote scope is incomplete." });
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: rejectedTask.id } })).status, "BLOCKED");

    const rejectedDraft = await createSupplyDecision(ownerContext, workspace.id, decisionFixture(snapshotId, `reject-${suffix}`));
    const rejectedProposal = await proposeSupplyDecision(ownerContext, rejectedDraft.id);
    const rejectedApproval = await requestSupplyDecisionApproval(ownerContext, rejectedDraft.id, {
      idempotencyKey: `approval:rejected-decision:${suffix}`,
    });
    await decideSupplyApproval(managerContext, rejectedApproval.id, { decision: "REJECT", note: "Supplier capacity is unverified." });
    assert.equal((await prisma.supplyDecision.findUniqueOrThrow({ where: { id: rejectedProposal.id } })).status, "REJECTED");

    const secondStage = await stageSupplyCsvImport(ownerContext, workspace.id, {
      sourceName: "Unpublished verification bundle",
      files: { ...files, demand: files.demand.replace("30,EA", "31,EA") },
    });
    await assert.rejects(
      () => createSupplyDecision(ownerContext, workspace.id, decisionFixture(secondStage.snapshot!.id, `draft-snapshot-${suffix}`)),
      /published snapshot/i,
    );

    const staleDraft = await createSupplyDecision(
      ownerContext,
      workspace.id,
      decisionFixture(snapshotId, `stale-approval-${suffix}`),
    );
    await proposeSupplyDecision(ownerContext, staleDraft.id);
    const staleDecisionApproval = await requestSupplyDecisionApproval(ownerContext, staleDraft.id, {
      idempotencyKey: `approval:stale-decision:${suffix}`,
    });
    const staleTask = await createSupplyExecutionTask(managerContext, draft.id, {
      taskKey: `stale-request-quote:${suffix}`,
      input: { plan: draft.id, action: "request_quote" },
      idempotencyKey: `task:stale-request-quote:${suffix}`,
    });
    const staleTaskApproval = await requestSupplyTaskApproval(managerContext, staleTask.id, {
      idempotencyKey: `approval:stale-task:${suffix}`,
    });
    await decideSupplyApproval(ownerContext, staleTaskApproval.id, { decision: "APPROVE" });

    const secondPublished = await publishSupplyImport(ownerContext, secondStage.id);
    assert.equal(
      (await prisma.supplyApproval.findUniqueOrThrow({ where: { id: staleDecisionApproval.id } })).status,
      "EXPIRED",
      "publishing a newer snapshot must expire pending approvals against older data",
    );
    await assert.rejects(
      () => decideSupplyApproval(managerContext, staleDecisionApproval.id, { decision: "APPROVE" }),
      /stale because a newer supply snapshot/i,
    );
    await assert.rejects(
      () => releaseSupplyExecutionTask(managerContext, staleTask.id),
      /stale because a newer supply snapshot/i,
    );
    await assert.rejects(
      () => createSupplyDecision(ownerContext, workspace.id, decisionFixture(snapshotId, `old-snapshot-${suffix}`)),
      /stale because a newer supply snapshot/i,
    );
    assert.throws(() => canonicalSupplyJson({ oversized: "x".repeat(128_001) }), /smaller than/i);
    await assert.rejects(
      () => createSupplyDecision(ownerContext, workspace.id, {
        ...decisionFixture(secondPublished.snapshot!.id, `bad-json-${suffix}`),
        proposal: [] as never,
      }),
      /JSON object/i,
    );

    const controlState = await getSupplyControlState(ownerContext, workspace.id);
    assert.equal(controlState.snapshot?.id, secondPublished.snapshot?.id);
    assert.ok(controlState.decisions.some((decision) => decision.id === draft.id && decision.status === "APPROVED"));
    assert.ok(controlState.activeTasks.some((candidate) => candidate.id === task.id && candidate.status === "READY"));

    const foreignOffice = await prisma.office.create({ data: { name: `Foreign Verify ${suffix}` } });
    foreignOfficeId = foreignOffice.id;
    const foreignUser = await prisma.user.create({
      data: {
        officeId: foreignOfficeId,
        email: `foreign-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Foreign Admin",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    await assert.rejects(
      () => getSupplyControlState({
        officeId: foreignOfficeId,
        userId: foreignUser.id,
        role: foreignUser.role,
        canViewWholeOffice: true,
      }, workspace.id),
      /not found/i,
    );

    console.log("Supply OS decision and execution contract passed.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
