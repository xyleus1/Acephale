import "server-only";

import { createHash } from "node:crypto";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { stripEmDashes } from "@/lib/no-em-dash";
import { prisma } from "@/lib/prisma";
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
const BULK_RFQ_VENDOR_EMAIL_SQL = `COALESCE(
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

export type BulkRfqRunResult = {
  orderId: string;
  material: string;
  attachments: string[];
  withheldFiles: Array<{ name: string; reason: string }>;
  candidates: number;
  sent: number;
  alreadySent: number;
  rejected: number;
  unknown: number;
  poolExhausted: boolean;
  outcomes: BulkRfqOutcome[];
};

type OrderRow = {
  orderId: string;
  customerId: string;
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
    companyName: clean(row.companyName ?? "our customer"),
    material: row.material,
    specification: row.specification,
    quantity: row.quantity,
    unit: row.unit,
    neededBy: row.neededBy ? row.neededBy.toISOString().slice(0, 10) : null,
    notes: row.notes,
  };
}

export async function listBulkRfqTargets(
  order: BulkRfqOrder,
  limit: number,
  // A sourcing wave contacts the suppliers it just found. Oldest first ordering
  // would otherwise spend the run on vendors that were already sitting there.
  vendorIds?: readonly string[] | null,
): Promise<BulkRfqTarget[]> {
  const bounded = Math.min(BULK_RFQ_MAX_PER_RUN, Math.max(1, limit));
  const only = vendorIds?.length ? new Set(vendorIds) : null;
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
    .filter((row) => !alreadyHandled.has(row.vendorId))
    .slice(0, bounded)
    .map((row) => ({
      vendorId: row.vendorId,
      name: row.name,
      website: row.website,
      contactEmail: row.contactEmail.trim().toLowerCase(),
    }));
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
  // Restrict the run to these vendors, used when a caller knows exactly which
  // suppliers it means rather than "the next few uncontacted ones".
  vendorIds?: readonly string[] | null;
}): Promise<BulkRfqRunResult> {
  const order = await loadBulkRfqOrder(input.orderId);
  if (!order) throw new Error("The sourcing request was not found.");
  const provider = input.provider ?? gmailSupplierEmailProvider;
  const pauseMs = input.pauseMs ?? 400;
  const targets = await listBulkRfqTargets(order, input.limit, input.vendorIds ?? null);
  const files = input.attachRequestFiles === false
    ? EMPTY_RFQ_ATTACHMENT_PACKAGE
    : await (input.loadFiles ?? loadProcurementRfqAttachmentPackage)({
      orderId: order.orderId,
      customerId: order.customerId,
      officeId: order.officeId,
    });
  const subject = buildBulkRfqSubject(order);
  const result: BulkRfqRunResult = {
    orderId: order.orderId,
    material: order.material,
    attachments: files.names,
    withheldFiles: files.withheld,
    candidates: targets.length,
    sent: 0,
    alreadySent: 0,
    rejected: 0,
    unknown: 0,
    poolExhausted: false,
    outcomes: [],
  };

  for (const target of targets) {
    const body = buildBulkRfqBody(order, target, files);
    const hash = requestHash({ orderId: order.orderId, vendorId: target.vendorId, recipient: target.contactEmail, subject, body });
    const reservation = await reserveEmailSender({
      officeId: order.officeId,
      idempotencyKey: `procurement-bulk-rfq:${order.orderId}:${target.vendorId}`,
      requestHash: hash,
    });
    if (!("ok" in reservation)) {
      const exhausted = reservation.code === "POOL_EXHAUSTED" || reservation.code === "POOL_EMPTY";
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
