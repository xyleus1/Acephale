import "server-only";

import { createHash } from "node:crypto";
import { batchRecipientHash } from "@/lib/batch-review";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { listSuppressedEmails, upsertEmailSuppression, type EmailSuppressionReason } from "@/lib/email-delivery-events";
import {
  describeRecipientQualityBlock,
  LiveRecipientGate,
  RECIPIENT_QUALITY_SUPPRESSION_SOURCE,
  recipientQualityRefusal,
  recipientQualityVerdict,
  type LiveRecipientCheck,
} from "@/lib/outreach-recipient-quality";
import { suppressionSkipMessage } from "@/lib/email-delivery-feedback";
import { stripEmDashes } from "@/lib/no-em-dash";
import { prisma } from "@/lib/prisma";
import {
  advanceProcurementOrderStatus,
  reconcileProcurementOrderStatus,
} from "@/lib/procurement-order-status";
import {
  EMPTY_RFQ_ATTACHMENT_PACKAGE,
  loadProcurementRfqAttachmentPackage,
  type ProcurementRfqAttachmentPackage,
} from "@/lib/procurement-rfq-attachments";
import {
  procurementOfficeIdFromServerMetadata,
  procurementWorkflowDatabase,
} from "@/lib/procurement-workflow";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
} from "@/lib/supply-os/supplier-email-provider";

export const BULK_RFQ_SENDABLE_STATUSES = ["researched", "shortlisted", "approved"] as const;
export const BULK_RFQ_MAX_PER_RUN = 120;
export const BULK_RFQ_MAX_RECONCILE_PER_RUN = 20;

// Bourne-owned order_vendors rows store the supplier address either on the
// column or inside nested research and identity JSON. Read every shape the
// procurement detail view reads so the campaign contacts the same pool.
export const BULK_RFQ_VENDOR_EMAIL_SQL = `COALESCE(
    to_jsonb(order_vendors)->>'contact_email',
    to_jsonb(order_vendors)->'contact'->>'email',
    to_jsonb(order_vendors)->'identity'->>'contact_email',
    to_jsonb(order_vendors)->'identity'->>'email',
    to_jsonb(order_vendors)->'research'->>'contact_email',
    to_jsonb(order_vendors)->'research'->'contact'->>'email',
    to_jsonb(order_vendors)->'research'->'identity'->>'email'
  )`;

export type BulkRfqOrder = {
  orderId: string;
  customerId: string;
  officeId: string;
  sourceWorkspaceId: string | null;
  companyName: string;
  material: string;
  specification: string | null;
  quantity: string;
  unit: string;
  neededBy: string | null;
  notes: string | null;
};

export type BulkRfqTarget = {
  vendorId: string;
  name: string;
  website: string | null;
  contactEmail: string;
};

export type BulkRfqOutcome = {
  vendorId: string;
  vendorName: string;
  recipient: string;
  state: "SENT" | "ALREADY_SENT" | "REJECTED" | "UNKNOWN" | "POOL_EXHAUSTED" | "BLOCKED";
  senderEmail: string | null;
  providerMessageId: string | null;
  error: string | null;
};

export type BulkRfqBatchOptions = {
  // Restrict the run to these vendors, used when a caller knows exactly which
  // suppliers it means rather than "the next few uncontacted ones".
  vendorIds?: readonly string[] | null;
  // Suppliers a reviewer struck from the batch. They stay uncontacted, so a
  // later run without the exclusion can still reach them.
  excludeVendorIds?: readonly string[] | null;
};

// Thrown before any sender is reserved when the batch a reviewer approved is
// not the batch the run would send: a supplier was added, contacted elsewhere,
// suppressed, or its address changed since the preview, or the RFQ copy or
// files the suppliers would receive are not the ones that were reviewed.
export class BulkRfqBatchChangedError extends Error {
  readonly code = "BATCH_CHANGED" as const;
  constructor(readonly expectedHash: string, readonly currentHash: string) {
    super("The supplier batch or its RFQ content changed since it was reviewed. Preview it again before sending.");
    this.name = "BulkRfqBatchChangedError";
  }
}

export type BulkRfqRunResult = {
  orderId: string;
  material: string;
  batchHash: string;
  attachments: string[];
  withheldFiles: Array<{ name: string; reason: string }>;
  candidates: number;
  sent: number;
  alreadySent: number;
  rejected: number;
  unknown: number;
  // Reviewed suppliers the live recipient gate refused right before sending
  // (Null MX, dead domain, verifier undeliverable). Reported as BLOCKED
  // outcomes; they never reserve a mailbox slot.
  pruned: number;
  // Paid mailbox verifications spent by this run.
  verificationChecks: number;
  verifierExhausted: boolean;
  poolExhausted: boolean;
  outcomes: BulkRfqOutcome[];
};

type OrderRow = {
  orderId: string;
  customerId: string;
  sourceWorkspaceId: string | null;
  companyName: string | null;
  material: string;
  specification: string | null;
  quantity: string;
  unit: string;
  neededBy: Date | null;
  notes: string | null;
};

type VendorRow = {
  vendorId: string;
  name: string;
  website: string | null;
  contactEmail: string | null;
  status: string;
  lastEmailMessageId: string | null;
};

function clean(value: string) {
  return stripEmDashes(value).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function quantityText(order: BulkRfqOrder) {
  const numeric = Number(order.quantity);
  const quantity = Number.isFinite(numeric) ? String(numeric) : order.quantity;
  return `${quantity} ${order.unit}`.trim();
}

export function buildBulkRfqSubject(order: BulkRfqOrder) {
  const reference = order.orderId.slice(0, 8);
  return clean(`[RFQ ${reference}] ${order.material}, ${quantityText(order)}`).slice(0, 180);
}

export function buildBulkRfqBody(
  order: BulkRfqOrder,
  target: BulkRfqTarget,
  files: ProcurementRfqAttachmentPackage = EMPTY_RFQ_ATTACHMENT_PACKAGE,
) {
  const greetingName = clean(target.name).replace(/[.,]$/, "");
  const lines = [
    `Hello ${greetingName || "there"},`,
    "",
    `We are sourcing on behalf of ${order.companyName} and would like a quotation for the following build.`,
    "",
    `Item: ${clean(order.material)}`,
    `Quantity: ${quantityText(order)}`,
    ...(order.neededBy ? [`Needed by: ${order.neededBy}`] : []),
    ...(files.names.length
      ? ["", "Attached files:", ...files.names.map((name) => `- ${name}`)]
      : []),
    "",
    "Specification:",
    stripEmDashes(order.specification?.trim() || "Full specification available on request."),
    ...(files.contextSections.length ? ["", ...files.contextSections] : []),
    ...(order.notes?.trim() ? ["", "Additional notes:", stripEmDashes(order.notes.trim())] : []),
    ...(files.attachments.length
      ? ["", "The figures above are read from the attached files, so please treat the files as the controlling source and tell us where they disagree with your process."]
      : []),
    "",
    "Please reply with:",
    "1. Unit price at the quantity above, and price at 250 and 500 units.",
    "2. Tooling, setup, or NRE cost if any.",
    "3. Lead time for tooling and for production.",
    "4. Any specification clarification you need before quoting.",
    "5. Payment terms and shipping origin.",
    "",
    "If this build is outside your capability, a short note back is appreciated so we can close the loop.",
    "",
    "Thank you,",
    "Sourcing desk",
    `Derya Supply OS, for ${order.companyName}`,
  ];
  return stripEmDashes(lines.join("\n")).slice(0, 20_000);
}

export async function loadBulkRfqOrder(orderId: string): Promise<BulkRfqOrder | null> {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<OrderRow[]>(`
    SELECT
      orders.id AS "orderId",
      orders.customer_id AS "customerId",
      orders.request_context->'source'->>'workspace_id' AS "sourceWorkspaceId",
      orders.request_context->'source'->>'company_name' AS "companyName",
      bill_of_materials.material AS "material",
      bill_of_materials.specification AS "specification",
      orders.quantity::text AS "quantity",
      orders.unit AS "unit",
      orders.needed_by AS "neededBy",
      orders.notes AS "notes"
    FROM orders
    JOIN bill_of_materials
      ON bill_of_materials.id = orders.bom_id
      AND bill_of_materials.customer_id = orders.customer_id
    WHERE orders.id = $1::uuid
  `, orderId);
  const row = rows.at(0);
  if (!row) return null;
  return {
    orderId: row.orderId,
    customerId: row.customerId,
    officeId: procurementOfficeIdFromServerMetadata(row.customerId),
    sourceWorkspaceId: row.sourceWorkspaceId,
    companyName: clean(row.companyName ?? "our customer"),
    material: row.material,
    specification: row.specification,
    quantity: row.quantity,
    unit: row.unit,
    neededBy: row.neededBy ? row.neededBy.toISOString().slice(0, 10) : null,
    notes: row.notes,
  };
}

export function boundedBulkRfqLimit(limit: number) {
  return Math.min(BULK_RFQ_MAX_PER_RUN, Math.max(1, limit));
}

// The reviewed batch for a request: the same office-scoped suppression and
// sendable-count limit the run applies, so a preview shows exactly the
// suppliers a send with the same limit would reach, plus the ones it blocks.
// The files are part of the review, so the caller resolves them first and
// the hash covers them together with the recipients.
export async function listBulkRfqTargets(
  order: BulkRfqOrder,
  limit: number,
  // A sourcing wave contacts the suppliers it just found. Oldest first ordering
  // would otherwise spend the run on vendors that were already sitting there.
  vendorIds: readonly string[] | null,
  options: Omit<BulkRfqBatchOptions, "vendorIds"> & { files: ProcurementRfqAttachmentPackage },
): Promise<{ sendable: BulkRfqTarget[]; blocked: BulkRfqOutcome[]; batchHash: string }> {
  const uncontacted = await listUncontactedBulkRfqTargets(order, vendorIds, options);
  const batch = selectBulkRfqBatch(
    uncontacted,
    await listSuppressedEmails(order.officeId, uncontacted.map((target) => target.contactEmail)),
    limit,
  );
  return { ...batch, batchHash: bulkRfqBatchHash(order, batch.sendable, options.files) };
}

// Pins a reviewed batch as what each supplier would receive: per target, the
// vendor id, normalized address, subject, and the body exactly as the send
// renders it (so the greeting name, the order copy, and the file context are
// all covered), plus the exact bytes of every attachment. Order independent.
// A send that carries the hash refuses to run when any of it differs.
export function bulkRfqBatchHash(
  order: BulkRfqOrder,
  targets: readonly BulkRfqTarget[],
  files: ProcurementRfqAttachmentPackage,
) {
  const subject = buildBulkRfqSubject(order);
  return requestHash({
    recipients: batchRecipientHash(targets.map((target) => ({ id: target.vendorId, email: target.contactEmail }))),
    messages: [...targets]
      .sort((left, right) => left.vendorId.localeCompare(right.vendorId))
      .map((target) => ({ vendorId: target.vendorId, subject, body: buildBulkRfqBody(order, target, files) })),
    attachments: files.attachments.map((file) => ({
      filename: file.filename,
      contentType: file.contentType,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
    })),
  });
}

// Every uncontacted supplier of the request, oldest first, before any run limit
// is applied. Suppression is decided on this list so blocked suppliers at the
// front never use up a run's slots.
export async function listUncontactedBulkRfqTargets(
  order: BulkRfqOrder,
  vendorIds?: readonly string[] | null,
  options: Omit<BulkRfqBatchOptions, "vendorIds"> = {},
): Promise<BulkRfqTarget[]> {
  const only = vendorIds?.length ? new Set(vendorIds) : null;
  // Vendor ids are uuids; Postgres returns them lowercase, so a struck id is
  // matched case-insensitively.
  const excluded = new Set((options.excludeVendorIds ?? []).map((id) => id.trim().toLowerCase()));
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<VendorRow[]>(`
    SELECT
      order_vendors.id AS "vendorId",
      order_vendors.name AS "name",
      order_vendors.website AS "website",
      ${BULK_RFQ_VENDOR_EMAIL_SQL} AS "contactEmail",
      order_vendors.status AS "status",
      order_vendors.last_email_message_id AS "lastEmailMessageId"
    FROM order_vendors
    WHERE order_vendors.order_id = $1::uuid
      AND order_vendors.status IN ('researched', 'shortlisted', 'approved')
      AND ${BULK_RFQ_VENDOR_EMAIL_SQL} IS NOT NULL
      AND order_vendors.last_email_message_id IS NULL
    ORDER BY order_vendors.created_at ASC, order_vendors.id ASC
  `, order.orderId);
  const contacted = await prisma.emailSenderReservation.findMany({
    where: {
      officeId: order.officeId,
      status: { in: ["RESERVED", "RECORDED"] },
      idempotencyKey: { startsWith: `procurement-bulk-rfq:${order.orderId}:` },
    },
    select: { idempotencyKey: true },
  });
  const alreadyHandled = new Set(contacted.map((entry) => entry.idempotencyKey.split(":").at(-1)));
  return rows
    .filter((row): row is VendorRow & { contactEmail: string } => Boolean(row.contactEmail?.includes("@")))
    .filter((row) => !only || only.has(row.vendorId))
    .filter((row) => !excluded.has(row.vendorId.toLowerCase()))
    .filter((row) => !alreadyHandled.has(row.vendorId))
    .map((row) => ({
      vendorId: row.vendorId,
      name: row.name,
      website: row.website,
      contactEmail: row.contactEmail.trim().toLowerCase(),
    }));
}

// Suppressed supplier addresses (bounced, complained, opted out, or blocked by
// an operator for this office) are reported as BLOCKED and never reach the
// sender pool. The vendor row stays uncontacted so a corrected address can be
// picked up by a later run.
// Suppressed suppliers and suppliers whose address fails the product-wide
// recipient quality gate (placeholder, disposable, invalid) are blocked alike,
// so the preview and the send agree on who can actually be mailed.
export function partitionSuppressedRfqTargets(
  targets: readonly BulkRfqTarget[],
  suppressed: ReadonlyMap<string, EmailSuppressionReason>,
) {
  const blocked: BulkRfqOutcome[] = [];
  const sendable: BulkRfqTarget[] = [];
  const block = (target: BulkRfqTarget, error: string) => {
    blocked.push({
      vendorId: target.vendorId,
      vendorName: target.name,
      recipient: target.contactEmail,
      state: "BLOCKED",
      senderEmail: null,
      providerMessageId: null,
      error,
    });
  };
  for (const target of targets) {
    const reason = suppressed.get(target.contactEmail.trim().toLowerCase());
    if (reason) {
      block(target, suppressionSkipMessage(reason));
      continue;
    }
    const quality = recipientQualityVerdict({ email: target.contactEmail, data: { website: target.website ?? "" } });
    if (quality.blocked) {
      block(target, `Recipient skipped: ${describeRecipientQualityBlock(quality.reason, quality.detail)}.`);
      continue;
    }
    sendable.push(target);
  }
  return { blocked, sendable };
}

// The run limit counts suppliers that can actually be mailed. Blocked suppliers
// are reported but never occupy a slot, so a request whose oldest rows are all
// suppressed still reaches the eligible ones behind them.
export function selectBulkRfqBatch(
  candidates: readonly BulkRfqTarget[],
  suppressed: ReadonlyMap<string, EmailSuppressionReason>,
  limit: number,
) {
  const { blocked, sendable } = partitionSuppressedRfqTargets(candidates, suppressed);
  return { blocked, sendable: sendable.slice(0, boundedBulkRfqLimit(limit)) };
}

async function recordSentRfq(args: {
  officeId: string;
  orderId: string;
  vendorId: string;
  accountId: string;
  reservationId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  rfcMessageId: string;
  providerMessageId: string;
  providerThreadId: string;
}) {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const existing = await tx.emailMessage.findFirst({
      where: {
        thread: { officeId: args.officeId },
        OR: [{ gmailMessageId: args.providerMessageId }, { externalId: args.rfcMessageId }],
      },
      select: { id: true, threadId: true },
    });
    let localThreadId = existing?.threadId ?? null;
    let localMessageId = existing?.id ?? null;
    if (!localMessageId) {
      const thread = await tx.emailThread.create({
        data: {
          officeId: args.officeId,
          subject: args.subject.slice(0, 180),
          participants: JSON.stringify([args.senderEmail, args.recipient]),
          externalThreadId: args.providerThreadId,
          lastMessageAt: now,
          messageCount: 1,
        },
        select: { id: true },
      });
      localThreadId = thread.id;
      const message = await tx.emailMessage.create({
        data: {
          threadId: thread.id,
          accountId: args.accountId,
          officeId: args.officeId,
          externalId: args.rfcMessageId,
          gmailMessageId: args.providerMessageId,
          rfcMessageId: args.rfcMessageId,
          direction: "OUTBOUND",
          fromEmail: args.senderEmail,
          toEmails: JSON.stringify([args.recipient]),
          subject: args.subject.slice(0, 180),
          bodyText: args.body,
          sentAt: now,
        },
        select: { id: true },
      });
      localMessageId = message.id;
    }
    await tx.emailSenderReservation.updateMany({
      where: {
        id: args.reservationId,
        officeId: args.officeId,
        accountId: args.accountId,
        status: "RESERVED",
      },
      data: {
        status: "RECORDED",
        providerMessageId: args.providerMessageId,
        providerThreadId: args.providerThreadId,
        localThreadId,
        messageId: localMessageId,
      },
    });
  });
  await markSupplierContacted(args.orderId, args.vendorId, args.rfcMessageId, args.providerThreadId);
}

// The workflow tables are owned by Bourne, so a restricted role can read but not always write them.
// The send is already recorded locally, so a failed write back is logged and never fails the send.
async function markSupplierContacted(
  orderId: string,
  vendorId: string,
  rfcMessageId: string,
  providerThreadId: string,
) {
  try {
    await workflowSupplierContactedUpdate(orderId, vendorId, rfcMessageId, providerThreadId);
  } catch (error) {
    console.error("bulk rfq supplier write back failed", {
      orderId,
      vendorId,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function workflowSupplierContactedUpdate(
  orderId: string,
  vendorId: string,
  rfcMessageId: string,
  providerThreadId: string,
) {
  await procurementWorkflowDatabase().$executeRawUnsafe(
    `
      UPDATE order_vendors
      SET status = 'contacted',
          last_email_message_id = COALESCE(last_email_message_id, $3),
          email_thread_id = COALESCE(email_thread_id, $4)
      WHERE id = $2::uuid
        AND order_id = $1::uuid
    `,
    orderId,
    vendorId,
    rfcMessageId,
    providerThreadId,
  );
}

export async function reconcileProcurementBulkRfq(input: {
  orderId: string;
  limit?: number;
  provider?: SupplierEmailProvider;
  attachRequestFiles?: boolean;
  loadFiles?: typeof loadProcurementRfqAttachmentPackage;
}) {
  const order = await loadBulkRfqOrder(input.orderId);
  if (!order) throw new Error("The sourcing request was not found.");
  const provider = input.provider ?? gmailSupplierEmailProvider;
  // A reconciled send is recorded with the body it actually carried, so the
  // same file package the run used has to be resolved again here.
  const files = input.attachRequestFiles === false
    ? EMPTY_RFQ_ATTACHMENT_PACKAGE
    : await (input.loadFiles ?? loadProcurementRfqAttachmentPackage)({
      orderId: order.orderId,
      customerId: order.customerId,
      officeId: order.officeId,
    });
  const pending = await prisma.emailSenderReservation.findMany({
    where: {
      officeId: order.officeId,
      status: "RESERVED",
      idempotencyKey: { startsWith: `procurement-bulk-rfq:${order.orderId}:` },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(BULK_RFQ_MAX_RECONCILE_PER_RUN, Math.max(1, input.limit ?? BULK_RFQ_MAX_RECONCILE_PER_RUN)),
    select: {
      id: true,
      accountId: true,
      idempotencyKey: true,
      account: { select: { email: true } },
    },
  });
  const outcomes: Array<{ vendorId: string; state: "SENT" | "NOT_FOUND" | "UNKNOWN"; error: string | null }> = [];
  for (const reservation of pending) {
    const vendorId = reservation.idempotencyKey.split(":").at(-1) ?? "";
    const rfcMessageId = `<procurement-rfq-${order.orderId.slice(0, 8)}-${vendorId}@derya.ai>`;
    const receipt = await provider.reconcile({
      officeId: order.officeId,
      accountId: reservation.accountId,
      senderEmail: reservation.account.email,
      rfcMessageId,
    });
    if (receipt.state === "SENT") {
      const targets = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{ name: string; contactEmail: string | null }>>(`
        SELECT order_vendors.name AS "name", ${BULK_RFQ_VENDOR_EMAIL_SQL} AS "contactEmail"
        FROM order_vendors
        WHERE order_vendors.id = $1::uuid AND order_vendors.order_id = $2::uuid
      `, vendorId, order.orderId);
      const target = targets.at(0);
      if (!target?.contactEmail) {
        outcomes.push({ vendorId, state: "UNKNOWN", error: "The supplier recipient is missing." });
        continue;
      }
      await recordSentRfq({
        officeId: order.officeId,
        orderId: order.orderId,
        vendorId,
        accountId: reservation.accountId,
        reservationId: reservation.id,
        senderEmail: reservation.account.email,
        recipient: target.contactEmail.trim().toLowerCase(),
        subject: buildBulkRfqSubject(order),
        body: buildBulkRfqBody(order, {
          vendorId,
          name: target.name,
          website: null,
          contactEmail: target.contactEmail.trim().toLowerCase(),
        }, files),
        rfcMessageId,
        providerMessageId: receipt.providerMessageId,
        providerThreadId: receipt.providerThreadId,
      });
      outcomes.push({ vendorId, state: "SENT", error: null });
      if (outcomes.filter((outcome) => outcome.state === "SENT").length === 1) {
        await advanceProcurementOrderStatus({
          customerId: order.customerId,
          orderId: order.orderId,
          event: "rfq_sent",
        });
      }
      continue;
    }
    if (receipt.state === "NOT_FOUND") {
      await releaseEmailSenderReservation({ officeId: order.officeId, reservationId: reservation.id });
      outcomes.push({ vendorId, state: "NOT_FOUND", error: null });
      continue;
    }
    outcomes.push({ vendorId, state: "UNKNOWN", error: receipt.error ?? null });
  }
  const remaining = await prisma.emailSenderReservation.count({
    where: {
      officeId: order.officeId,
      status: "RESERVED",
      idempotencyKey: { startsWith: `procurement-bulk-rfq:${order.orderId}:` },
    },
  });
  return { orderId: order.orderId, reconciled: outcomes.length, remaining, outcomes };
}

export async function runProcurementBulkRfq(input: {
  orderId: string;
  limit: number;
  provider?: SupplierEmailProvider;
  pauseMs?: number;
  // The request's own files ride along by default. A caller can opt out, and a
  // request with nothing linked simply sends the text RFQ it always sent.
  attachRequestFiles?: boolean;
  loadFiles?: typeof loadProcurementRfqAttachmentPackage;
  // The batch hash from the preview the operator approved. When present, the
  // run refuses to send anything unless it would send exactly that batch.
  expectedBatchHash?: string | null;
  advanceStatus?: typeof advanceProcurementOrderStatus;
  reconcileStatus?: typeof reconcileProcurementOrderStatus;
  loadOrder?: typeof loadBulkRfqOrder;
  loadTargets?: typeof listUncontactedBulkRfqTargets;
  listSuppressed?: typeof listSuppressedEmails;
  reserveSender?: typeof reserveEmailSender;
  recipientCheck?: LiveRecipientCheck;
  suppress?: typeof upsertEmailSuppression;
} & BulkRfqBatchOptions): Promise<BulkRfqRunResult> {
  const advanceStatus = input.advanceStatus ?? advanceProcurementOrderStatus;
  const reconcileStatus = input.reconcileStatus ?? reconcileProcurementOrderStatus;
  const order = await (input.loadOrder ?? loadBulkRfqOrder)(input.orderId);
  if (!order) throw new Error("The sourcing request was not found.");
  await reconcileStatus({
    customerId: order.customerId,
    orderId: order.orderId,
    officeId: order.officeId,
  });
  const provider = input.provider ?? gmailSupplierEmailProvider;
  const pauseMs = input.pauseMs ?? 400;
  const uncontacted = await (input.loadTargets ?? listUncontactedBulkRfqTargets)(order, input.vendorIds ?? null, {
    excludeVendorIds: input.excludeVendorIds ?? null,
  });
  const { blocked, sendable: targets } = selectBulkRfqBatch(
    uncontacted,
    await (input.listSuppressed ?? listSuppressedEmails)(order.officeId, uncontacted.map((target) => target.contactEmail)),
    input.limit,
  );
  // A loader failure throws here, before the hash check, so it can never be
  // read as "no files" and pass a review that saw files, or the reverse.
  const files = input.attachRequestFiles === false
    ? EMPTY_RFQ_ATTACHMENT_PACKAGE
    : await (input.loadFiles ?? loadProcurementRfqAttachmentPackage)({
      orderId: order.orderId,
      customerId: order.customerId,
      officeId: order.officeId,
    });
  const batchHash = bulkRfqBatchHash(order, targets, files);
  if (input.expectedBatchHash && input.expectedBatchHash !== batchHash) {
    throw new BulkRfqBatchChangedError(input.expectedBatchHash, batchHash);
  }
  const subject = buildBulkRfqSubject(order);
  const result: BulkRfqRunResult = {
    orderId: order.orderId,
    material: order.material,
    batchHash,
    attachments: files.names,
    withheldFiles: files.withheld,
    candidates: blocked.length + targets.length,
    sent: 0,
    alreadySent: 0,
    rejected: 0,
    unknown: 0,
    pruned: 0,
    verificationChecks: 0,
    verifierExhausted: false,
    poolExhausted: false,
    outcomes: [...blocked],
  };
  // One gate per run so each domain's MX is looked up once and the paid
  // verifier budget covers the whole reviewed batch.
  const gate = new LiveRecipientGate(input.recipientCheck);

  for (const target of targets) {
    // Live recipient gate before any mailbox capacity is reserved: the batch
    // was reviewed by hash, so a refused supplier is reported, never replaced.
    const quality = await gate.check(target, target.contactEmail, { website: target.website ?? "" });
    result.verificationChecks = gate.paidChecks;
    result.verifierExhausted = gate.verifierExhausted();
    if (!quality.ok) {
      const refusal = recipientQualityRefusal(quality);
      if (refusal.permanent) {
        await (input.suppress ?? upsertEmailSuppression)(prisma, {
          officeId: order.officeId,
          email: target.contactEmail,
          reason: "UNDELIVERABLE",
          source: RECIPIENT_QUALITY_SUPPRESSION_SOURCE,
          detail: refusal.detail,
          evidenceMessageId: null,
          accountId: null,
        });
      }
      result.pruned += 1;
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.name,
        recipient: target.contactEmail,
        state: "BLOCKED",
        senderEmail: null,
        providerMessageId: null,
        error: refusal.error,
      });
      continue;
    }
    const body = buildBulkRfqBody(order, target, files);
    const hash = requestHash({ orderId: order.orderId, vendorId: target.vendorId, recipient: target.contactEmail, subject, body });
    const reservation = await (input.reserveSender ?? reserveEmailSender)({
      officeId: order.officeId,
      idempotencyKey: `procurement-bulk-rfq:${order.orderId}:${target.vendorId}`,
      requestHash: hash,
    });
    if (!("ok" in reservation)) {
      const exhausted = reservation.code === "POOL_EXHAUSTED"
        || reservation.code === "POOL_EMPTY"
        // A pinned mailbox that is paused or gone is capacity this outreach can
        // get back, so the supplier is retried instead of counted as refused.
        || reservation.code === "SENDER_UNAVAILABLE";
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.name,
        recipient: target.contactEmail,
        state: exhausted ? "POOL_EXHAUSTED" : "BLOCKED",
        senderEmail: null,
        providerMessageId: null,
        error: reservation.error,
      });
      if (exhausted) {
        result.poolExhausted = true;
        break;
      }
      continue;
    }
    if (reservation.completed) {
      result.alreadySent += 1;
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.name,
        recipient: target.contactEmail,
        state: "ALREADY_SENT",
        senderEmail: reservation.senderEmail,
        providerMessageId: reservation.providerMessageId,
        error: null,
      });
      continue;
    }
    // A suppression recorded after the batch was selected, including one that
    // landed while the reservation was being taken, still keeps the address
    // away from the provider: the reservation goes back and nothing is sent.
    const lateSuppression = (await listSuppressedEmails(order.officeId, [target.contactEmail]))
      .get(target.contactEmail.trim().toLowerCase());
    if (lateSuppression) {
      await releaseEmailSenderReservation({ officeId: order.officeId, reservationId: reservation.reservationId });
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.name,
        recipient: target.contactEmail,
        state: "BLOCKED",
        senderEmail: null,
        providerMessageId: null,
        error: suppressionSkipMessage(lateSuppression),
      });
      continue;
    }

    const rfcMessageId = `<procurement-rfq-${order.orderId.slice(0, 8)}-${target.vendorId}@derya.ai>`;
    const receipt = await provider.send({
      officeId: order.officeId,
      accountId: reservation.accountId,
      senderEmail: reservation.senderEmail,
      recipient: target.contactEmail,
      subject,
      body,
      rfcMessageId,
      ...(files.attachments.length ? { attachments: files.attachments } : {}),
    });

    if (receipt.state === "SENT") {
      await recordSentRfq({
        officeId: order.officeId,
        orderId: order.orderId,
        vendorId: target.vendorId,
        accountId: reservation.accountId,
        reservationId: reservation.reservationId,
        senderEmail: reservation.senderEmail,
        recipient: target.contactEmail,
        subject,
        body,
        rfcMessageId,
        providerMessageId: receipt.providerMessageId,
        providerThreadId: receipt.providerThreadId,
      });
      result.sent += 1;
      // The first RFQ out is when the request is visibly collecting supplier
      // responses; the status write is idempotent, so later sends are no-ops.
      if (result.sent === 1) {
        await advanceStatus({
          customerId: order.customerId,
          orderId: order.orderId,
          event: "rfq_sent",
        });
      }
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.name,
        recipient: target.contactEmail,
        state: "SENT",
        senderEmail: reservation.senderEmail,
        providerMessageId: receipt.providerMessageId,
        error: null,
      });
    } else if (receipt.state === "REJECTED") {
      await releaseEmailSenderReservation({ officeId: order.officeId, reservationId: reservation.reservationId });
      result.rejected += 1;
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.name,
        recipient: target.contactEmail,
        state: "REJECTED",
        senderEmail: reservation.senderEmail,
        providerMessageId: null,
        error: receipt.error,
      });
    } else {
      result.unknown += 1;
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.name,
        recipient: target.contactEmail,
        state: "UNKNOWN",
        senderEmail: reservation.senderEmail,
        providerMessageId: null,
        error: receipt.error,
      });
    }

    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  return result;
}
