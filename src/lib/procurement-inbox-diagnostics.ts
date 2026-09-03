import "server-only";

import { prisma } from "@/lib/prisma";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import {
  LOCAL_RFQ_MESSAGE_LIMIT,
  rfqSubjectReference,
} from "@/lib/procurement-local-outreach-model";

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

async function strandedInboundCount(threadIds: string[], reference: string) {
  let stranded = 0;
  for (let index = 0; index < threadIds.length; index += THREAD_CHUNK) {
    stranded += await prisma.emailMessage.count({
      where: {
        threadId: { in: threadIds.slice(index, index + THREAD_CHUNK) },
        direction: "INBOUND",
        NOT: { subject: { contains: reference } },
      },
    });
  }
  return stranded;
}

export async function procurementInboxDiagnostics(
  orderId: string,
): Promise<ProcurementInboxDiagnostics | null> {
  const summary = await loadBulkRfqOrder(orderId);
  if (!summary) return null;
  const reference = rfqSubjectReference(summary.orderId);
  const messages = await prisma.emailMessage.findMany({
    where: { thread: { officeId: summary.officeId }, subject: { contains: reference } },
    orderBy: [{ sentAt: "asc" }, { id: "asc" }],
    take: LOCAL_RFQ_MESSAGE_LIMIT,
    select: {
      direction: true,
      threadId: true,
      fromEmail: true,
      toEmails: true,
      account: { select: { email: true, provider: true, isActive: true, lastSyncAt: true } },
    },
  });

  const tallies = new Map<string, MailboxTally>();
  const threadIds = new Set<string>();
  for (const message of messages) {
    threadIds.add(message.threadId);
    // A message written before the mailbox pool, or from a mailbox since
    // deleted, carries no account row, and the address it was sent from is
    // still the address a supplier replies to.
    const tally = tallyFor(tallies, {
      email: message.account?.email ?? message.fromEmail.trim().toLowerCase(),
      provider: message.account?.provider ?? null,
      active: message.account?.isActive ?? false,
      lastSyncAt: message.account?.lastSyncAt ?? null,
    });
    if (message.direction === "OUTBOUND") {
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
    strandedInbound: await strandedInboundCount([...threadIds], reference),
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
