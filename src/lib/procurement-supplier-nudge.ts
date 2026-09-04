import "server-only";

import { createHash } from "node:crypto";
import {
  releaseEmailSenderReservation,
  reserveEmailSender,
} from "@/lib/email-sender-pool";
import { listSuppressedEmails } from "@/lib/email-delivery-events";
import { suppressionSkipMessage } from "@/lib/email-delivery-feedback";
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
// A provider check can spend its own timeout, so a reconcile pass stays small
// and also stops at its own deadline well inside the route budget.
export const NUDGE_MAX_RECONCILE_PER_RUN = 10;
export const NUDGE_RECONCILE_BUDGET_MS = 90_000;
// A reservation touched more recently than this can still belong to a send that
// has not returned yet, and releasing it would let a second run mail the same
// supplier. The pool refreshes `updatedAt` whenever it reserves or reuses a
// slot, so this is the age of the last attempt, not of the row.
export const NUDGE_RECONCILE_MIN_AGE_MS = 10 * 60_000;
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

// Whether outreach to a supplier is over, so the loop neither mails them nor
// counts them as a conversation that still owes an action.
export function procurementVendorOutreachClosed(status: string | null | undefined): boolean {
  return NUDGE_CLOSED_VENDOR_STATUSES.includes((status ?? "").trim().toLowerCase());
}

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

export function nudgeRfcMessageId(args: { orderId: string; vendorId: string; round: number }) {
  return `<procurement-rfq-nudge-${args.orderId.slice(0, 8)}-${args.round}-${args.vendorId}@derya.ai>`;
}

// The plan is read once and the run then mails one supplier at a time, so a
// request cancelled or a supplier ruled out mid run is re-checked immediately
// before the send it would otherwise still receive.
async function nudgeStillEligible(args: {
  orderId: string;
  vendorId: string;
  officeId: string;
  localThreadId: string;
}) {
  // A supplier that answered while the run was working belongs to the reply
  // path, so the queued follow up would be an obsolete message.
  const inbound = await prisma.emailMessage.count({
    where: { threadId: args.localThreadId, officeId: args.officeId, direction: "INBOUND" },
  });
  if (inbound > 0) return false;
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{ open: boolean }>>(`
    SELECT (
      lower(coalesce(orders.status, '')) <> ALL($3::text[])
      AND lower(coalesce(order_vendors.status, '')) <> ALL($4::text[])
      AND NOT ${NUDGE_VENDOR_QUOTE_SQL}
    ) AS "open"
    FROM order_vendors
    JOIN orders ON orders.id = order_vendors.order_id
    WHERE order_vendors.id = $2::uuid AND order_vendors.order_id = $1::uuid
  `, args.orderId, args.vendorId, NUDGE_CLOSED_ORDER_STATUSES, NUDGE_CLOSED_VENDOR_STATUSES);
  return rows.at(0)?.open === true;
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
  // A supplier whose address bounced, complained, or opted out after the first
  // RFQ is not chased again, and it does not use up a slot of the run limit.
  const suppressed = await listSuppressedEmails(args.order.officeId, contacted.map((row) => row.contactEmail));
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
    const suppressionReason = suppressed.get(row.contactEmail.trim().toLowerCase());
    if (suppressionReason) {
      skipped.push({ vendorId: row.vendorId, vendorName: row.name, reason: suppressionSkipMessage(suppressionReason) });
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

// Every unresolved follow up slot for the request, whether or not it is old
// enough to check yet, so a pass that had nothing to do still reports the work
// that is outstanding.
function countReservedNudges(officeId: string, orderId: string) {
  return prisma.emailSenderReservation.count({
    where: {
      officeId,
      status: "RESERVED",
      idempotencyKey: { startsWith: `procurement-rfq-nudge:${orderId}:` },
    },
  });
}

// A slot that is still uncertain is touched so the next pass sees it as the most
// recently checked one and works through newer deliveries first.
async function touchReservation(officeId: string, reservationId: string) {
  await prisma.emailSenderReservation.updateMany({
    where: { id: reservationId, officeId, status: "RESERVED" },
    data: { attemptCount: { increment: 1 } },
  });
}

// A follow up whose delivery came back unknown stays reserved, and that
// reservation is what keeps the supplier out of later rounds. Without this the
// supplier would wait forever, so every run resolves those slots first: a
// confirmed send is recorded, a send the mailbox never saw frees the slot, and
// anything still uncertain stays reserved.
export async function reconcileProcurementSupplierNudges(input: {
  orderId: string;
  limit?: number;
  provider?: SupplierEmailProvider;
  attachRequestFiles?: boolean;
  loadFiles?: typeof loadProcurementRfqAttachmentPackage;
}) {
  const order = await loadBulkRfqOrder(input.orderId);
  if (!order) return null;
  const provider = input.provider ?? gmailSupplierEmailProvider;
  const pending = await prisma.emailSenderReservation.findMany({
    where: {
      officeId: order.officeId,
      status: "RESERVED",
      idempotencyKey: { startsWith: `procurement-rfq-nudge:${order.orderId}:` },
      // Only a slot untouched long enough that no send can still be in flight is
      // reconciled, so a concurrent run cannot have its reservation released
      // underneath it and mail the supplier twice. A reused reservation is
      // touched by the pool, so a retry gets the same protection as a first try.
      updatedAt: { lt: new Date(Date.now() - NUDGE_RECONCILE_MIN_AGE_MS) },
    },
    // Least recently checked first, and every check below touches the row, so a
    // slot that stays unknown rotates to the back instead of holding the whole
    // batch and starving newer deliveries.
    orderBy: { updatedAt: "asc" },
    take: Math.min(
      NUDGE_MAX_RECONCILE_PER_RUN,
      Math.max(1, Math.trunc(input.limit ?? NUDGE_MAX_RECONCILE_PER_RUN)),
    ),
    select: {
      id: true,
      accountId: true,
      idempotencyKey: true,
      account: { select: { email: true } },
    },
  });
  const outcomes: Array<{
    vendorId: string;
    round: number;
    state: "SENT" | "NOT_FOUND" | "UNKNOWN";
    error: string | null;
  }> = [];
  if (!pending.length) {
    return {
      orderId: order.orderId,
      reconciled: 0,
      remaining: await countReservedNudges(order.officeId, order.orderId),
      outcomes,
    };
  }
  // The recorded body has to be the body the follow up actually carried, so the
  // same file package the run used is resolved again here.
  const files = input.attachRequestFiles === false
    ? EMPTY_RFQ_ATTACHMENT_PACKAGE
    : await (input.loadFiles ?? loadProcurementRfqAttachmentPackage)({
      orderId: order.orderId,
      customerId: order.customerId,
      officeId: order.officeId,
    });
  const deadline = Date.now() + NUDGE_RECONCILE_BUDGET_MS;
  for (const reservation of pending) {
    // A provider check can spend its whole timeout, so the pass gives up its
    // remaining work rather than being killed by the route deadline.
    if (Date.now() >= deadline) break;
    const parts = reservation.idempotencyKey.split(":");
    const vendorId = parts.at(-1) ?? "";
    const round = Number(parts.at(-2));
    if (!vendorId || !Number.isFinite(round)) {
      await touchReservation(order.officeId, reservation.id);
      outcomes.push({ vendorId, round: 0, state: "UNKNOWN", error: "The reservation key is unreadable." });
      continue;
    }
    const rfcMessageId = nudgeRfcMessageId({ orderId: order.orderId, vendorId, round });
    const receipt = await provider.reconcile({
      officeId: order.officeId,
      accountId: reservation.accountId,
      senderEmail: reservation.account.email,
      rfcMessageId,
    });
    if (receipt.state === "NOT_FOUND") {
      await releaseEmailSenderReservation({ officeId: order.officeId, reservationId: reservation.id });
      outcomes.push({ vendorId, round, state: "NOT_FOUND", error: null });
      continue;
    }
    if (receipt.state !== "SENT") {
      await touchReservation(order.officeId, reservation.id);
      outcomes.push({ vendorId, round, state: "UNKNOWN", error: receipt.error ?? null });
      continue;
    }
    // The follow up rode the RFQ thread, so the first send's reservation is
    // where the thread it belongs to is recorded.
    const rfq = await prisma.emailSenderReservation.findFirst({
      where: {
        officeId: order.officeId,
        idempotencyKey: `procurement-bulk-rfq:${order.orderId}:${vendorId}`,
        localThreadId: { not: null },
      },
      select: { localThreadId: true },
    });
    const localThreadId = rfq?.localThreadId ?? null;
    if (!localThreadId) {
      await touchReservation(order.officeId, reservation.id);
      outcomes.push({ vendorId, round, state: "UNKNOWN", error: "The original RFQ thread is not recorded." });
      continue;
    }
    const vendors = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{
      name: string;
      contactEmail: string | null;
    }>>(`
      SELECT order_vendors.name AS "name", ${BULK_RFQ_VENDOR_EMAIL_SQL} AS "contactEmail"
      FROM order_vendors
      WHERE order_vendors.id = $1::uuid AND order_vendors.order_id = $2::uuid
    `, vendorId, order.orderId);
    const vendor = vendors.at(0);
    if (!vendor?.contactEmail) {
      await touchReservation(order.officeId, reservation.id);
      outcomes.push({ vendorId, round, state: "UNKNOWN", error: "The supplier recipient is missing." });
      continue;
    }
    const firstOutbound = await prisma.emailMessage.findFirst({
      where: { threadId: localThreadId, officeId: order.officeId, direction: "OUTBOUND" },
      orderBy: { sentAt: "asc" },
      select: { subject: true },
    });
    await recordSentNudge({
      officeId: order.officeId,
      localThreadId,
      accountId: reservation.accountId,
      reservationId: reservation.id,
      senderEmail: reservation.account.email,
      recipient: vendor.contactEmail.trim().toLowerCase(),
      subject: buildSupplierNudgeSubject({ threadSubject: firstOutbound?.subject ?? null, order }),
      body: buildSupplierNudgeBody({ order, vendorName: vendor.name, round, files }),
      rfcMessageId,
      providerMessageId: receipt.providerMessageId,
      providerThreadId: receipt.providerThreadId,
    });
    outcomes.push({ vendorId, round, state: "SENT", error: null });
  }
  return {
    orderId: order.orderId,
    reconciled: outcomes.length,
    remaining: await countReservedNudges(order.officeId, order.orderId),
    outcomes,
  };
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
  // Unresolved follow ups suppress later rounds, so they are settled before the
  // plan is read and a supplier is never left waiting on an unknown delivery.
  await reconcileProcurementSupplierNudges({
    orderId: order.orderId,
    provider,
    ...(args.attachRequestFiles === false ? { attachRequestFiles: false } : {}),
    ...(args.loadFiles ? { loadFiles: args.loadFiles } : {}),
  });
  const planned = await listSupplierNudgeTargets({ order, limit, now: args.now });
  const { targets, skipped, blocked } = planned;
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
    if (!await nudgeStillEligible({
      orderId: order.orderId,
      vendorId: target.vendorId,
      officeId: order.officeId,
      localThreadId: target.localThreadId,
    })) {
      result.skipped.push({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        reason: "This supplier stopped being eligible while the run was in progress.",
      });
      continue;
    }
    // The follow up stays on the thread the supplier already has, so the sender
    // that owns that thread is the only acceptable sender.
    const reservation = await reserveEmailSender({
      officeId: order.officeId,
      idempotencyKey,
      requestHash: requestHash({ idempotencyKey, recipient: target.recipient, subject, body }),
      accountId: target.accountId,
    });
    if (!("ok" in reservation)) {
      // A follow up leaves from the mailbox that owns the supplier's thread, so
      // that mailbox being paused by sender protection defers the follow up
      // until it is resumed rather than blocking the supplier for good.
      const exhausted = reservation.code === "POOL_EXHAUSTED"
        || reservation.code === "POOL_EMPTY"
        || reservation.code === "SENDER_UNAVAILABLE";
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
    // A bounce, complaint, or opt-out recorded after the plan was read, up to
    // and including while the sender was being reserved, must still keep the
    // address away from the provider.
    const lateSuppression = (await listSuppressedEmails(order.officeId, [target.recipient]))
      .get(target.recipient.trim().toLowerCase());
    if (lateSuppression) {
      await releaseEmailSenderReservation({ officeId: order.officeId, reservationId: reservation.reservationId });
      result.skipped.push({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        reason: suppressionSkipMessage(lateSuppression),
      });
      continue;
    }
    const rfcMessageId = nudgeRfcMessageId({
      orderId: order.orderId,
      vendorId: target.vendorId,
      round: target.round,
    });
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
