import "server-only";

import { prisma } from "@/lib/prisma";
import {
  LOCAL_RFQ_MESSAGE_LIMIT,
  localRfqConversationFor,
  rfqSubjectReference,
  summarizeLocalRfqOutreach,
  type LocalRfqMessage,
  type LocalRfqOutreach,
} from "@/lib/procurement-local-outreach-model";

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

export async function localRfqOutreach(
  officeId: string,
  orderId: string,
): Promise<LocalRfqOutreach> {
  return summarizeLocalRfqOutreach(await loadLocalRfqMessages(officeId, orderId));
}

export async function localRfqVendorConversation(
  officeId: string,
  orderId: string,
  contactEmail: string,
) {
  return localRfqConversationFor(await loadLocalRfqMessages(officeId, orderId), contactEmail);
}
