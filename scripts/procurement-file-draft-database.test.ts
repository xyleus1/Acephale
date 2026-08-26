import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { storeContextDocumentFile } from "../src/lib/document-storage";
import { prisma } from "../src/lib/prisma";
import {
  PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
  getProcurementFileDeliveryDraft,
  saveProcurementFileDeliveryDraft,
} from "../src/lib/procurement-file-delivery-draft";
import type { ProcurementOrderDetail, ProcurementOrderVendor } from "../src/lib/procurement-workflow";
import type { SupplyAccessContext } from "../src/lib/supply-os/persistence";

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
