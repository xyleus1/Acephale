import "server-only";

import { prisma } from "@/lib/prisma";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { rfqSubjectReference } from "@/lib/procurement-local-outreach-model";

// A campaign only looks silent when every answer reaches us. A reply lands in
// the mailbox that sent the RFQ, so a mailbox that no longer ingests mail, or
// one the hourly sync never reaches, hides supplier answers rather than losing
// them. Reading is a query: nothing here writes or sends.

// Only these providers are pulled by the mail sync, so an RFQ sent from any
// other mailbox can be answered without the answer ever arriving.
const INGESTING_PROVIDERS = new Set(["GMAIL", "GMAIL_APP_PASSWORD"]);
const SYNC_FRESH_MINUTES = 90;
const THREAD_CHUNK = 400;
const STALE_MAILBOX_SAMPLE = 20;
// The scan pages instead of taking one capped slice, so a campaign larger than
// a page still reports whole counts, and the ceiling is reported when it bites
// rather than passed off as the whole picture.
const MESSAGE_PAGE = 1_000;
const MESSAGE_CEILING = 40_000;
const STRANDED_SAMPLE = 25;
const UNKNOWN_MAILBOX = "(mailbox no longer connected)";

export type MailboxReach = {
  email: string;
  provider: string | null;
  active: boolean;
  ingesting: boolean;
  lastSyncAt: string | null;
  outbound: number;
  inbound: number;
  suppliersContacted: number;
};

export type ProcurementInboxDiagnostics = {
  orderId: string;
  officeId: string;
  mailboxes: MailboxReach[];
  // Suppliers written to from a mailbox that cannot ingest a reply. Their
  // answers exist, they just never reach the app.
  unreachable: { suppliers: number; mailboxes: string[] };
  // Answers we did ingest on a thread this request started, whose subject no
  // longer carries the request reference, so the request never counts them.
  strandedInbound: number;
  strandedSample: Array<{
    fromEmail: string;
    subject: string | null;
    sentAt: string;
  }>;
  // True when the scan hit its ceiling, so every count below is a floor.
  truncated: boolean;
  sync: {
    activeMailboxes: number;
    ingestingMailboxes: number;
    syncedWithin: number;
    neverSynced: number;
    oldestSyncAt: string | null;
    stale: Array<{ email: string; lastSyncAt: string | null }>;
  };
};

function firstRecipient(toEmails: string): string | null {
  try {
    const parsed = JSON.parse(toEmails) as unknown;
    if (!Array.isArray(parsed)) return null;
    const first = parsed.find((entry): entry is string => typeof entry === "string");
    return first ? first.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

type MailboxTally = {
  email: string;
  provider: string | null;
  active: boolean;
  lastSyncAt: Date | null;
  outbound: number;
  inbound: number;
  suppliers: Set<string>;
};

function tallyFor(tallies: Map<string, MailboxTally>, mailbox: {
  email: string;
  provider: string | null;
  active: boolean;
  lastSyncAt: Date | null;
}) {
  const existing = tallies.get(mailbox.email);
  if (existing) return existing;
  const created: MailboxTally = {
    email: mailbox.email,
    provider: mailbox.provider,
    active: mailbox.active,
    lastSyncAt: mailbox.lastSyncAt,
    outbound: 0,
    inbound: 0,
    suppliers: new Set<string>(),
  };
  tallies.set(mailbox.email, created);
  return created;
}

function ingesting(tally: MailboxTally) {
  return tally.active && INGESTING_PROVIDERS.has(tally.provider ?? "");
}

// A reply that arrives with no subject at all carries the reference least of
// all, so it counts as stranded rather than falling out of the comparison the
// way a SQL null does.
function strandedWhere(threadIds: string[], reference: string) {
  return {
    threadId: { in: threadIds },
    direction: "INBOUND" as const,
    OR: [{ subject: null }, { NOT: { subject: { contains: reference } } }],
  };
}

async function strandedInbound(threadIds: string[], reference: string) {
  let count = 0;
  // Threads are read in chunks, so each chunk's newest rows are candidates and
  // only the newest across all of them survive. Taking the first chunk's rows
  // would report the oldest threads and hide the replies that just arrived.
  const candidates: Array<{ fromEmail: string; subject: string | null; sentAt: Date; id: string }> = [];
  for (let index = 0; index < threadIds.length; index += THREAD_CHUNK) {
    const where = strandedWhere(threadIds.slice(index, index + THREAD_CHUNK), reference);
    count += await prisma.emailMessage.count({ where });
    const rows = await prisma.emailMessage.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: STRANDED_SAMPLE,
      select: { id: true, fromEmail: true, subject: true, sentAt: true },
    });
    candidates.push(...rows);
  }
  const sample = candidates
    .sort((left, right) => (
      right.sentAt.getTime() - left.sentAt.getTime() || right.id.localeCompare(left.id)
    ))
    .slice(0, STRANDED_SAMPLE)
    .map((row) => ({
      fromEmail: row.fromEmail,
      subject: row.subject,
      sentAt: row.sentAt.toISOString(),
    }));
  return { count, sample };
}

type ScannedMessage = {
  id: string;
  direction: string;
  threadId: string;
  fromEmail: string;
  toEmails: string;
  account: {
    email: string;
    provider: string;
    isActive: boolean;
    lastSyncAt: Date | null;
  } | null;
};

async function scanTaggedMessages(officeId: string, reference: string) {
  const messages: ScannedMessage[] = [];
  let cursor: string | null = null;
  while (messages.length < MESSAGE_CEILING) {
    const page: ScannedMessage[] = await prisma.emailMessage.findMany({
      where: { thread: { officeId }, subject: { contains: reference } },
      orderBy: { id: "asc" },
      take: MESSAGE_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        direction: true,
        threadId: true,
        fromEmail: true,
        toEmails: true,
        account: {
          select: { email: true, provider: true, isActive: true, lastSyncAt: true },
        },
      },
    });
    messages.push(...page);
    if (page.length < MESSAGE_PAGE) return { messages, truncated: false };
    cursor = page[page.length - 1].id;
  }
  // A campaign landing exactly on the ceiling is whole, so truncation is
  // reported only when a further row actually exists.
  const beyond = await prisma.emailMessage.findFirst({
    where: { thread: { officeId }, subject: { contains: reference } },
    orderBy: { id: "asc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true },
  });
  return { messages, truncated: Boolean(beyond) };
}

export async function procurementInboxDiagnostics(
  orderId: string,
): Promise<ProcurementInboxDiagnostics | null> {
  const summary = await loadBulkRfqOrder(orderId);
  if (!summary) return null;
  const reference = rfqSubjectReference(summary.orderId);
  const { messages, truncated } = await scanTaggedMessages(summary.officeId, reference);

  const tallies = new Map<string, MailboxTally>();
  const threadIds = new Set<string>();
  // An outbound message names the mailbox the supplier answers into, so it is
  // what an inbound message whose mailbox row is gone belongs to. Without this
  // the supplier's own address would be reported as one of our mailboxes.
  const threadMailbox = new Map<string, string>();
  for (const message of messages) {
    if (message.direction !== "OUTBOUND") continue;
    const sender = message.account?.email ?? message.fromEmail.trim().toLowerCase();
    if (!threadMailbox.has(message.threadId)) threadMailbox.set(message.threadId, sender);
  }
  for (const message of messages) {
    threadIds.add(message.threadId);
    const outbound = message.direction === "OUTBOUND";
    // A message written before the mailbox pool, or from a mailbox since
    // deleted, carries no account row. Outbound, the address it was sent from
    // is still our mailbox; inbound, it is the supplier, so the thread's own
    // outbound mailbox answers for it instead.
    const email = message.account?.email
      ?? (outbound
        ? message.fromEmail.trim().toLowerCase()
        : threadMailbox.get(message.threadId) ?? UNKNOWN_MAILBOX);
    const tally = tallyFor(tallies, {
      email,
      provider: message.account?.provider ?? null,
      active: message.account?.isActive ?? false,
      lastSyncAt: message.account?.lastSyncAt ?? null,
    });
    if (outbound) {
      tally.outbound += 1;
      const supplier = firstRecipient(message.toEmails);
      if (supplier) tally.suppliers.add(supplier);
    } else {
      tally.inbound += 1;
    }
  }

  const mailboxes = [...tallies.values()]
    .sort((left, right) => right.outbound - left.outbound)
    .map((tally) => ({
      email: tally.email,
      provider: tally.provider,
      active: tally.active,
      ingesting: ingesting(tally),
      lastSyncAt: tally.lastSyncAt?.toISOString() ?? null,
      outbound: tally.outbound,
      inbound: tally.inbound,
      suppliersContacted: tally.suppliers.size,
    }));

  const blind = [...tallies.values()].filter((tally) => !ingesting(tally));
  const blindSuppliers = new Set<string>();
  for (const tally of blind) {
    for (const supplier of tally.suppliers) blindSuppliers.add(supplier);
  }

  const stranded = await strandedInbound([...threadIds], reference);

  const accounts = await prisma.emailAccount.findMany({
    where: { isActive: true },
    select: { email: true, provider: true, lastSyncAt: true },
  });
  const pulled = accounts.filter((account) => INGESTING_PROVIDERS.has(account.provider));
  const fresh = new Date(Date.now() - SYNC_FRESH_MINUTES * 60_000);
  const stale = pulled
    .filter((account) => !account.lastSyncAt || account.lastSyncAt < fresh)
    .sort((left, right) => (left.lastSyncAt?.getTime() ?? 0) - (right.lastSyncAt?.getTime() ?? 0));
  const synced = pulled
    .map((account) => account.lastSyncAt)
    .filter((value): value is Date => value !== null)
    .sort((left, right) => left.getTime() - right.getTime());

  return {
    orderId: summary.orderId,
    officeId: summary.officeId,
    mailboxes,
    unreachable: {
      suppliers: blindSuppliers.size,
      mailboxes: blind.map((tally) => tally.email),
    },
    strandedInbound: stranded.count,
    strandedSample: stranded.sample,
    truncated,
    sync: {
      activeMailboxes: accounts.length,
      ingestingMailboxes: pulled.length,
      syncedWithin: pulled.length - stale.length,
      neverSynced: pulled.filter((account) => !account.lastSyncAt).length,
      oldestSyncAt: synced.at(0)?.toISOString() ?? null,
      stale: stale.slice(0, STALE_MAILBOX_SAMPLE).map((account) => ({
        email: account.email,
        lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      })),
    },
  };
}
