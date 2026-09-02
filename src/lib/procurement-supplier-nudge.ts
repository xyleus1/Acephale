import "server-only";

import { createHash } from "node:crypto";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { stripEmDashes } from "@/lib/no-em-dash";
import { prisma } from "@/lib/prisma";
import {
  BULK_RFQ_VENDOR_EMAIL_SQL,
  loadBulkRfqOrder,
  type BulkRfqOrder,
} from "@/lib/procurement-bulk-rfq";
import {
  EMPTY_RFQ_ATTACHMENT_PACKAGE,
  loadProcurementRfqAttachmentPackage,
  type ProcurementRfqAttachmentPackage,
} from "@/lib/procurement-rfq-attachments";
import { supplierNudgeDecision } from "@/lib/procurement-supplier-nudge-policy";
import { procurementWorkflowDatabase } from "@/lib/procurement-workflow";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
} from "@/lib/supply-os/supplier-email-provider";

// A supplier that never answered the first RFQ cannot be chased through the
// reply path, because a reply is anchored on an inbound message that does not
// exist. Those threads are the bulk of a cold campaign, so the follow up here
// is anchored on our own RFQ instead: same thread, same sender, same files.

export const NUDGE_MAX_PER_RUN = 40;
export const NUDGE_CONFIRMATION = "SEND SUPPLIER FILES";

export type SupplierNudgeOutcome = {
  vendorId: string;
  vendorName: string;
  recipient: string;
  round: number;
  state: "SENT" | "ALREADY_SENT" | "REJECTED" | "UNKNOWN" | "POOL_EXHAUSTED" | "BLOCKED";
  senderEmail: string | null;
  providerMessageId: string | null;
  error: string | null;
};

export type SupplierNudgeRunResult = {
  orderId: string;
  material: string;
  attachments: string[];
  candidates: number;
  sent: number;
  alreadySent: number;
  failed: number;
  skipped: Array<{ vendorId: string; vendorName: string; reason: string }>;
  blocked: string | null;
  outcomes: SupplierNudgeOutcome[];
};

type NudgeVendorRow = {
  vendorId: string;
  name: string;
  contactEmail: string | null;
  hasQuote: boolean;
  lastEmailMessageId: string | null;
};

// A recorded quote lives in the vendor's `quote` json, not in its status, so the
// same expression the workflow reader uses decides who is already quoted.
const NUDGE_VENDOR_QUOTE_SQL = `(
    jsonb_typeof(to_jsonb(order_vendors)->'quote') = 'object'
    AND to_jsonb(order_vendors)->'quote' <> '{}'::jsonb
  )`;

// Sourcing sets a supplier to 'researched' and the RFQ send moves it to
// 'contacted', but that write back is best effort, so this is a block list of
// statuses that end outreach rather than an allow list of statuses that keep it.
const NUDGE_CLOSED_VENDOR_STATUSES = [
  "rejected",
  "declined",
  "excluded",
  "disqualified",
  "archived",
  "ordered",
  "cancelled",
];

// A request that is ordered or cancelled is finished, and the autopilot reader
// already treats those two the same way.
const NUDGE_CLOSED_ORDER_STATUSES = ["ordered", "cancelled"];

export type SupplierNudgeTarget = {
  vendorId: string;
  vendorName: string;
  recipient: string;
  accountId: string;
  senderEmail: string;
  localThreadId: string;
  providerThreadId: string | null;
  rfqRfcMessageId: string;
  threadSubject: string | null;
  round: number;
};

function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function quantityText(order: BulkRfqOrder) {
  const numeric = Number(order.quantity);
  const quantity = Number.isFinite(numeric) ? String(numeric) : order.quantity;
  return `${quantity} ${order.unit}`.trim();
}

export function nudgeIdempotencyKey(args: { orderId: string; vendorId: string; round: number }) {
  return `procurement-rfq-nudge:${args.orderId}:${args.round}:${args.vendorId}`;
}

export function buildSupplierNudgeSubject(args: { threadSubject: string | null; order: BulkRfqOrder }) {
  const base = args.threadSubject?.trim()
    || `[RFQ ${args.order.orderId.slice(0, 8)}] ${args.order.material}`;
  const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
  return stripEmDashes(subject).replace(/[\r\n]+/g, " ").trim().slice(0, 180);
}

// The follow up says only what is true: we asked, we heard nothing, the package
// is attached again, and a one line no is welcome. Nothing about price, terms,
// or a promise the request does not record.
export function buildSupplierNudgeBody(args: {
  order: BulkRfqOrder;
  vendorName: string;
  round: number;
  files: ProcurementRfqAttachmentPackage;
}) {
  const { order, files } = args;
  const greeting = stripEmDashes(args.vendorName || "").replace(/[.,]$/, "").trim() || "there";
  const lines = [
    `Hello ${greeting},`,
    "",
    args.round >= 2
      ? `Last follow up on our request for quotation for ${order.material}. If it is not a fit we will close the loop here.`
      : `Following up on our request for quotation for ${order.material}. We have not heard back, so the package is attached again in case the first message did not reach you.`,
    "",
    `Item: ${order.material}`,
    `Quantity: ${quantityText(order)}`,
    ...(order.neededBy ? [`Needed by: ${order.neededBy}`] : []),
    ...(files.names.length ? ["", "Attached files:", ...files.names.map((name) => `- ${name}`)] : []),
    "",
    "Please reply with:",
    "1. Whether this build is inside your capability as drawn.",
    `2. Unit price at ${quantityText(order)}, and at 250 and 500 units.`,
    "3. Tooling, setup, or NRE cost if any.",
    "4. Lead time for tooling and for production.",
    "5. Anything still missing before you can quote.",
    "",
    "A one line no is just as useful to us as a quote, so we stop taking your time.",
    "",
    "Thank you,",
    "Sourcing desk",
    `Derya Supply OS, for ${order.companyName}`,
  ];
  return stripEmDashes(lines.join("\n")).slice(0, 20_000);
}

// A thread qualifies when we contacted the supplier, the supplier never replied,
// our last message is old enough, and the follow up allowance is not spent.
export async function listSupplierNudgeTargets(args: {
  order: BulkRfqOrder;
  limit: number;
  now?: number;
}): Promise<{
  targets: SupplierNudgeTarget[];
  skipped: SupplierNudgeRunResult["skipped"];
  // Set when the whole request is closed, so an empty plan is never mistaken
  // for a request whose suppliers all answered.
  blocked: string | null;
}> {
  const now = args.now ?? Date.now();
  const closed = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{ status: string }>>(`
    SELECT orders.status AS "status" FROM orders WHERE orders.id = $1::uuid
  `, args.order.orderId);
  const orderStatus = closed.at(0)?.status ?? "";
  if (NUDGE_CLOSED_ORDER_STATUSES.includes(orderStatus)) {
    return {
      targets: [],
      skipped: [],
      blocked: "This request is finished, so its suppliers are not contacted again.",
    };
  }
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<NudgeVendorRow[]>(`
    SELECT
      order_vendors.id AS "vendorId",
      order_vendors.name AS "name",
      ${BULK_RFQ_VENDOR_EMAIL_SQL} AS "contactEmail",
      ${NUDGE_VENDOR_QUOTE_SQL} AS "hasQuote",
      order_vendors.last_email_message_id AS "lastEmailMessageId"
    FROM order_vendors
    WHERE order_vendors.order_id = $1::uuid
      AND ${BULK_RFQ_VENDOR_EMAIL_SQL} IS NOT NULL
      AND lower(coalesce(order_vendors.status, '')) <> ALL($2::text[])
    ORDER BY order_vendors.created_at ASC, order_vendors.id ASC
  `, args.order.orderId, NUDGE_CLOSED_VENDOR_STATUSES);
  // The workflow write-back that stamps `last_email_message_id` is best effort,
  // so a real send can leave no workflow receipt. Those vendors stay in the list
  // and the local thread supplies the message id to reply to.
  const contacted = rows.filter((row): row is NudgeVendorRow & { contactEmail: string } =>
    Boolean(row.contactEmail?.includes("@")));
  if (!contacted.length) return { targets: [], skipped: [], blocked: null };
  const reservations = await prisma.emailSenderReservation.findMany({
    where: {
      officeId: args.order.officeId,
      status: { in: ["RESERVED", "RECORDED"] },
      OR: [
        { idempotencyKey: { startsWith: `procurement-bulk-rfq:${args.order.orderId}:` } },
        { idempotencyKey: { startsWith: `procurement-rfq-nudge:${args.order.orderId}:` } },
      ],
    },
    select: {
      idempotencyKey: true,
      accountId: true,
      status: true,
      localThreadId: true,
      providerThreadId: true,
      account: { select: { email: true } },
    },
  });
  const rfqByVendor = new Map<string, typeof reservations[number]>();
  const nudgesByVendor = new Map<string, number>();
  // A follow up whose delivery came back unknown stays RESERVED on purpose. That
  // supplier is left alone until reconciliation decides, because advancing to
  // the next round would mail a supplier that may already have the message.
  const unconfirmedNudges = new Set<string>();
  for (const reservation of reservations) {
    const vendorId = reservation.idempotencyKey.split(":").at(-1) ?? "";
    if (reservation.idempotencyKey.startsWith("procurement-bulk-rfq:")) {
      rfqByVendor.set(vendorId, reservation);
      continue;
    }
    nudgesByVendor.set(vendorId, (nudgesByVendor.get(vendorId) ?? 0) + 1);
    if (reservation.status === "RESERVED") unconfirmedNudges.add(vendorId);
  }
  const threadIds = [...new Set([...rfqByVendor.values()].flatMap((entry) => entry.localThreadId ? [entry.localThreadId] : []))];
  const messages = threadIds.length
    ? await prisma.emailMessage.findMany({
      where: { threadId: { in: threadIds }, officeId: args.order.officeId },
      select: { threadId: true, direction: true, sentAt: true, subject: true, rfcMessageId: true },
      orderBy: { sentAt: "asc" },
    })
    : [];
  const threadState = new Map<string, {
    inbound: boolean;
    lastOutboundAt: number | null;
    subject: string | null;
    rfcMessageId: string | null;
  }>();
  for (const message of messages) {
    const state = threadState.get(message.threadId)
      ?? { inbound: false, lastOutboundAt: null, subject: null, rfcMessageId: null };
    if (message.direction === "INBOUND") state.inbound = true;
    if (message.direction === "OUTBOUND") {
      const sentAt = message.sentAt?.getTime() ?? null;
      if (sentAt && (!state.lastOutboundAt || sentAt > state.lastOutboundAt)) state.lastOutboundAt = sentAt;
      if (!state.subject && message.subject) state.subject = message.subject;
      // The first thing we sent is the RFQ, which is what the follow up answers.
      if (!state.rfcMessageId && message.rfcMessageId) state.rfcMessageId = message.rfcMessageId;
    }
    threadState.set(message.threadId, state);
  }
  const targets: SupplierNudgeTarget[] = [];
  const skipped: SupplierNudgeRunResult["skipped"] = [];
  for (const row of contacted) {
    if (targets.length >= args.limit) break;
    const rfq = rfqByVendor.get(row.vendorId);
    const state = rfq?.localThreadId ? threadState.get(rfq.localThreadId) : undefined;
    if (unconfirmedNudges.has(row.vendorId)) {
      skipped.push({
        vendorId: row.vendorId,
        vendorName: row.name,
        reason: "The last follow up to this supplier is still unconfirmed, so it waits for reconciliation.",
      });
      continue;
    }
    const decision = supplierNudgeDecision({
      hasQuote: row.hasQuote === true,
      hasInboundReply: state?.inbound === true,
      rfqRecorded: Boolean(rfq?.localThreadId),
      lastOutboundAt: state?.lastOutboundAt ?? null,
      nudgesSent: nudgesByVendor.get(row.vendorId) ?? 0,
      now,
    });
    if (!decision.nudge || !rfq?.localThreadId) {
      skipped.push({ vendorId: row.vendorId, vendorName: row.name, reason: decision.reason });
      continue;
    }
    const rfqRfcMessageId = row.lastEmailMessageId ?? state?.rfcMessageId ?? null;
    if (!rfqRfcMessageId) {
      skipped.push({
        vendorId: row.vendorId,
        vendorName: row.name,
        reason: "The first RFQ has no recorded message id, so a follow up cannot stay on the thread.",
      });
      continue;
    }
    targets.push({
      vendorId: row.vendorId,
      vendorName: row.name,
      recipient: row.contactEmail.trim().toLowerCase(),
      accountId: rfq.accountId,
      senderEmail: rfq.account.email,
      localThreadId: rfq.localThreadId,
      providerThreadId: rfq.providerThreadId,
      rfqRfcMessageId,
      threadSubject: state?.subject ?? null,
      round: decision.round,
    });
  }
  return { targets, skipped, blocked: null };
}

async function recordSentNudge(args: {
  officeId: string;
  localThreadId: string;
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
      select: { id: true },
    });
    const messageId = existing?.id ?? (await tx.emailMessage.create({
      data: {
        threadId: args.localThreadId,
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
    })).id;
    if (!existing) {
      await tx.emailThread.update({
        where: { id: args.localThreadId },
        data: { lastMessageAt: now, messageCount: { increment: 1 } },
      });
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
        localThreadId: args.localThreadId,
        messageId,
      },
    });
  });
}

export async function runProcurementSupplierNudges(args: {
  orderId: string;
  limit?: number;
  provider?: SupplierEmailProvider;
  attachRequestFiles?: boolean;
  loadFiles?: typeof loadProcurementRfqAttachmentPackage;
  pauseMs?: number;
  now?: number;
}): Promise<SupplierNudgeRunResult | null> {
  const order = await loadBulkRfqOrder(args.orderId);
  if (!order) return null;
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const limit = Math.min(NUDGE_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? NUDGE_MAX_PER_RUN)));
  const pauseMs = args.pauseMs ?? 400;
  const { targets, skipped, blocked } = await listSupplierNudgeTargets({ order, limit, now: args.now });
  const files = args.attachRequestFiles === false
    ? EMPTY_RFQ_ATTACHMENT_PACKAGE
    : await (args.loadFiles ?? loadProcurementRfqAttachmentPackage)({
      orderId: order.orderId,
      customerId: order.customerId,
      officeId: order.officeId,
    });
  const result: SupplierNudgeRunResult = {
    orderId: order.orderId,
    material: order.material,
    attachments: files.names,
    candidates: targets.length,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    skipped,
    blocked,
    outcomes: [],
  };
  for (const target of targets) {
    const subject = buildSupplierNudgeSubject({ threadSubject: target.threadSubject, order });
    const body = buildSupplierNudgeBody({
      order,
      vendorName: target.vendorName,
      round: target.round,
      files,
    });
    const idempotencyKey = nudgeIdempotencyKey({
      orderId: order.orderId,
      vendorId: target.vendorId,
      round: target.round,
    });
    // The follow up stays on the thread the supplier already has, so the sender
    // that owns that thread is the only acceptable sender.
    const reservation = await reserveEmailSender({
      officeId: order.officeId,
      idempotencyKey,
      requestHash: requestHash({ idempotencyKey, recipient: target.recipient, subject, body }),
      accountId: target.accountId,
    });
    if (!("ok" in reservation)) {
      const exhausted = reservation.code === "POOL_EXHAUSTED" || reservation.code === "POOL_EMPTY";
      result.failed += 1;
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        recipient: target.recipient,
        round: target.round,
        state: exhausted ? "POOL_EXHAUSTED" : "BLOCKED",
        senderEmail: null,
        providerMessageId: null,
        error: reservation.error,
      });
      continue;
    }
    if (reservation.completed) {
      result.alreadySent += 1;
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        recipient: target.recipient,
        round: target.round,
        state: "ALREADY_SENT",
        senderEmail: reservation.senderEmail,
        providerMessageId: reservation.providerMessageId,
        error: null,
      });
      continue;
    }
    const rfcMessageId = `<procurement-rfq-nudge-${order.orderId.slice(0, 8)}-${target.round}-${target.vendorId}@derya.ai>`;
    const receipt = await provider.send({
      officeId: order.officeId,
      accountId: reservation.accountId,
      senderEmail: reservation.senderEmail,
      recipient: target.recipient,
      subject,
      body,
      rfcMessageId,
      providerThreadId: target.providerThreadId,
      inReplyToRfcMessageId: target.rfqRfcMessageId,
      ...(files.attachments.length ? { attachments: files.attachments } : {}),
    });
    // Every attempt that reached the provider is paced, so a run of successful
    // sends does not hammer the mailbox.
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    if (receipt.state === "SENT") {
      await recordSentNudge({
        officeId: order.officeId,
        localThreadId: target.localThreadId,
        accountId: reservation.accountId,
        reservationId: reservation.reservationId,
        senderEmail: reservation.senderEmail,
        recipient: target.recipient,
        subject,
        body,
        rfcMessageId,
        providerMessageId: receipt.providerMessageId,
        providerThreadId: receipt.providerThreadId,
      });
      result.sent += 1;
      result.outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        recipient: target.recipient,
        round: target.round,
        state: "SENT",
        senderEmail: reservation.senderEmail,
        providerMessageId: receipt.providerMessageId,
        error: null,
      });
      continue;
    }
    // A rejected send frees the slot again; an unknown one stays reserved so the
    // reconcile path can decide, exactly as a first RFQ send does.
    if (receipt.state === "REJECTED") {
      await releaseEmailSenderReservation({
        officeId: order.officeId,
        reservationId: reservation.reservationId,
      });
    }
    result.failed += 1;
    result.outcomes.push({
      vendorId: target.vendorId,
      vendorName: target.vendorName,
      recipient: target.recipient,
      round: target.round,
      state: receipt.state,
      senderEmail: reservation.senderEmail,
      providerMessageId: null,
      error: receipt.error,
    });
  }
  return result;
}
