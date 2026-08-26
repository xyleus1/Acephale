import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  routeInboundMail,
  UNROUTED_MAIL_THREAD_MARKER,
  type InboundRoutingDatabase,
  type InboundRoutingInput,
} from "../src/lib/inbound-mail-routing";

type OutboundRow = {
  threadId: string;
  officeId: string;
  accountId: string;
  rfcMessageId: string | null;
  subject: string;
  toEmails: string;
  sentAt: number;
};

type ThreadRow = {
  id: string;
  officeId: string;
  externalThreadId: string;
  autoLinkSkipReason?: string | null;
};

function routingDatabase(threads: ThreadRow[], messages: OutboundRow[]) {
  const shaped = (row: OutboundRow) => ({
    threadId: row.threadId,
    toEmails: JSON.stringify([row.toEmails]),
    thread: { officeId: row.officeId },
  });
  const newestFirst = [...messages].sort((left, right) => right.sentAt - left.sentAt);
  const db = {
    emailThread: {
      findFirst: async (args: { where: { externalThreadId?: string } }) =>
        threads.find((thread) => thread.externalThreadId === args.where.externalThreadId) ?? null,
      groupBy: async (args: { where: { id: { in: string[] } } }) =>
        [...new Set(newestFirst
          .filter((row) => args.where.id.in.includes(row.threadId))
          .map((row) => row.officeId))].map((officeId) => ({ officeId })),
    },
    emailMessage: {
      findFirst: async (args: {
        where: {
          rfcMessageId?: { in: string[] };
          subject?: { contains: string };
          accountId?: string;
          toEmails?: { contains: string };
        };
      }) => {
        const found = newestFirst.find((row) => matches(row, args.where));
        return found ? shaped(found) : null;
      },
      findMany: async (args: {
        where: { accountId?: string; toEmails?: { contains: string } };
      }) => newestFirst.filter((row) => matches(row, args.where)).map(shaped),
    },
  };
  return db as unknown as InboundRoutingDatabase;
}

function matches(
  row: OutboundRow,
  where: {
    rfcMessageId?: { in: string[] };
    subject?: { contains: string };
    accountId?: string;
    toEmails?: { contains: string };
  },
) {
  if (where.rfcMessageId) {
    return row.rfcMessageId !== null && where.rfcMessageId.in.includes(row.rfcMessageId);
  }
  if (where.subject) return row.subject.includes(where.subject.contains);
  if (where.accountId) {
    return row.accountId === where.accountId
      && row.toEmails.toLowerCase().includes((where.toEmails?.contains ?? "").toLowerCase());
  }
  return false;
}

const inbound = (overrides: Partial<InboundRoutingInput> = {}): InboundRoutingInput => ({
  accountId: "shared-mailbox",
  externalThreadId: "provider-thread-unknown",
  rfcMessageId: "<reply@supplier.test>",
  inReplyTo: null,
  references: [],
  subject: "Re: quote request",
  fromEmail: "sales@supplier.test",
  ...overrides,
});

const outbound: OutboundRow = {
  threadId: "thread-dreamz",
  officeId: "office-dreamz",
  accountId: "shared-mailbox",
  rfcMessageId: "<rfq-1@derya.test>",
  subject: "Custom memory foam RFQ [RFQ e3f6cacc]",
  toEmails: "sales@supplier.test",
  sentAt: 2,
};

async function inboundRoutingContracts() {
  const local = await routeInboundMail(
    routingDatabase([{ id: "thread-dreamz", officeId: "office-dreamz", externalThreadId: "provider-thread-1" }], []),
    inbound({ externalThreadId: "provider-thread-1" }),
  );
  assert.deepEqual(local, {
    routed: true,
    officeId: "office-dreamz",
    threadId: "thread-dreamz",
    evidence: "LOCAL_THREAD",
  });

  const byReference = await routeInboundMail(
    routingDatabase([], [outbound]),
    inbound({ inReplyTo: "<rfq-1@derya.test>" }),
  );
  assert.equal(byReference.routed, true);
  assert.equal(byReference.routed ? byReference.evidence : "", "MESSAGE_REFERENCE");
  assert.equal(byReference.routed ? byReference.officeId : "", "office-dreamz");

  const byReferencesHeader = await routeInboundMail(
    routingDatabase([], [outbound]),
    inbound({ references: ["<other@derya.test>", "<rfq-1@derya.test>"] }),
  );
  assert.equal(byReferencesHeader.routed ? byReferencesHeader.evidence : "", "MESSAGE_REFERENCE");

  const byRfqReference = await routeInboundMail(
    routingDatabase([], [outbound]),
    inbound({ subject: "RE: Custom memory foam RFQ [RFQ e3f6cacc]", fromEmail: "unknown" }),
  );
  assert.equal(byRfqReference.routed ? byRfqReference.evidence : "", "RFQ_REFERENCE");

  const byParticipant = await routeInboundMail(
    routingDatabase([], [outbound]),
    inbound(),
  );
  assert.equal(byParticipant.routed ? byParticipant.evidence : "", "PARTICIPANT_HISTORY");
  assert.equal(byParticipant.routed ? byParticipant.officeId : "", "office-dreamz");

  const ambiguous = await routeInboundMail(
    routingDatabase([], [
      outbound,
      {
        ...outbound,
        threadId: "thread-maneks",
        officeId: "office-maneks",
        rfcMessageId: "<rfq-2@derya.test>",
        subject: "Sheet metal RFQ [RFQ 11112222]",
        sentAt: 3,
      },
    ]),
    inbound(),
  );
  assert.deepEqual(
    ambiguous,
    { routed: false },
    "one supplier contacted for two customers from the same shared mailbox is ambiguous, so it stays unrouted",
  );

  const deepAmbiguity = await routeInboundMail(
    routingDatabase([], [
      { ...outbound, threadId: "thread-maneks", officeId: "office-maneks", sentAt: 0 },
      ...Array.from({ length: 30 }, (_, index) => ({ ...outbound, sentAt: index + 1 })),
    ]),
    inbound(),
  );
  assert.deepEqual(
    deepAmbiguity,
    { routed: false },
    "an older cross-office contact must not be hidden behind newer messages of one office",
  );

  const unroutedFollowUp = await routeInboundMail(
    routingDatabase(
      [{
        id: "thread-unrouted",
        officeId: "office-dreamz",
        externalThreadId: "provider-thread-cold",
        autoLinkSkipReason: UNROUTED_MAIL_THREAD_MARKER,
      }],
      [outbound],
    ),
    inbound({ externalThreadId: "provider-thread-cold" }),
  );
  assert.deepEqual(
    unroutedFollowUp,
    { routed: false },
    "later messages on an unrouted thread must stay out of office memory and CRM history",
  );

  const substringCollision = await routeInboundMail(
    routingDatabase([], [{ ...outbound, toEmails: "nosales@supplier.test" }]),
    inbound(),
  );
  assert.deepEqual(
    substringCollision,
    { routed: false },
    "a sender whose address is only a substring of a contacted address is not a contact",
  );

  const cold = await routeInboundMail(
    routingDatabase([], [outbound]),
    inbound({ fromEmail: "newsletter@example.test", subject: "Our new catalogue" }),
  );
  assert.deepEqual(cold, { routed: false }, "mail about no customer must stay unrouted");
}

const imapSync = readFileSync("src/lib/imap-sync.ts", "utf8");
assert.match(imapSync, /routeInboundMail/, "inbound sync must route shared mailbox mail by thread provenance");
assert.match(
  imapSync,
  /UNROUTED_MAIL_THREAD_MARKER/,
  "unrouted mail must be marked so office views and memory ingestion skip it",
);
assert.match(
  imapSync,
  /routing\?\.routed \? routing\.officeId/,
  "a routed message must be filed into the office that owns the thread",
);

const gmailSync = readFileSync("src/lib/gmail-sync.ts", "utf8");
assert.match(
  gmailSync,
  /localThread\.autoLinkSkipReason === UNROUTED_MAIL_THREAD_MARKER/,
  "provider sync must keep follow-ups on an unrouted thread unrouted",
);

const accountPool = readFileSync("src/lib/email-account-pool.ts", "utf8");
assert.match(accountPool, /SHARED_MAILBOX_POOL_FILTER/);
assert.match(accountPool, /sendEnabled: true/, "sharing must not bypass the send approval flag");

const migration = readFileSync(
  "prisma/migrations/20260825000300_shared_mailbox_pool/migration.sql",
  "utf8",
);
assert.match(migration, /DROP CONSTRAINT IF EXISTS "EmailSenderReservation_accountId_officeId_fkey"/);
assert.match(migration, /DROP CONSTRAINT IF EXISTS "EmailMessage_accountId_officeId_fkey"/);
assert.match(migration, /ADD CONSTRAINT "EmailSenderReservation_accountId_fkey"/);
assert.match(
  migration,
  /CREATE UNIQUE INDEX IF NOT EXISTS "EmailAccount_email_shared_key"/,
  "a shared mailbox exists once for the whole application",
);
assert.match(
  migration,
  /RAISE EXCEPTION\s+'shared mailbox pool migration blocked/,
  "duplicate mailbox rows must fail the migration instead of skipping the identity index",
);

const verification = readFileSync(
  "scripts/sql/production-verification/20260825000300_shared_mailbox_pool.sql",
  "utf8",
);
assert.match(verification, /BEGIN READ ONLY/);

const routing = readFileSync("src/lib/inbound-mail-routing.ts", "utf8");
for (const [name, source] of Object.entries({ routing, imapSync, accountPool, migration, verification })) {
  assert.equal(source.includes("\u2014"), false, `${name} must not contain U+2014.`);
}

assert.equal(UNROUTED_MAIL_THREAD_MARKER, "UNROUTED_SHARED_MAILBOX");

inboundRoutingContracts().then(() => {
  console.log("Shared mailbox pool and inbound routing contracts passed.");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
