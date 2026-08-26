import type { Prisma } from "@prisma/client";

/**
 * Threads created for mail that answers no known customer thread. They stay
 * hidden from office workspaces and are only listed in the admin mail log.
 */
export const UNROUTED_MAIL_THREAD_MARKER = "UNROUTED_SHARED_MAILBOX";

const RFQ_REFERENCE = /\[RFQ ([0-9a-f]{8})\]/i;

export type InboundRoutingEvidence =
  | "LOCAL_THREAD"
  | "MESSAGE_REFERENCE"
  | "RFQ_REFERENCE"
  | "PARTICIPANT_HISTORY";

export type InboundRouting =
  | { routed: true; officeId: string; threadId: string | null; evidence: InboundRoutingEvidence }
  | { routed: false };

export type InboundRoutingDatabase = Pick<Prisma.TransactionClient, "emailThread" | "emailMessage">;

export type InboundRoutingInput = {
  accountId: string;
  externalThreadId: string;
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  fromEmail: string;
};

function referenceIds(input: InboundRoutingInput) {
  return [...new Set([input.inReplyTo, ...input.references]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0 && value.length <= 400))];
}

/** Exact recipient addresses of a stored message, whose `toEmails` is a JSON array. */
function recipientAddresses(toEmails: string) {
  const addresses: string[] = [];
  try {
    const parsed: unknown = JSON.parse(toEmails);
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        if (typeof value !== "string") continue;
        const match = value.match(/<([^>]+)>/);
        addresses.push((match ? match[1] : value).trim().toLowerCase());
      }
    }
  } catch {
    addresses.push(toEmails.trim().toLowerCase());
  }
  return addresses;
}

/**
 * Mailboxes are shared across offices, so the mailbox owner cannot decide where
 * a message belongs. The office is derived from the outbound thread the message
 * answers, strongest evidence first. Without such evidence the message is left
 * unrouted for the administrator instead of being filed under a customer.
 */
export async function routeInboundMail(
  db: InboundRoutingDatabase,
  input: InboundRoutingInput,
): Promise<InboundRouting> {
  const localThread = await db.emailThread.findFirst({
    where: { externalThreadId: input.externalThreadId },
    select: { id: true, officeId: true, autoLinkSkipReason: true },
    orderBy: { lastMessageAt: "desc" },
  });
  if (localThread) {
    // Follow-ups on an unrouted thread stay unrouted, so they never enter office
    // memory or CRM history through the thread the first message created.
    if (localThread.autoLinkSkipReason === UNROUTED_MAIL_THREAD_MARKER) return { routed: false };
    return { routed: true, officeId: localThread.officeId, threadId: localThread.id, evidence: "LOCAL_THREAD" };
  }

  const references = referenceIds(input);
  if (references.length > 0) {
    const answered = await db.emailMessage.findFirst({
      where: { rfcMessageId: { in: references } },
      select: { threadId: true, thread: { select: { officeId: true } } },
      orderBy: { sentAt: "desc" },
    });
    if (answered) {
      return {
        routed: true,
        officeId: answered.thread.officeId,
        threadId: answered.threadId,
        evidence: "MESSAGE_REFERENCE",
      };
    }
  }

  const reference = RFQ_REFERENCE.exec(input.subject);
  if (reference) {
    const outreach = await db.emailMessage.findFirst({
      where: {
        direction: "OUTBOUND",
        subject: { contains: `[RFQ ${reference[1]}]`, mode: "insensitive" },
      },
      select: { threadId: true, thread: { select: { officeId: true } } },
      orderBy: { sentAt: "desc" },
    });
    if (outreach) {
      return {
        routed: true,
        officeId: outreach.thread.officeId,
        threadId: outreach.threadId,
        evidence: "RFQ_REFERENCE",
      };
    }
  }

  const sender = input.fromEmail.trim().toLowerCase();
  if (sender && sender !== "unknown" && sender.includes("@")) {
    // A shared mailbox can have written to the same supplier for two customers.
    // Such a message is ambiguous, so it stays unrouted for manual handling.
    const contactedBy = {
      accountId: input.accountId,
      direction: "OUTBOUND",
      toEmails: { contains: sender, mode: "insensitive" },
    } satisfies Prisma.EmailMessageWhereInput;
    // The whole outreach history is considered, so an older cross-office contact
    // cannot be hidden behind the newest messages of a single office. The stored
    // recipients are a JSON array, so the substring query is only a prefilter and
    // the address is compared exactly before it counts as a contact.
    const contacted = await db.emailMessage.findMany({
      where: contactedBy,
      select: { threadId: true, toEmails: true },
      orderBy: { sentAt: "desc" },
    });
    const contactedThreadIds = [...new Set(contacted
      .filter((message) => recipientAddresses(message.toEmails).includes(sender))
      .map((message) => message.threadId))];
    if (contactedThreadIds.length > 0) {
      const offices = await db.emailThread.groupBy({
        by: ["officeId"],
        where: { id: { in: contactedThreadIds } },
        orderBy: { officeId: "asc" },
        take: 2,
      });
      if (offices.length === 1) {
        return {
          routed: true,
          officeId: offices[0].officeId,
          threadId: contactedThreadIds[0],
          evidence: "PARTICIPANT_HISTORY",
        };
      }
    }
  }

  return { routed: false };
}
