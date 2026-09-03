import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  EMPTY_LOCAL_RFQ_OUTREACH,
  LOCAL_RFQ_BATCH_MESSAGES_PER_ORDER,
  LOCAL_RFQ_BATCH_ORDER_LIMIT,
  LOCAL_RFQ_MESSAGE_LIMIT,
  localRfqConversationFor,
  rfqSubjectReference,
  rfqSubjectReferenceToken,
  summarizeLocalRfqOutreach,
  type LocalRfqMessage,
  type LocalRfqOutreach,
} from "@/lib/procurement-local-outreach-model";

// Matched against a lowercased subject so a client that recases the reference
// still resolves to the request that owns it.
const RFQ_REFERENCE_PATTERN = "\\[rfq ([0-9a-f]{8})\\]";
// Compared case insensitively because a reply's client may lowercase the
// subject, and a tag for another request must be recognised however it is
// cased so this request cannot claim that reply.
const RFQ_SUBJECT_TAG = "[rfq ";
const RECOVERY_THREAD_CHUNK = 400;

function subjectTokens(subject: string | null): string[] {
  if (!subject) return [];
  return [...subject.toLowerCase().matchAll(/\[rfq ([0-9a-f]{8})\]/g)].map((found) => found[1]);
}

type LocalRfqMessageRow = {
  id: string;
  token: string;
  direction: string;
  fromEmail: string;
  toEmails: string;
  ccEmails: string | null;
  subject: string | null;
  sentAt: Date;
  accountEmail: string | null;
};

function jsonEmails(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

const LOCAL_RFQ_MESSAGE_SELECT = {
  id: true,
  threadId: true,
  direction: true,
  fromEmail: true,
  fromName: true,
  toEmails: true,
  ccEmails: true,
  subject: true,
  bodyText: true,
  sentAt: true,
  account: { select: { email: true } },
  thread: { select: { externalThreadId: true } },
} as const;

export async function loadLocalRfqMessages(
  officeId: string,
  orderId: string,
): Promise<LocalRfqMessage[]> {
  const tagged = await prisma.emailMessage.findMany({
    where: {
      thread: { officeId },
      subject: { contains: rfqSubjectReference(orderId), mode: "insensitive" },
    },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    take: LOCAL_RFQ_MESSAGE_LIMIT,
    select: LOCAL_RFQ_MESSAGE_SELECT,
  });
  // A supplier answering from a helpdesk, or in a language its mail client
  // rewrites the subject in, drops the request reference, and the answer then
  // belongs to no request at all. The thread we started is the anchor instead.
  // A subject carrying any reference is left to the request that owns it.
  const anchors = [...new Set(tagged.map((message) => message.threadId))];
  // A thread that also carries another request's reference could hold answers
  // to either request, so it anchors neither.
  const token = rfqSubjectReferenceToken(orderId);
  const ambiguous = new Set<string>();
  for (let index = 0; index < anchors.length; index += RECOVERY_THREAD_CHUNK) {
    const rows = await prisma.emailMessage.findMany({
      where: {
        threadId: { in: anchors.slice(index, index + RECOVERY_THREAD_CHUNK) },
        subject: { contains: RFQ_SUBJECT_TAG, mode: "insensitive" },
      },
      select: { threadId: true, subject: true },
      distinct: ["threadId", "subject"],
    });
    // One subject can name two requests, so every reference in it counts.
    for (const row of rows) {
      if (subjectTokens(row.subject).some((found) => found !== token)) ambiguous.add(row.threadId);
    }
  }
  const threadIds = anchors.filter((threadId) => !ambiguous.has(threadId));
  const recovered: typeof tagged = [];
  for (let index = 0; index < threadIds.length; index += RECOVERY_THREAD_CHUNK) {
    if (recovered.length >= LOCAL_RFQ_MESSAGE_LIMIT) break;
    const page = await prisma.emailMessage.findMany({
      where: {
        threadId: { in: threadIds.slice(index, index + RECOVERY_THREAD_CHUNK) },
        direction: "INBOUND",
        // A null subject carries no reference either, and SQL drops it out of
        // the comparison rather than failing it.
        OR: [
          { subject: null },
          { NOT: { subject: { contains: RFQ_SUBJECT_TAG, mode: "insensitive" } } },
        ],
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      take: LOCAL_RFQ_MESSAGE_LIMIT - recovered.length,
      select: LOCAL_RFQ_MESSAGE_SELECT,
    });
    recovered.push(...page);
  }
  const messages = [...tagged, ...recovered]
    .sort((left, right) => (
      left.sentAt.getTime() - right.sentAt.getTime() || left.id.localeCompare(right.id)
    ))
    .slice(0, LOCAL_RFQ_MESSAGE_LIMIT);
  return messages.map((message) => ({
    id: message.id,
    direction: message.direction,
    fromEmail: message.fromEmail,
    fromName: message.fromName,
    toEmails: jsonEmails(message.toEmails),
    ccEmails: jsonEmails(message.ccEmails),
    subject: message.subject,
    body: message.bodyText ?? "",
    sentAt: message.sentAt.toISOString(),
    accountEmail: message.account?.email ?? null,
    externalThreadId: message.thread.externalThreadId,
  }));
}

export async function localRfqOutreachByOrder(
  officeId: string,
  orderIds: string[],
): Promise<Map<string, LocalRfqOutreach>> {
  const requested = [...new Set(orderIds)].slice(0, LOCAL_RFQ_BATCH_ORDER_LIMIT);
  if (!requested.length) return new Map();
  // One scan for the whole list, with bodies left out because counting only
  // needs the request token, the direction, and the addresses. The row cap is
  // per order, so a busy order cannot starve the others. An inbound message
  // whose subject lost the reference is claimed by the request whose thread it
  // arrived on, which is the only claim on it there is.
  const messages = await prisma.$queryRaw<LocalRfqMessageRow[]>`
    WITH referenced AS (
      -- Every reference the office's mail carries, including ones this call did
      -- not ask about, because a thread is only unambiguous against all of
      -- them. A subject naming two requests yields a row for each.
      SELECT
        message."id",
        message."threadId",
        reference."token",
        message."direction"::text AS "direction",
        message."fromEmail",
        message."toEmails",
        message."ccEmails",
        message."subject",
        message."sentAt",
        message."accountId"
      FROM "EmailMessage" AS message
      JOIN "EmailThread" AS thread ON thread."id" = message."threadId"
      CROSS JOIN LATERAL (
        SELECT DISTINCT (found)[1] AS "token"
        FROM regexp_matches(lower(message."subject"), ${RFQ_REFERENCE_PATTERN}, 'g') AS found
      ) AS reference
      WHERE thread."officeId" = ${officeId}
    ), tagged AS (
      SELECT * FROM referenced
      WHERE "token" IN (${Prisma.join(
        requested.map((orderId) => rfqSubjectReferenceToken(orderId)),
      )})
    ), anchored AS (
      -- A thread carrying two requests' references anchors neither of them,
      -- because an untagged reply on it could answer either one.
      SELECT "threadId", min("token") AS "token"
      FROM referenced
      WHERE "threadId" IN (SELECT "threadId" FROM tagged)
      GROUP BY "threadId"
      HAVING count(DISTINCT "token") = 1
    ), claimed AS (
      SELECT * FROM tagged
      UNION ALL
      SELECT
        message."id",
        message."threadId",
        anchored."token",
        message."direction"::text AS "direction",
        message."fromEmail",
        message."toEmails",
        message."ccEmails",
        message."subject",
        message."sentAt",
        message."accountId"
      FROM "EmailMessage" AS message
      JOIN anchored ON anchored."threadId" = message."threadId"
      WHERE message."direction" = 'INBOUND'
        AND (message."subject" IS NULL OR position(${RFQ_SUBJECT_TAG} IN lower(message."subject")) = 0)
    )
    SELECT
      scoped."id",
      scoped."token",
      scoped."direction",
      scoped."fromEmail",
      scoped."toEmails",
      scoped."ccEmails",
      scoped."subject",
      scoped."sentAt",
      scoped."accountEmail"
    FROM (
      SELECT
        claimed."id",
        claimed."token",
        claimed."direction",
        claimed."fromEmail",
        claimed."toEmails",
        claimed."ccEmails",
        claimed."subject",
        claimed."sentAt",
        account."email" AS "accountEmail",
        row_number() OVER (
          PARTITION BY claimed."token"
          ORDER BY claimed."sentAt" DESC, claimed."id" DESC
        ) AS "rank"
      FROM claimed
      LEFT JOIN "EmailAccount" AS account ON account."id" = claimed."accountId"
    ) AS scoped
    WHERE scoped."rank" <= ${LOCAL_RFQ_BATCH_MESSAGES_PER_ORDER}
  `;
  const byToken = new Map<string, LocalRfqMessage[]>();
  for (const message of messages) {
    const bucket = byToken.get(message.token) ?? [];
    bucket.push({
      id: message.id,
      direction: message.direction,
      fromEmail: message.fromEmail,
      fromName: null,
      toEmails: jsonEmails(message.toEmails),
      ccEmails: jsonEmails(message.ccEmails),
      subject: message.subject,
      body: "",
      sentAt: message.sentAt.toISOString(),
      accountEmail: message.accountEmail,
      externalThreadId: null,
    });
    byToken.set(message.token, bucket);
  }
  return new Map(requested.map((orderId) => [
    orderId,
    summarizeLocalRfqOutreach(byToken.get(rfqSubjectReferenceToken(orderId)) ?? []),
  ]));
}

export async function localRfqOutreach(
  officeId: string,
  orderId: string,
): Promise<LocalRfqOutreach> {
  const batched = await localRfqOutreachByOrder(officeId, [orderId]);
  return batched.get(orderId) ?? EMPTY_LOCAL_RFQ_OUTREACH;
}

export async function localRfqVendorConversation(
  officeId: string,
  orderId: string,
  contactEmail: string,
) {
  return localRfqConversationFor(await loadLocalRfqMessages(officeId, orderId), contactEmail);
}
