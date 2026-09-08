import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { storeContextDocumentFile } from "../src/lib/document-storage";
import { prisma } from "../src/lib/prisma";
import {
  PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
  getProcurementFileDeliveryDraft,
  markProcurementFileDeliveryDraftSent,
  retireProcurementFileDeliveryDraft,
  saveProcurementFileDeliveryDraft,
} from "../src/lib/procurement-file-delivery-draft";
import type { ProcurementOrderDetail, ProcurementOrderVendor } from "../src/lib/procurement-workflow";
import type { SupplyAccessContext } from "../src/lib/supply-os/persistence";
import {
  createProcurementActionStateReadFixture,
  withEnforcedSupplyStateRuntime,
} from "./supply-state-action-test-fixture";

// The Supply OS execution guard rejects tasks that do not begin in PLANNED and
// rejects READY tasks without a matching human approval, so the file bearing
// draft can only be trusted when it is exercised against a migrated database.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.startsWith("derya_supply_reply_verify")) {
  throw new Error("Supplier reply draft tests require an explicit disposable derya_supply_reply_verify database.");
}

function binaryStl(triangles: number) {
  const bytes = Buffer.alloc(84 + triangles * 50);
  bytes.write("derya test stl", 0, "latin1");
  bytes.writeUInt32LE(triangles, 80);
  return bytes;
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({ data: { name: `Reply draft ${suffix}` } });
  try {
    const user = await prisma.user.create({
      data: {
        officeId: office.id,
        email: `draft-operator-${suffix}@example.com`,
        passwordHash: "test-only",
        fullName: "Draft operator",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const company = await prisma.company.create({
      data: { officeId: office.id, name: `Draft customer ${suffix}` },
    });
    const workspace = await prisma.supplyWorkspace.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        createdByUserId: user.id,
        name: `Draft workspace ${suffix}`,
      },
    });

    const bom = Buffer.from("Designator,Manufacturer_Part_Number,Quantity\nR1,RC0402FR-0710KL,4\n", "utf-8");
    const stl = binaryStl(12);
    const leaked = Buffer.from("note,value\nportal,https://portal.example.com\npassword=hunter2\n", "utf-8");
    const stored = await Promise.all([
      storeContextDocumentFile({
        officeId: office.id,
        workspaceId: workspace.id,
        preferredName: "assembly-bom.csv",
        bytes: bom,
        contentType: "text/csv",
      }),
      storeContextDocumentFile({
        officeId: office.id,
        workspaceId: workspace.id,
        preferredName: "cushion-variant.stl",
        bytes: stl,
        contentType: "model/stl",
      }),
      storeContextDocumentFile({
        officeId: office.id,
        workspaceId: workspace.id,
        preferredName: "supplier-portal-notes.csv",
        bytes: leaked,
        contentType: "text/csv",
      }),
    ]);
    const documents = await Promise.all([
      { name: "assembly-bom.csv", mimeType: "text/csv", bytes: bom, url: stored[0]!.url },
      { name: "cushion-variant.stl", mimeType: "model/stl", bytes: stl, url: stored[1]!.url },
      { name: "supplier-portal-notes.csv", mimeType: "text/csv", bytes: leaked, url: stored[2]!.url },
    ].map((entry) => prisma.companyContext.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        kind: "DOCUMENT",
        name: entry.name,
        mimeType: entry.mimeType,
        sizeBytes: entry.bytes.length,
        storageUrl: entry.url,
        contentHash: `${randomUUID()}`,
      },
      select: { id: true, name: true },
    })));

    const vendor: ProcurementOrderVendor = {
      id: `vendor-${suffix}`,
      supplierRegistryId: null,
      name: "Draft Supplier",
      website: "https://example.com",
      contact: { name: "Quotes", email: `supplier-${suffix}@example.com`, phone: null },
      contacted: true,
      responseCount: 1,
      status: "shortlisted",
      research: {},
      quote: null,
    };
    const order: ProcurementOrderDetail = {
      id: `order-${suffix}`,
      status: "awaiting_shortlist_approval",
      progress: "Collecting supplier responses",
      neededBy: "2027-01-11",
      quantity: 100,
      unit: "units",
      material: "Rigid two piece mouse bite PCB",
      specification: "Four layers. 1 mm thickness. Black solder mask.",
      requestContext: {
        source: { workspace_id: workspace.id },
        procurement_context: {
          documents: documents.map((document) => ({
            citation_id: `document:${document.id}`,
            name: document.name,
            summary: null,
            markdown: `Stored facts for ${document.name}`,
          })),
        },
      },
      approvalRequestedAt: null,
      decisionSnapshot: null,
      vendors: [vendor],
      updatedAt: "2026-08-24T10:00:00.000Z",
    };
    const context: SupplyAccessContext = {
      officeId: office.id,
      userId: user.id,
      role: "ADMIN",
      canViewWholeOffice: true,
    };

    const newerMessageStateRead = await createProcurementActionStateReadFixture({
      officeId: office.id,
      companyId: company.id,
      customerId: company.id,
      workspaceId: workspace.id,
      order,
      vendor,
      latestMessage: {
        id: `inbound-newer-${suffix}`,
        direction: "INBOUND",
        fromEmail: vendor.contact!.email!,
      },
    });
    await withEnforcedSupplyStateRuntime(() => assert.rejects(saveProcurementFileDeliveryDraft({
      context,
      customerId: company.id,
      order,
      vendor,
      sourceMessageId: `inbound-before-refresh-${suffix}`,
      recipient: vendor.contact!.email!,
      conversationSubject: `Re: RFQ ${suffix}`,
      stateRead: newerMessageStateRead,
    }), /not the latest message/i));
    assert.equal(await prisma.supplyExecutionTask.count({
      where: { officeId: office.id, taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE },
    }), 0, "A draft using an older conversation than its state read must stop before task persistence.");

    const draft = await saveProcurementFileDeliveryDraft({
      context,
      customerId: company.id,
      order,
      vendor,
      sourceMessageId: `inbound-${suffix}`,
      recipient: vendor.contact!.email!,
      conversationSubject: `Re: RFQ ${suffix}`,
    });
    assert.equal(draft.state, "DRAFT");
    assert.deepEqual(draft.attachments.map((attachment) => attachment.name).sort(), [
      "assembly-bom.csv",
      "cushion-variant.stl",
    ]);
    assert.deepEqual(draft.withheld.map((entry) => entry.name), ["supplier-portal-notes.csv"]);
    assert.match(draft.withheld[0]!.reason, /credential assignment/);
    assert.ok(!draft.body.includes("hunter2"), "A withheld file must not leak into the draft body.");
    assert.match(draft.body, /assembly-bom\.csv/);

    const savedTasks = await prisma.supplyExecutionTask.findMany({
      where: { officeId: office.id, taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE },
      include: { events: true },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(savedTasks.length, 1);
    assert.equal(savedTasks[0]?.status, "PLANNED", "An unsent draft carries no approval, so it stays PLANNED.");
    assert.equal(savedTasks[0]?.requiresApproval, true);
    assert.deepEqual(savedTasks[0]?.events.map((event) => event.eventType), [
      "PROCUREMENT_SUPPLIER_FILE_REPLY_DRAFTED",
    ]);

    const restored = await getProcurementFileDeliveryDraft({ officeId: office.id, order, vendorId: vendor.id });
    assert.ok(restored, "A saved draft must be readable again.");
    assert.equal(restored.body, draft.body);
    assert.equal(restored.attachments.length, 2);

    // Redrafting cannot edit immutable task input, so it supersedes the draft.
    const redraft = await saveProcurementFileDeliveryDraft({
      context,
      customerId: company.id,
      order,
      vendor,
      sourceMessageId: `inbound-later-${suffix}`,
      recipient: vendor.contact!.email!,
      conversationSubject: `Re: RFQ ${suffix} follow up`,
    });
    assert.equal(redraft.sourceMessageId, `inbound-later-${suffix}`);
    const afterRedraft = await prisma.supplyExecutionTask.findMany({
      where: { officeId: office.id, taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE },
      orderBy: { createdAt: "asc" },
      select: { status: true, taskKey: true },
    });
    assert.equal(afterRedraft.length, 2);
    assert.equal(afterRedraft[0]?.status, "CANCELLED");
    assert.equal(afterRedraft[1]?.status, "PLANNED");
    assert.notEqual(afterRedraft[0]?.taskKey, afterRedraft[1]?.taskKey);
    const latest = await getProcurementFileDeliveryDraft({ officeId: office.id, order, vendorId: vendor.id });
    assert.equal(latest?.sourceMessageId, `inbound-later-${suffix}`);

    const foreignOfficeRead = await getProcurementFileDeliveryDraft({
      officeId: (await prisma.office.create({ data: { name: `Foreign draft ${suffix}` } })).id,
      order,
      vendorId: vendor.id,
    });
    assert.equal(foreignOfficeRead, null, "Drafts must not cross office scope.");

    assert.equal(
      await markProcurementFileDeliveryDraftSent({
        context,
        order,
        vendorId: vendor.id,
        expectedTaskId: draft.taskId!,
        expectedInputHash: draft.inputHash!,
        sourceMessageId: `inbound-${suffix}`,
        providerMessageId: `provider-stale-${suffix}`,
      }),
      false,
      "Finalization must never select a newer concurrent draft when the delivered task is stale.",
    );
    assert.equal(
      (await getProcurementFileDeliveryDraft({ officeId: office.id, order, vendorId: vendor.id }))?.taskId,
      redraft.taskId,
      "A stale finalization attempt must leave the newer exact draft live.",
    );
    const staleDeliveredTask = await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: draft.taskId! },
      include: { approvals: true, events: { orderBy: { sequence: "asc" } } },
    });
    assert.equal(staleDeliveredTask.status, "CANCELLED");
    assert.equal(staleDeliveredTask.approvals.length, 0, "A terminal delivery race must never approve a successor or rewrite the cancelled task.");
    assert.deepEqual(staleDeliveredTask.events.map((event) => event.eventType), [
      "PROCUREMENT_SUPPLIER_FILE_REPLY_DRAFTED",
      "PROCUREMENT_SUPPLIER_FILE_REPLY_DELIVERED_AFTER_TERMINAL",
    ]);

    // A delivered draft stops being offered again, and the send is recorded on
    // the same task so the trail shows who approved it.
    const marked = await markProcurementFileDeliveryDraftSent({
      context,
      order,
      vendorId: vendor.id,
      expectedTaskId: redraft.taskId!,
      expectedInputHash: redraft.inputHash!,
      sourceMessageId: `inbound-later-${suffix}`,
      providerMessageId: `provider-${suffix}`,
    });
    assert.equal(marked, true);
    assert.equal(
      await getProcurementFileDeliveryDraft({ officeId: office.id, order, vendorId: vendor.id }),
      null,
      "A sent draft must not be offered for sending again.",
    );
    const afterSend = await prisma.supplyExecutionTask.findMany({
      where: { officeId: office.id, taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE },
      include: { events: true },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(afterSend[1]?.status, "SUCCEEDED");
    assert.ok(afterSend[1]?.completedAt, "A delivered draft records when it completed.");
    assert.deepEqual(afterSend[1]?.events.map((event) => event.eventType), [
      "PROCUREMENT_SUPPLIER_FILE_REPLY_DRAFTED",
      "PROCUREMENT_SUPPLIER_FILE_REPLY_SENT",
    ]);
    assert.equal(
      await markProcurementFileDeliveryDraftSent({
        context,
        order,
        vendorId: vendor.id,
        expectedTaskId: redraft.taskId!,
        expectedInputHash: redraft.inputHash!,
        sourceMessageId: `inbound-later-${suffix}`,
        providerMessageId: `provider-${suffix}`,
      }),
      false,
      "Marking a sent draft again must not create a second delivery record.",
    );

    // A draft the thread moved past is retired, since the send path refuses it
    // for good: left PLANNED it would be offered and refused on every pass and
    // its supplier would never be answered.
    const stale = await saveProcurementFileDeliveryDraft({
      context,
      customerId: company.id,
      order,
      vendor,
      sourceMessageId: `inbound-stale-${suffix}`,
      recipient: vendor.contact!.email!,
      conversationSubject: `Re: RFQ ${suffix} again`,
    });
    assert.equal(stale.sourceMessageId, `inbound-stale-${suffix}`);
    assert.equal(
      await retireProcurementFileDeliveryDraft({
        context,
        order,
        vendorId: vendor.id,
        sourceMessageId: `inbound-other-${suffix}`,
        reason: "Judged against a draft that is no longer the saved one.",
      }),
      false,
      "A draft saved for another supplier message must survive a stale judgement.",
    );
    assert.ok(await getProcurementFileDeliveryDraft({ officeId: office.id, order, vendorId: vendor.id }));
    assert.equal(
      await retireProcurementFileDeliveryDraft({
        context,
        order,
        vendorId: vendor.id,
        sourceMessageId: `inbound-stale-${suffix}`,
        reason: "This supplier reply was already answered on the thread.",
      }),
      true,
    );
    assert.equal(
      await getProcurementFileDeliveryDraft({ officeId: office.id, order, vendorId: vendor.id }),
      null,
      "A retired draft must not be offered for sending again.",
    );
    const afterRetire = await prisma.supplyExecutionTask.findMany({
      where: { officeId: office.id, taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE },
      include: { events: true },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(afterRetire.length, 3);
    assert.equal(afterRetire[2]?.status, "CANCELLED");
    assert.ok(afterRetire[2]?.cancelledAt, "A retired draft records when it was cancelled.");
    assert.deepEqual(afterRetire[2]?.events.map((event) => event.eventType), [
      "PROCUREMENT_SUPPLIER_FILE_REPLY_DRAFTED",
      "PROCUREMENT_SUPPLIER_FILE_REPLY_SUPERSEDED",
    ]);
    assert.equal(
      await retireProcurementFileDeliveryDraft({
        context,
        order,
        vendorId: vendor.id,
        sourceMessageId: `inbound-stale-${suffix}`,
        reason: "Retiring a draft twice must not write a second record.",
      }),
      false,
    );
    const concurrentDraft = await saveProcurementFileDeliveryDraft({
      context,
      customerId: company.id,
      order,
      vendor,
      sourceMessageId: `inbound-concurrent-${suffix}`,
      recipient: vendor.contact!.email!,
      conversationSubject: `Re: RFQ ${suffix} concurrent finalization`,
    });
    const concurrentMarks = await Promise.all([
      markProcurementFileDeliveryDraftSent({
        context,
        order,
        vendorId: vendor.id,
        expectedTaskId: concurrentDraft.taskId!,
        expectedInputHash: concurrentDraft.inputHash!,
        sourceMessageId: concurrentDraft.sourceMessageId,
        providerMessageId: `provider-concurrent-${suffix}`,
      }),
      markProcurementFileDeliveryDraftSent({
        context,
        order,
        vendorId: vendor.id,
        expectedTaskId: concurrentDraft.taskId!,
        expectedInputHash: concurrentDraft.inputHash!,
        sourceMessageId: concurrentDraft.sourceMessageId,
        providerMessageId: `provider-concurrent-${suffix}`,
      }),
    ]);
    assert.deepEqual([...concurrentMarks].sort(), [false, true], "Concurrent exact finalization must be idempotent.");
    assert.equal(await prisma.supplyApproval.count({ where: { executionTaskId: concurrentDraft.taskId! } }), 1);
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: {
        executionTaskId: concurrentDraft.taskId!,
        eventType: "PROCUREMENT_SUPPLIER_FILE_REPLY_SENT",
      },
    }), 1);

    console.log("Procurement file bearing draft database contract passed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
