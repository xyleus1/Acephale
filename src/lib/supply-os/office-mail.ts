import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseStoredEmailList } from "@/lib/crm/email-touch";
import { UNROUTED_MAIL_THREAD_MARKER } from "@/lib/inbound-mail-routing";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { currentAccessContext } from "./supplier-communication-shared";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_MESSAGES = 200;

export type OfficeMailThread = {
  id: string;
  subject: string;
  participants: string[];
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  lastMessageAt: Date;
  messageCount: number;
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  mailbox: string | null;
};

export type OfficeMailThreadDetail = OfficeMailThread & {
  truncated: boolean;
  messages: {
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    fromEmail: string;
    toEmails: string[];
    subject: string | null;
    bodyText: string | null;
    sentAt: Date;
    mailbox: string | null;
  }[];
};

type MailCursor = {
  lastMessageAt: Date;
  id: string;
};

async function assertMailAccess(context: SupplyAccessContext): Promise<SupplyAccessContext> {
  if (context.accessKind === "customer") {
    throw new SupplyPersistenceError("Mail is available only to operator accounts.", "forbidden");
  }
  const current = await currentAccessContext(context);
  if (
    current.role === "CUSTOMER"
    || current.role === "EMPLOYEE"
    || !(current.canViewWholeOffice || current.role === "ADMIN" || current.role === "MANAGER")
  ) {
    throw new SupplyPersistenceError("Mail is available only to operator accounts.", "forbidden");
  }
  return current;
}

function pageSize(value: number | undefined) {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new SupplyPersistenceError(`The mail page size must be between 1 and ${MAX_LIMIT}.`, "invalid_input");
  }
  return value;
}

function decodeCursor(value: string | null | undefined): MailCursor | null {
  if (!value) return null;
  if (value.length > 500) {
    throw new SupplyPersistenceError("The mail cursor is invalid.", "invalid_input");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const lastMessageAt = typeof parsed.lastMessageAt === "string" ? new Date(parsed.lastMessageAt) : null;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    if (!lastMessageAt || Number.isNaN(lastMessageAt.getTime()) || !id || id.length > 220) throw new Error("invalid cursor");
    return { lastMessageAt, id };
  } catch {
    throw new SupplyPersistenceError("The mail cursor is invalid.", "invalid_input");
  }
}

function encodeCursor(thread: Pick<OfficeMailThread, "id" | "lastMessageAt">) {
  return Buffer.from(JSON.stringify({
    lastMessageAt: thread.lastMessageAt.toISOString(),
    id: thread.id,
  }), "utf8").toString("base64url");
}

function listThreadSelect() {
  return {
    id: true,
    subject: true,
    participants: true,
    companyId: true,
    contactId: true,
    lastMessageAt: true,
    messageCount: true,
    company: { select: { name: true } },
    contact: { select: { fullName: true } },
    messages: {
      orderBy: [{ sentAt: "desc" as const }, { id: "desc" as const }],
      take: 1,
      select: { direction: true },
    },
  } satisfies Prisma.EmailThreadSelect;
}

type ListThreadRow = Prisma.EmailThreadGetPayload<{ select: ReturnType<typeof listThreadSelect> }>;

const officeMailEligible: Prisma.EmailThreadWhereInput = {
  AND: [
    {
      OR: [
        { externalThreadId: null },
        { externalThreadId: { not: { startsWith: "whatsapp:" } } },
      ],
    },
    {
      OR: [
        { autoLinkSkipReason: null },
        { autoLinkSkipReason: { not: UNROUTED_MAIL_THREAD_MARKER } },
      ],
    },
  ],
};

function toThread(row: ListThreadRow, mailbox: string | null): OfficeMailThread {
  return {
    id: row.id,
    subject: row.subject,
    participants: parseStoredEmailList(row.participants),
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    contactId: row.contactId,
    contactName: row.contact?.fullName ?? null,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    lastDirection: row.messages[0]?.direction ?? null,
    mailbox,
  };
}

export async function listOfficeMailThreads(
  context: SupplyAccessContext,
  options: {
    cursor?: string | null;
    limit?: number;
    search?: string | null;
  } = {},
): Promise<{ threads: OfficeMailThread[]; nextCursor: string | null }> {
  const accessContext = await assertMailAccess(context);
  const cursor = decodeCursor(options.cursor);
  const limit = pageSize(options.limit);
  const search = options.search?.trim().slice(0, 200) ?? "";
  const where = {
    officeId: accessContext.officeId,
    AND: [
      officeMailEligible,
      ...(search
        ? [{
            OR: [
              { subject: { contains: search, mode: "insensitive" as const } },
              { participants: { contains: search, mode: "insensitive" as const } },
            ],
          }]
        : []),
      ...(cursor
        ? [{
            OR: [
              { lastMessageAt: { lt: cursor.lastMessageAt } },
              { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
            ],
          }]
        : []),
    ],
  } satisfies Prisma.EmailThreadWhereInput;
  const rows = await prisma.emailThread.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: listThreadSelect(),
  });
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const outboundMessages = pageRows.length > 0
    ? await prisma.emailMessage.findMany({
        where: {
          threadId: { in: pageRows.map((row) => row.id) },
          direction: "OUTBOUND",
          thread: { officeId: accessContext.officeId },
        },
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        select: { threadId: true, fromEmail: true },
      })
    : [];
  const mailboxByThread = new Map<string, string>();
  for (const message of outboundMessages) {
    if (!mailboxByThread.has(message.threadId)) mailboxByThread.set(message.threadId, message.fromEmail);
  }
  const threads = pageRows.map((row) => toThread(row, mailboxByThread.get(row.id) ?? null));
  return {
    threads,
    nextCursor: hasMore && threads.length > 0 ? encodeCursor(threads[threads.length - 1]) : null,
  };
}

export async function getOfficeMailThread(
  context: SupplyAccessContext,
  threadId: string,
): Promise<OfficeMailThreadDetail> {
  const accessContext = await assertMailAccess(context);
  const row = await prisma.emailThread.findFirst({
    where: {
      id: threadId,
      officeId: accessContext.officeId,
      AND: [officeMailEligible],
    },
    select: {
      id: true,
      subject: true,
      participants: true,
      companyId: true,
      contactId: true,
      lastMessageAt: true,
      messageCount: true,
      company: { select: { name: true } },
      contact: { select: { fullName: true } },
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: MAX_MESSAGES,
        select: {
          id: true,
          direction: true,
          fromEmail: true,
          toEmails: true,
          subject: true,
          bodyText: true,
          sentAt: true,
        },
      },
      _count: { select: { messages: true } },
    },
  });
  if (!row) throw new SupplyPersistenceError("Mail thread was not found.", "not_found");
  const [latestMessage, newestOutbound] = await Promise.all([
    prisma.emailMessage.findFirst({
      where: { threadId: row.id, thread: { officeId: accessContext.officeId } },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      select: { direction: true },
    }),
    prisma.emailMessage.findFirst({
      where: {
        threadId: row.id,
        direction: "OUTBOUND",
        thread: { officeId: accessContext.officeId },
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      select: { fromEmail: true },
    }),
  ]);
  return {
    id: row.id,
    subject: row.subject,
    participants: parseStoredEmailList(row.participants),
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    contactId: row.contactId,
    contactName: row.contact?.fullName ?? null,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    lastDirection: latestMessage?.direction ?? null,
    mailbox: newestOutbound?.fromEmail ?? null,
    truncated: row._count.messages > row.messages.length,
    messages: [...row.messages].reverse().map((message) => ({
      id: message.id,
      direction: message.direction,
      fromEmail: message.fromEmail,
      toEmails: parseStoredEmailList(message.toEmails),
      subject: message.subject,
      bodyText: message.bodyText,
      sentAt: message.sentAt,
      mailbox: message.direction === "OUTBOUND" ? message.fromEmail : null,
    })),
  };
}
