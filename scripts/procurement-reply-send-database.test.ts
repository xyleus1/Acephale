import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { ProcurementConversation } from "../src/lib/procurement-conversation-model";
import { sendProcurementSupplierReply } from "../src/lib/procurement-reply-send";
import type { ProcurementOrderDetail, ProcurementOrderVendor } from "../src/lib/procurement-workflow";
import type { loadRequestDocumentAttachments } from "../src/lib/supply-os/request-document-attachments";
import type { SupplyAccessContext } from "../src/lib/supply-os/persistence";
import type { SupplierEmailProvider, SupplierEmailSendInput, SupplierEmailSent } from "../src/lib/supply-os/supplier-email-provider";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.startsWith("derya_supply_reply_verify")) {
  throw new Error("Supplier reply send tests require an explicit disposable derya_supply_reply_verify database.");
}

type Fixture = {
  order: ProcurementOrderDetail;
  vendor: ProcurementOrderVendor;
  conversation: ProcurementConversation;
  communicationMessages: NonNullable<Parameters<typeof sendProcurementSupplierReply>[0]["dependencies"]>["communicationMessages"];
  input: {
    sourceMessageId: string;
    recipient: string;
    subject: string;
    body: string;
    attachmentDocumentIds?: readonly string[];
  };
};

function sentReceipt(input: SupplierEmailSendInput): SupplierEmailSent {
  return {
    state: "SENT",
    provider: "GMAIL",
    providerMessageId: `provider-${input.rfcMessageId}`,
    providerThreadId: input.providerThreadId ?? `thread-${input.rfcMessageId}`,
    sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(input.senderEmail)}/#sent/test`,
  };
}

function fixture(workspaceId: string, suffix: string, accountEmail = "operator@derya.ai"): Fixture {
  const sourceMessageId = `inbound-${suffix}`;
  const orderId = `order-${suffix}`;
  const vendorId = `vendor-${suffix}`;
  const recipient = `supplier-${suffix}@example.com`;
  const providerThreadId = `thread-${suffix}`;
  const inboundSentAt = "2026-08-22T16:00:00.000Z";
  const vendor: ProcurementOrderVendor = {
    id: vendorId,
    name: `Supplier ${suffix}`,
    website: "https://example.com",
    contact: { name: null, email: recipient, phone: null },
    contacted: true,
    responseCount: 1,
    status: "shortlisted",
    research: {},
    quote: null,
  };
  const order: ProcurementOrderDetail = {
    id: orderId,
    status: "awaiting_shortlist_approval",
    progress: "Collecting supplier responses",
    neededBy: null,
    quantity: 100,
    unit: "units",
    material: "Test assembly",
    specification: null,
    requestContext: { source: { workspace_id: workspaceId } },
    approvalRequestedAt: null,
    decisionSnapshot: null,
    vendors: [vendor],
    updatedAt: inboundSentAt,
  };
  const conversation: ProcurementConversation = {
    available: true,
    source: "BOURNE_LEDGER",
    sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${providerThreadId}`,
    accountEmail,
    messages: [{
      id: sourceMessageId,
      direction: "INBOUND",
      fromEmail: recipient,
      fromName: `Supplier ${suffix}`,
      toEmails: [accountEmail],
      ccEmails: [],
      subject: `Re: RFQ ${suffix}`,
      body: "Please send the technical package.",
      sentAt: inboundSentAt,
      truncated: false,
    }],
    unavailableReason: null,
  };
  const ledgerMessage = {
    id: sourceMessageId,
    provider: "GMAIL",
    accountEmail,
    providerMessageId: sourceMessageId,
    providerThreadId,
    rfcMessageId: `<${sourceMessageId}@example.com>`,
    direction: "INBOUND" as const,
    fromEmail: recipient,
    fromName: `Supplier ${suffix}`,
    toEmails: [accountEmail],
    ccEmails: [],
    subject: `Re: RFQ ${suffix}`,
    bodyText: "Please send the technical package.",
    bodyTruncated: false,
    sentAt: inboundSentAt,
  };
  return {
    order,
    vendor,
    conversation,
    communicationMessages: async (customerId, requestedOrderId, requestedVendorId) => {
      assert.equal(customerId, "customer-a");
      assert.equal(requestedOrderId, orderId);
      assert.equal(requestedVendorId, vendorId);
      return [ledgerMessage];
    },
    input: {
      sourceMessageId,
      recipient,
      subject: `Re: RFQ ${suffix}`,
      body: "Thank you. Please confirm capability before we share the files.",
    },
  };
}

async function deliver(args: {
  context: SupplyAccessContext;
  fixture: Fixture;
  provider: SupplierEmailProvider;
  requestDocumentAttachments?: typeof loadRequestDocumentAttachments;
}) {
  return sendProcurementSupplierReply({
    context: args.context,
    customerId: "customer-a",
    order: args.fixture.order,
    vendor: args.fixture.vendor,
    conversation: args.fixture.conversation,
    input: args.fixture.input,
    dependencies: {
      communicationMessages: args.fixture.communicationMessages,
      provider: args.provider,
      ...(args.requestDocumentAttachments ? { requestDocumentAttachments: args.requestDocumentAttachments } : {}),
    },
  });
}

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({ data: { name: `Supplier reply ${suffix}` } });
  const foreignOffice = await prisma.office.create({ data: { name: `Foreign supplier reply ${suffix}` } });
  try {
    const user = await prisma.user.create({
      data: {
        officeId: office.id,
        email: `operator-${suffix}@example.com`,
        passwordHash: "test-only",
        fullName: "Reply operator",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const viewer = await prisma.user.create({
      data: {
        officeId: office.id,
        email: `viewer-${suffix}@example.com`,
        passwordHash: "test-only",
        fullName: "Reply viewer",
        role: "EMPLOYEE",
        canViewWholeOffice: false,
      },
    });
    const foreignUser = await prisma.user.create({
      data: {
        officeId: foreignOffice.id,
        email: `foreign-${suffix}@example.com`,
        passwordHash: "test-only",
        fullName: "Foreign operator",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const workspace = await prisma.supplyWorkspace.create({
      data: { officeId: office.id, createdByUserId: user.id, name: `Reply workspace ${suffix}` },
    });
    await prisma.supplyWorkspaceMember.create({
      data: { officeId: office.id, workspaceId: workspace.id, userId: viewer.id, role: "VIEWER" },
    });
    await prisma.emailAccount.create({
      data: {
        officeId: office.id,
        email: "operator@derya.ai",
        provider: "GMAIL",
        accessToken: "fixture-token",
        refreshToken: "fixture-refresh-token",
        isActive: true,
        sendEnabled: true,
      },
    });
    await prisma.emailAccount.create({
      data: {
        officeId: foreignOffice.id,
        email: "foreign-only@derya.ai",
        provider: "GMAIL",
        accessToken: "fixture-token",
        refreshToken: "fixture-refresh-token",
        isActive: true,
        sendEnabled: true,
      },
    });
    await prisma.emailAccount.create({
      data: {
        officeId: foreignOffice.id,
        email: "send-disabled@derya.ai",
        provider: "GMAIL",
        accessToken: "fixture-token",
        refreshToken: "fixture-refresh-token",
        isActive: true,
        sendEnabled: false,
      },
    });

    const context: SupplyAccessContext = {
      officeId: office.id,
      userId: user.id,
      role: "ADMIN",
      canViewWholeOffice: true,
    };

    let rejectedBeforeProvider = 0;
    const guardProvider: SupplierEmailProvider = {
      send: async () => {
        rejectedBeforeProvider += 1;
        return { state: "REJECTED", error: "Guard provider should not run." };
      },
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    const stale = fixture(workspace.id, `stale-${suffix}`);
    await assert.rejects(deliver({
      context,
      fixture: { ...stale, input: { ...stale.input, sourceMessageId: "older-message" } },
      provider: guardProvider,
    }), /newer supplier message/);
    const wrongRecipient = fixture(workspace.id, `recipient-${suffix}`);
    await assert.rejects(deliver({
      context,
      fixture: { ...wrongRecipient, input: { ...wrongRecipient.input, recipient: "other@example.com" } },
      provider: guardProvider,
    }), /recipient changed/);
    const closed = fixture(workspace.id, `closed-${suffix}`);
    closed.conversation.messages.push({
      ...closed.conversation.messages[0]!,
      id: "local-outbound",
      direction: "OUTBOUND",
      fromEmail: "operator@derya.ai",
      toEmails: [closed.input.recipient],
      sentAt: "2026-08-22T16:01:00.000Z",
    });
    await assert.rejects(deliver({ context, fixture: closed, provider: guardProvider }), /not awaiting a reply/);
    assert.equal(rejectedBeforeProvider, 0, "Stale, changed-recipient, and closed-thread requests must stop before Gmail.");

    const success = fixture(workspace.id, `success-${suffix}`);
    const successfulSends: SupplierEmailSendInput[] = [];
    const successProvider: SupplierEmailProvider = {
      send: async (input) => {
        successfulSends.push(input);
        return sentReceipt(input);
      },
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    const delivered = await deliver({ context, fixture: success, provider: successProvider });
    assert.equal(delivered.alreadySent, false);
    assert.equal(successfulSends.length, 1);
    const replayed = await deliver({ context, fixture: success, provider: successProvider });
    assert.equal(replayed.alreadySent, true);
    assert.equal(successfulSends.length, 1, "A successful replay must not call Gmail again.");
    await assert.rejects(deliver({
      context,
      fixture: { ...success, input: { ...success.input, body: `${success.input.body} Changed.` } },
      provider: successProvider,
    }), /different reply attempt/);
    assert.equal(successfulSends.length, 1);
    const successTasks = await prisma.supplyExecutionTask.findMany({
      where: { officeId: office.id, taskType: "PROCUREMENT_SUPPLIER_REPLY_EMAIL", input: { path: ["sourceMessageId"], equals: success.input.sourceMessageId } },
      include: { events: true },
    });
    assert.equal(successTasks.length, 1);
    assert.equal(successTasks[0]?.status, "SUCCEEDED");
    assert.deepEqual(successTasks[0]?.events.map((event) => event.eventType), [
      "PROCUREMENT_SUPPLIER_REPLY_SEND_STARTED",
      "PROCUREMENT_SUPPLIER_REPLY_SENT",
    ]);
    assert.equal(await prisma.emailMessage.count({ where: { gmailMessageId: delivered.providerMessageId } }), 1);
    // An attachment free reply must hash exactly as it did before attachments
    // existed, or a delivery left unresolved across a deploy could never be
    // reconciled.
    const successInput = successTasks[0]?.input as { message?: Record<string, unknown> } | null;
    assert.ok(
      successInput?.message && !("attachments" in successInput.message),
      "An attachment free reply must not add an attachments key to the hashed message.",
    );

    const unknown = fixture(workspace.id, `unknown-${suffix}`);
    let unknownSendCount = 0;
    let unknownReconcileCount = 0;
    const unknownProvider: SupplierEmailProvider = {
      send: async () => {
        unknownSendCount += 1;
        return { state: "UNKNOWN", error: "The test transport timed out." };
      },
      reconcile: async (input) => {
        unknownReconcileCount += 1;
        return sentReceipt({
          ...successfulSends[0]!,
          accountId: input.accountId,
          officeId: input.officeId,
          senderEmail: input.senderEmail,
          rfcMessageId: input.rfcMessageId,
          providerThreadId: `thread-unknown-${suffix}`,
        });
      },
    };
    await assert.rejects(deliver({ context, fixture: unknown, provider: unknownProvider }), /timed out/);
    await assert.rejects(deliver({
      context,
      fixture: { ...unknown, input: { ...unknown.input, body: `${unknown.input.body} Changed.` } },
      provider: unknownProvider,
    }), /different reply attempt/);
    assert.equal(unknownReconcileCount, 0, "Changed content must not reconcile an uncertain different message.");
    const reconciled = await deliver({ context, fixture: unknown, provider: unknownProvider });
    assert.equal(reconciled.alreadySent, false);
    assert.equal(unknownSendCount, 1, "An unknown delivery must reconcile before another send.");
    assert.equal(unknownReconcileCount, 1);
    const reconciledReplay = await deliver({ context, fixture: unknown, provider: unknownProvider });
    assert.equal(reconciledReplay.alreadySent, true);
    assert.equal(unknownSendCount, 1);
    assert.equal(unknownReconcileCount, 1);

    // Attachment bytes are only needed by a fresh send, so a storage failure
    // must never block reconciliation of a delivery that is still unresolved.
    const attachmentCompany = await prisma.company.create({
      data: { officeId: office.id, name: `Reply customer ${suffix}` },
    });
    const attachmentWorkspace = await prisma.supplyWorkspace.create({
      data: {
        officeId: office.id,
        companyId: attachmentCompany.id,
        createdByUserId: user.id,
        name: `Reply attachment workspace ${suffix}`,
      },
    });
    const withFiles = fixture(attachmentWorkspace.id, `files-${suffix}`);
    const documentId = `context-document-${suffix}`;
    withFiles.order.requestContext = {
      source: { workspace_id: attachmentWorkspace.id },
      procurement_context: {
        documents: [{
          citation_id: `document:${documentId}`,
          name: "assembly-bom.csv",
          summary: null,
          markdown: "Stored BOM facts.",
        }],
      },
    };
    withFiles.input = { ...withFiles.input, attachmentDocumentIds: [documentId] };
    let attachmentLoads = 0;
    let attachmentStorageBroken = false;
    const loadAttachments: typeof loadRequestDocumentAttachments = async (loadArgs) => {
      attachmentLoads += 1;
      if (attachmentStorageBroken) throw new Error("Document storage is unavailable.");
      return {
        attachments: loadArgs.documentIds.map(() => ({
          filename: "assembly-bom.csv",
          contentType: "text/csv",
          bytes: Buffer.from("Designator,Manufacturer_Part_Number\nR1,RC0402FR-0710KL\n", "utf-8"),
        })),
        skipped: [],
      };
    };
    let fileSendCount = 0;
    let fileReconcileCount = 0;
    let sentWithAttachments = 0;
    const fileProvider: SupplierEmailProvider = {
      send: async (input) => {
        fileSendCount += 1;
        sentWithAttachments = input.attachments?.length ?? 0;
        return { state: "UNKNOWN", error: "The test transport timed out." };
      },
      reconcile: async (input) => {
        fileReconcileCount += 1;
        return sentReceipt({
          ...successfulSends[0]!,
          accountId: input.accountId,
          officeId: input.officeId,
          senderEmail: input.senderEmail,
          rfcMessageId: input.rfcMessageId,
          providerThreadId: `thread-files-${suffix}`,
        });
      },
    };
    await assert.rejects(deliver({
      context,
      fixture: withFiles,
      provider: fileProvider,
      requestDocumentAttachments: loadAttachments,
    }), /timed out/);
    assert.equal(attachmentLoads, 1, "A fresh send must load the selected request files.");
    assert.equal(sentWithAttachments, 1);
    attachmentStorageBroken = true;
    const fileReconciled = await deliver({
      context,
      fixture: withFiles,
      provider: fileProvider,
      requestDocumentAttachments: loadAttachments,
    });
    assert.equal(fileReconciled.alreadySent, false);
    assert.equal(fileSendCount, 1);
    assert.equal(fileReconcileCount, 1, "An unresolved send must reconcile even when storage is failing.");
    assert.equal(attachmentLoads, 1, "Reconciliation must not read attachment bytes again.");
    const reconciledMessage = await prisma.emailMessage.findFirst({
      where: { gmailMessageId: fileReconciled.providerMessageId },
      select: { attachments: true },
    });
    assert.deepEqual(JSON.parse(reconciledMessage?.attachments ?? "null"), [{ name: "assembly-bom.csv" }]);

    // A file that cannot be read after the claim has to fail the attempt, or the
    // operator would be stuck reconciling a message Gmail never received.
    const unreadableFiles = fixture(attachmentWorkspace.id, `files-unreadable-${suffix}`);
    unreadableFiles.order.requestContext = withFiles.order.requestContext;
    unreadableFiles.input = { ...unreadableFiles.input, attachmentDocumentIds: [documentId] };
    let unreadableSendCount = 0;
    const unreadableProvider: SupplierEmailProvider = {
      send: async (input) => {
        unreadableSendCount += 1;
        return sentReceipt(input);
      },
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    await assert.rejects(deliver({
      context,
      fixture: unreadableFiles,
      provider: unreadableProvider,
      requestDocumentAttachments: loadAttachments,
    }), /Document storage is unavailable/);
    assert.equal(unreadableSendCount, 0, "A failed file load must not reach the provider.");
    attachmentStorageBroken = false;
    const recovered = await deliver({
      context,
      fixture: unreadableFiles,
      provider: unreadableProvider,
      requestDocumentAttachments: loadAttachments,
    });
    assert.equal(recovered.alreadySent, false);
    assert.equal(unreadableSendCount, 1, "A file load failure must stay retryable instead of reconciling forever.");

    const rejected = fixture(workspace.id, `rejected-${suffix}`);
    const rejectedIds: string[] = [];
    let rejectFirst = true;
    const rejectionProvider: SupplierEmailProvider = {
      send: async (input) => {
        rejectedIds.push(input.rfcMessageId);
        if (rejectFirst) {
          rejectFirst = false;
          return { state: "REJECTED", error: "The test sender rejected the message." };
        }
        return sentReceipt(input);
      },
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    await assert.rejects(deliver({ context, fixture: rejected, provider: rejectionProvider }), /rejected/);
    const changed = { ...rejected, input: { ...rejected.input, body: `${rejected.input.body} Changed.` } };
    await assert.rejects(deliver({ context, fixture: changed, provider: rejectionProvider }), /different reply attempt/);
    assert.equal(rejectedIds.length, 1);
    await deliver({ context, fixture: rejected, provider: rejectionProvider });
    assert.equal(rejectedIds.length, 2);
    assert.notEqual(rejectedIds[0], rejectedIds[1], "A definitive failed retry must use a new RFC Message-ID.");

    const concurrent = fixture(workspace.id, `concurrent-${suffix}`);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let concurrentSendCount = 0;
    let concurrentReconcileCount = 0;
    const concurrentProvider: SupplierEmailProvider = {
      send: async (input) => {
        concurrentSendCount += 1;
        markStarted();
        await firstGate;
        return sentReceipt(input);
      },
      reconcile: async () => {
        concurrentReconcileCount += 1;
        return { state: "NOT_FOUND" };
      },
    };
    const first = deliver({ context, fixture: concurrent, provider: concurrentProvider });
    await started;
    await assert.rejects(deliver({ context, fixture: concurrent, provider: concurrentProvider }), /still unresolved/);
    releaseFirst();
    await first;
    assert.equal(concurrentSendCount, 1, "Concurrent confirmation must create one provider send.");
    assert.equal(concurrentReconcileCount, 1);
    assert.equal(await prisma.supplyExecutionTask.count({
      where: { officeId: office.id, taskType: "PROCUREMENT_SUPPLIER_REPLY_EMAIL", input: { path: ["sourceMessageId"], equals: concurrent.input.sourceMessageId } },
    }), 1);

    await assert.rejects(deliver({
      context: { officeId: office.id, userId: viewer.id, role: "EMPLOYEE", canViewWholeOffice: false },
      fixture: fixture(workspace.id, `viewer-${suffix}`),
      provider: successProvider,
    }), /cannot edit/);
    await assert.rejects(deliver({
      context: { officeId: foreignOffice.id, userId: foreignUser.id, role: "ADMIN", canViewWholeOffice: true },
      fixture: fixture(workspace.id, `foreign-workspace-${suffix}`),
      provider: successProvider,
    }), /not found/);
    // Mailboxes are one shared pool, so a mailbox connected by another office
    // still sends, while a mailbox with sending switched off never does.
    const pooled = await deliver({
      context,
      fixture: fixture(workspace.id, `pooled-sender-${suffix}`, "foreign-only@derya.ai"),
      provider: successProvider,
    });
    assert.equal(pooled.alreadySent, false);
    await assert.rejects(deliver({
      context,
      fixture: fixture(workspace.id, `send-disabled-${suffix}`, "send-disabled@derya.ai"),
      provider: successProvider,
    }), /disconnected or disabled/);

    console.log("Supplier reply send task, persistence, attachment ordering, reconciliation, concurrency, and tenant checks passed.");
  } finally {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
      await tx.office.deleteMany({ where: { id: { in: [office.id, foreignOffice.id] } } });
    });
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
