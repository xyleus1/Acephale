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
  summarizeLocalRfqOutreachByOrder,
  type LocalRfqMessage,
  type LocalRfqOutreach,
} from "@/lib/procurement-local-outreach-model";

const RFQ_REFERENCE_PATTERN = "\\[RFQ ([0-9a-fA-F]{8})\\]";

type LocalRfqMessageRow = {
  id: string;
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

export async function loadLocalRfqMessages(
  officeId: string,
  orderId: string,
): Promise<LocalRfqMessage[]> {
  const messages = await prisma.emailMessage.findMany({
    where: {
      thread: { officeId },
      subject: { contains: rfqSubjectReference(orderId) },
    },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    take: LOCAL_RFQ_MESSAGE_LIMIT,
    select: {
      id: true,
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
    },
  });
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
  // needs the subject reference, the direction, and the addresses. The row cap
  // is per order, so a busy order cannot starve the others.
  const messages = await prisma.$queryRaw<LocalRfqMessageRow[]>`
    SELECT
      scoped."id",
      scoped."direction",
      scoped."fromEmail",
      scoped."toEmails",
      scoped."ccEmails",
      scoped."subject",
      scoped."sentAt",
      scoped."accountEmail"
    FROM (
      SELECT
        message."id",
        message."direction"::text AS "direction",
        message."fromEmail",
        message."toEmails",
        message."ccEmails",
        message."subject",
        message."sentAt",
        account."email" AS "accountEmail",
        row_number() OVER (
          PARTITION BY lower(substring(message."subject" FROM ${RFQ_REFERENCE_PATTERN}))
          ORDER BY message."sentAt" DESC, message."id" DESC
        ) AS "rank"
      FROM "EmailMessage" AS message
      JOIN "EmailThread" AS thread ON thread."id" = message."threadId"
      LEFT JOIN "EmailAccount" AS account ON account."id" = message."accountId"
      WHERE thread."officeId" = ${officeId}
        AND lower(substring(message."subject" FROM ${RFQ_REFERENCE_PATTERN})) IN (${Prisma.join(
          requested.map((orderId) => rfqSubjectReferenceToken(orderId)),
        )})
    ) AS scoped
    WHERE scoped."rank" <= ${LOCAL_RFQ_BATCH_MESSAGES_PER_ORDER}
  `;
  return summarizeLocalRfqOutreachByOrder(
    messages.map((message) => ({
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
    })),
    requested,
  );
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
