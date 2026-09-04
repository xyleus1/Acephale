import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  outreachFollowUpIdempotencyKey,
  outreachFollowUpInReplyTo,
  outreachFollowUpRfcMessageId,
  outreachUnknownDeliveryExpired,
  renderFollowUpEmail,
  runOutreachCampaignFollowUps,
  unresolvedOutreachCampaignDeliveries,
} from "../src/lib/outreach-campaign-follow-ups";
import { SENDER_PAUSED_ERROR } from "../src/lib/supply-os/supplier-email-provider";
import { outreachCampaignStatusAllowsSend } from "../src/lib/outreach-campaign-send";
import { isHumanReplyMessage } from "../src/lib/outreach-campaign-copy";
import { SHARED_MAILBOX_POOL_FILTER } from "../src/lib/email-account-pool";

type FollowUpRow = {
  officeId: string;
  campaignId: string;
  recordId: string;
  step: number;
  recipient: string;
  status: string;
  skipReason: string | null;
  senderEmail: string | null;
  reservationId: string | null;
  providerMessageId: string | null;
  providerThreadId: string | null;
  localThreadId: string | null;
  error: string | null;
  dueAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
};

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where | undefined) {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const condition = expected as Record<string, unknown>;
      if ("in" in condition) return (condition.in as unknown[]).includes(actual);
      if ("not" in condition) return actual !== condition.not;
      const time = actual instanceof Date ? actual.getTime() : Number.NaN;
      if ("lt" in condition && !(time < (condition.lt as Date).getTime())) return false;
      if ("gte" in condition && !(time >= (condition.gte as Date).getTime())) return false;
      return true;
    }
    return actual === expected;
  });
}

function fakeDatabase(input: {
  status?: string;
  sends: Array<{ recordId: string; recipient: string; sentAt: Date; senderEmail?: string | null; localThreadId: string | null; providerThreadId: string | null }>;
  // Mailbox rows for rotated campaigns. `connected` stands for the
  // SHARED_MAILBOX_POOL_FILTER match (active with credentials).
  emailAccounts?: Array<{ id: string; email: string; officeId: string; connected: boolean; sendEnabled: boolean; sendPausedAt: Date | null }>;
  queuedSends?: number;
  followUps?: FollowUpRow[];
  repliedThreadIds?: string[];
  // Inbound rows beyond plain replies, e.g. delivery feedback whose
  // persistence has not finished (classification set, deliveryKind null).
  inboundMessages?: Array<{ threadId: string; classification: string | null; deliveryKind: string | null }>;
  reservedIds?: string[];
  // Open RESERVED reservations by sender-pool idempotency key.
  openReservations?: Record<string, string>;
  suppressions?: Array<{ officeId: string; email: string; reason: string }>;
  now: Date;
}) {
  const followUps: FollowUpRow[] = input.followUps ?? [];
  const suppressions = input.suppressions ?? [];
  const repliedThreads = new Set(input.repliedThreadIds ?? []);
  const inboundMessages = () => [
    ...[...repliedThreads].map((threadId) => ({ threadId, classification: null, deliveryKind: null })),
    ...(input.inboundMessages ?? []),
  ];
  const reservedIds = new Set(input.reservedIds ?? []);
  const openReservations = input.openReservations ?? {};
  const messages: Array<Record<string, unknown>> = [];
  const threadUpdates: Array<Record<string, unknown>> = [];
  const reservationUpdates: Array<Record<string, unknown>> = [];
  const campaign = { id: "campaign-1", officeId: "office-1", status: input.status ?? "ACTIVE" };
  const followUpModel = {
    findMany: async (args: { where?: Where }) => followUps.filter((row) => matches(row, args.where)),
    count: async (args: { where?: Where }) => followUps.filter((row) => matches(row, args.where)).length,
    deleteMany: async (args: { where?: Where }) => {
      const before = followUps.length;
      for (let index = followUps.length - 1; index >= 0; index -= 1) {
        if (matches(followUps[index], args.where)) followUps.splice(index, 1);
      }
      return { count: before - followUps.length };
    },
    createMany: async (args: { data: Array<Partial<FollowUpRow>>; skipDuplicates?: boolean }) => {
      for (const data of args.data) {
        const duplicate = followUps.some((row) => row.recordId === data.recordId && row.step === data.step);
        if (duplicate) {
          if (args.skipDuplicates) continue;
          const error = new Error("unique") as Error & { code: string };
          error.code = "P2002";
          throw error;
        }
        followUps.push({
          skipReason: null,
          senderEmail: null,
          reservationId: null,
          providerMessageId: null,
          providerThreadId: null,
          localThreadId: null,
          error: null,
          sentAt: null,
          createdAt: input.now,
          ...data,
        } as FollowUpRow);
      }
      return { count: args.data.length };
    },
    updateMany: async (args: { where?: Where; data: Partial<FollowUpRow> }) => {
      let count = 0;
      for (const row of followUps) {
        if (!matches(row, args.where)) continue;
        Object.assign(row, args.data, { updatedAt: input.now });
        count += 1;
      }
      return { count };
    },
  };
  const db = {
    followUps,
    messages,
    threadUpdates,
    reservationUpdates,
    repliedThreads,
    campaign,
    outreachCampaign: {
      findFirst: async () => ({ status: campaign.status }),
      updateMany: async () => ({ count: 1 }),
    },
    outreachCampaignSend: {
      findMany: async (args: { where?: Where }) => (args.where?.status === "UNKNOWN" ? [] : input.sends),
      count: async (args: { where?: Where }) => {
        if (args.where?.status === "QUEUED") return input.queuedSends ?? 0;
        return input.sends
          .map((send) => ({ ...send, officeId: "office-1", campaignId: "campaign-1", status: "SENT" }))
          .filter((send) => matches(send, args.where)).length;
      },
    },
    outreachCampaignFollowUp: followUpModel,
    emailMessage: {
      groupBy: async (args: {
        where: {
          officeId: string;
          direction: string;
          deliveryKind: null;
          OR: Array<{ classification: null } | { classification: { not: string } }>;
          threadId: { in: string[] };
        };
      }) => {
        assert.equal(args.where.officeId, "office-1");
        assert.equal(args.where.direction, "INBOUND");
        assert.deepEqual(args.where.OR, [
          { classification: null },
          { classification: { not: "DELIVERY_FEEDBACK" } },
        ]);
        const replied = new Set(inboundMessages()
          .filter((message) => args.where.threadId.in.includes(message.threadId))
          .filter((message) => message.deliveryKind === args.where.deliveryKind)
          .filter((message) => message.classification === null || message.classification !== "DELIVERY_FEEDBACK")
          .map((message) => message.threadId));
        return [...replied].map((threadId) => ({ threadId, _count: { _all: 1 } }));
      },
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        messages.push(args.data);
        return { id: `message-${messages.length}` };
      },
    },
    emailThread: {
      updateMany: async (args: { where: Where; data: Record<string, unknown> }) => {
        threadUpdates.push({ ...args.where, ...args.data });
        return { count: 1 };
      },
      create: async () => ({ id: "thread-new" }),
    },
    emailSenderReservation: {
      updateMany: async (args: { data: Record<string, unknown> }) => {
        reservationUpdates.push(args.data);
        return { count: 1 };
      },
      findUnique: async (args: { where: { id: string } }) => (reservedIds.has(args.where.id) ? { accountId: "account-1", createdAt: input.now } : null),
      findFirst: async (args: { where: { officeId: string; idempotencyKey: string; status: string } }) => {
        assert.equal(args.where.officeId, "office-1");
        assert.equal(args.where.status, "RESERVED");
        const id = openReservations[args.where.idempotencyKey];
        return id && reservedIds.has(id) ? { id, account: { email: "sender@example.com" } } : null;
      },
      count: async (args: { where: { id: { in: string[] } } }) => args.where.id.in.filter((id) => reservedIds.has(id)).length,
    },
    emailAccount: {
      findMany: async (args: { where: Record<string, unknown> & { email: { in: string[] } } }) => {
        const { email, ...filter } = args.where;
        // Mailboxes are one app-wide pool: the lookup must not scope by office.
        assert.deepEqual(filter, SHARED_MAILBOX_POOL_FILTER);
        return (input.emailAccounts ?? [])
          .filter((account) => account.connected && email.in.includes(account.email))
          .map(({ id, email: address, sendEnabled, sendPausedAt }) => ({ id, email: address, sendEnabled, sendPausedAt }));
      },
    },
    emailSuppression: {
      findMany: async (args: { where: { officeId: string; email: { in: string[] } } }) => suppressions
        .filter((row) => row.officeId === args.where.officeId && args.where.email.in.includes(row.email))
        .map((row) => ({ email: row.email, reason: row.reason })),
    },
    $queryRaw: async () => [{ locked: 1 }],
    $transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };
  return db;
}

const day = (offset: number) => new Date(Date.UTC(2026, 2, 1 + offset, 9));
const now = day(0);
const campaign = {
  id: "campaign-1",
  officeId: "office-1",
  subject: "Hello {{company}}",
  senderAccountId: "account-1",
  senderDisplayName: "Wens",
  dailyCap: 5,
  followUps: [
    { waitDays: 3, subject: null, body: "Still interested, {{company}}? Reply STOP to opt out." },
    { waitDays: 4, subject: "Last note for {{company}}", body: "Closing the loop. Reply STOP to opt out." },
  ],
  audiencePersonalization: {
    "record-1": { email: "buyer@example.com", company: "Buyer Co", country: "DE" },
    "record-2": { email: "other@example.com", company: "Other Co", country: "NL" },
  },
};
const reservation = {
  ok: true as const,
  reservationId: "reservation-1",
  accountId: "account-1",
  senderEmail: "sender@example.com",
  dailySendLimit: 30,
  sentToday: 0,
  reservedToday: 1,
  completed: false,
  providerMessageId: null,
  providerThreadId: null,
  localThreadId: null,
  sentAt: null as Date | null,
};

async function main() {
  assert.equal(isHumanReplyMessage({ deliveryKind: null, classification: null }), true);
  assert.equal(isHumanReplyMessage({ deliveryKind: null, classification: "DELIVERY_FEEDBACK" }), false);
  const rendered = renderFollowUpEmail({
    step: { waitDays: 3, subject: null, bodyTemplate: "Still interested, {{company}}? Reply STOP to opt out." },
    campaignSubject: "Hello {{company}}",
    personalization: campaign.audiencePersonalization["record-1"],
  });
  assert.equal(rendered.subject, "Re: Hello Buyer Co");
  assert.equal(rendered.body, "Still interested, Buyer Co? Reply STOP to opt out.");
  assert.equal(outreachFollowUpIdempotencyKey("campaign-1", "record-1", 2), "outreach-campaign:campaign-1:record-1:follow-up:2");
  assert.equal(outreachFollowUpInReplyTo("campaign-1", "record-1", 1), "<outreach-campaign-record-1@derya.ai>");
  assert.equal(outreachFollowUpInReplyTo("campaign-1", "record-1", 2), outreachFollowUpRfcMessageId("campaign-1", "record-1", 1));

  const providerCalls: Array<Record<string, unknown>> = [];
  const reserveKeys: string[] = [];
  const provider = {
    send: async (input: Record<string, unknown>) => {
      providerCalls.push(input);
      return {
        state: "SENT" as const,
        provider: "GMAIL" as const,
        providerMessageId: `provider-${providerCalls.length}`,
        providerThreadId: "provider-thread-1",
        sourceUrl: "https://mail.google.com",
      };
    },
    reconcile: async () => ({ state: "UNKNOWN" as const, error: "unused" }),
  };
  const reserve = async (input: { idempotencyKey: string }) => {
    reserveKeys.push(input.idempotencyKey);
    return reservation;
  };
  const baseInput = {
    campaign,
    provider,
    now,
    pauseMs: 0,
    reserve,
    release: async () => undefined,
    statusAllowsSend: outreachCampaignStatusAllowsSend,
  };

  // Due first follow-up stays in the original thread and records a SENT ledger row.
  const dueDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const dueRun = await runOutreachCampaignFollowUps({ ...baseInput, db: dueDb as never });
  assert.equal(dueRun.sent, 1);
  assert.equal(dueRun.attempted, 1);
  assert.equal(dueRun.outstanding, 1, "step 2 is still ahead after step 1 was sent this run");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].providerThreadId, "provider-thread-1");
  assert.equal(providerCalls[0].inReplyToRfcMessageId, "<outreach-campaign-record-1@derya.ai>");
  assert.equal(providerCalls[0].subject, "Re: Hello Buyer Co");
  assert.equal(providerCalls[0].senderDisplayName, "Wens");
  assert.equal(reserveKeys[0], "outreach-campaign:campaign-1:record-1:follow-up:1");
  assert.equal(dueDb.followUps.length, 1);
  assert.equal(dueDb.followUps[0].status, "SENT");
  assert.equal(dueDb.followUps[0].step, 1);
  assert.equal(dueDb.followUps[0].localThreadId, "thread-1");
  assert.equal(dueDb.messages.length, 1);
  assert.equal(dueDb.messages[0].threadId, "thread-1");
  assert.equal(dueDb.messages[0].direction, "OUTBOUND");
  assert.equal(dueDb.threadUpdates.length, 1);
  assert.equal(dueDb.reservationUpdates[0]?.status, "RECORDED");

  // Re-running the same day does nothing: step 1 is sent and step 2 is not due yet.
  const rerun = await runOutreachCampaignFollowUps({ ...baseInput, db: dueDb as never });
  assert.equal(rerun.sent, 0);
  assert.equal(rerun.outstanding, 1);
  assert.equal(providerCalls.length, 1);

  // Step 2 becomes due four days after step 1 and replies to the step 1 message.
  const stepTwoRun = await runOutreachCampaignFollowUps({ ...baseInput, db: dueDb as never, now: day(4) });
  assert.equal(stepTwoRun.sent, 1);
  assert.equal(stepTwoRun.outstanding, 0, "the run that sends the final step reports the sequence as complete");
  assert.equal(providerCalls[1].inReplyToRfcMessageId, outreachFollowUpRfcMessageId("campaign-1", "record-1", 1));
  assert.equal(providerCalls[1].subject, "Last note for Buyer Co");
  assert.equal(dueDb.followUps.filter((row) => row.status === "SENT").length, 2);
  const finished = await runOutreachCampaignFollowUps({ ...baseInput, db: dueDb as never, now: day(30) });
  assert.equal(finished.outstanding, 0, "sequence is complete once every step is sent");
  assert.equal(providerCalls.length, 2);

  // Not yet due: nothing is claimed or sent, but the sequence remains outstanding.
  const earlyDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-1), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const earlyRun = await runOutreachCampaignFollowUps({ ...baseInput, db: earlyDb as never });
  assert.equal(earlyRun.sent, 0);
  assert.equal(earlyRun.outstanding, 1);
  assert.equal(earlyDb.followUps.length, 0);
  assert.equal(providerCalls.length, 2);

  // A reply in the local thread skips the sequence and records the reason.
  const repliedDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    inboundMessages: [{ threadId: "thread-1", classification: null, deliveryKind: null }],
    now,
  });
  const repliedRun = await runOutreachCampaignFollowUps({ ...baseInput, db: repliedDb as never });
  assert.equal(repliedRun.skipped, 1);
  assert.equal(repliedRun.sent, 0);
  assert.equal(repliedRun.outstanding, 0);
  assert.equal(repliedDb.followUps[0].status, "SKIPPED");
  assert.equal(repliedDb.followUps[0].skipReason, "REPLIED");
  assert.equal(providerCalls.length, 2);

  // Delivery feedback is not a reply, even while its persistence is unfinished
  // (classification set, deliveryKind still null): a transient bounce or an
  // auto-reply in the thread leaves the sequence running.
  const feedbackDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    inboundMessages: [
      // Transient 4.x.x bounce, persistence still pending.
      { threadId: "thread-1", classification: "DELIVERY_FEEDBACK", deliveryKind: null },
      // Out-of-office auto-reply, persistence still pending.
      { threadId: "thread-1", classification: "DELIVERY_FEEDBACK", deliveryKind: null },
    ],
    now,
  });
  const feedbackRun = await runOutreachCampaignFollowUps({ ...baseInput, db: feedbackDb as never });
  assert.equal(feedbackRun.skipped, 0, "unfinished delivery feedback is not a REPLIED skip");
  assert.equal(feedbackRun.sent, 1, "the sequence continues past unfinished delivery feedback");
  assert.equal(feedbackDb.followUps[0].status, "SENT");
  assert.equal(feedbackDb.followUps[0].skipReason, null);
  assert.equal(providerCalls.at(-1)?.recipient, "buyer@example.com");
  providerCalls.pop();
  // Finished feedback (deliveryKind set) is excluded as before, and a real reply
  // next to feedback in the same thread still skips.
  const mixedInboundDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    inboundMessages: [
      { threadId: "thread-1", classification: "DELIVERY_FEEDBACK", deliveryKind: "BOUNCE" },
      { threadId: "thread-1", classification: "SUPPLIER_QUOTE", deliveryKind: null },
    ],
    now,
  });
  const mixedInboundRun = await runOutreachCampaignFollowUps({ ...baseInput, db: mixedInboundDb as never });
  assert.equal(mixedInboundRun.skipped, 1);
  assert.equal(mixedInboundDb.followUps[0].skipReason, "REPLIED");

  // Suppressed recipients never receive follow-ups.
  const suppressedDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const suppressedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: suppressedDb as never,
    suppressedRecipients: new Set(["buyer@example.com"]),
  });
  assert.equal(suppressedRun.skipped, 1);
  assert.equal(suppressedDb.followUps[0].skipReason, "SUPPRESSED");
  assert.equal(providerCalls.length, 2);

  // Persisted office-scoped suppressions end the sequence without a caller-supplied
  // set: a permanent bounce is recorded as BOUNCED, an opt-out as SUPPRESSED, and a
  // suppression that belongs to another office is ignored.
  const callsBeforePersisted = providerCalls.length;
  const persistedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-3), localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
      { recordId: "record-3", recipient: "third@example.com", sentAt: day(-3), localThreadId: "thread-3", providerThreadId: "provider-thread-3" },
    ],
    suppressions: [
      { officeId: "office-1", email: "buyer@example.com", reason: "BOUNCED" },
      { officeId: "office-1", email: "other@example.com", reason: "OPTED_OUT" },
      { officeId: "office-2", email: "third@example.com", reason: "BOUNCED" },
    ],
    now,
  });
  const persistedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: persistedDb as never,
    campaign: {
      ...campaign,
      audiencePersonalization: {
        ...campaign.audiencePersonalization,
        "record-3": { email: "third@example.com", company: "Third Co", country: "FR" },
      },
    },
  });
  assert.equal(persistedRun.skipped, 2);
  assert.equal(persistedRun.sent, 1, "the other office's suppression does not block this office");
  assert.equal(persistedDb.followUps.find((row) => row.recordId === "record-1")?.skipReason, "BOUNCED");
  assert.equal(persistedDb.followUps.find((row) => row.recordId === "record-2")?.skipReason, "SUPPRESSED");
  assert.equal(persistedDb.followUps.find((row) => row.recordId === "record-3")?.status, "SENT");
  assert.equal(providerCalls.length, callsBeforePersisted + 1);
  assert.equal(providerCalls.at(-1)?.recipient, "third@example.com");
  // Later scenarios assert absolute provider call counts.
  providerCalls.pop();

  // Paused campaigns do not claim, skip, or send anything.
  const pausedDb = fakeDatabase({
    status: "PAUSED",
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    repliedThreadIds: ["thread-1"],
    now,
  });
  const pausedRun = await runOutreachCampaignFollowUps({ ...baseInput, db: pausedDb as never });
  assert.equal(pausedRun.sent + pausedRun.skipped + pausedRun.attempted, 0);
  assert.equal(pausedDb.followUps.length, 0);
  assert.equal(providerCalls.length, 2);

  // First touches sent today count against the shared daily cap.
  const cappedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: now, localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    now,
  });
  const cappedRun = await runOutreachCampaignFollowUps({ ...baseInput, db: cappedDb as never, campaign: { ...campaign, dailyCap: 1 } });
  assert.equal(cappedRun.sent, 0);
  assert.equal(cappedRun.outstanding, 2);
  assert.equal(cappedDb.followUps.length, 0, "nothing is claimed once the daily cap is reached");
  assert.equal(providerCalls.length, 2);

  // The limit argument bounds a single run.
  const limitedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-3), localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    now,
  });
  const limitedRun = await runOutreachCampaignFollowUps({ ...baseInput, db: limitedDb as never, limit: 1 });
  assert.equal(limitedRun.sent, 1);
  assert.equal(limitedDb.followUps.length, 1);
  assert.equal(providerCalls.length, 3);

  // A completed reservation means the follow-up already went out: no second provider call.
  const idempotentDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const idempotentRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: idempotentDb as never,
    reserve: async () => ({ ...reservation, completed: true }),
  });
  assert.equal(idempotentRun.alreadySent, 1);
  assert.equal(idempotentRun.sent, 0);
  assert.equal(idempotentDb.followUps[0].status, "SENT");
  assert.equal(providerCalls.length, 3);


  // Rejected follow-ups release the reservation, end the sequence, and are not retried.
  let released = 0;
  const rejectedDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const rejectedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: rejectedDb as never,
    provider: { ...provider, send: async () => ({ state: "REJECTED" as const, error: "bounced" }) },
    release: async () => { released += 1; },
  });
  assert.equal(rejectedRun.rejected, 1);
  assert.equal(released, 1);
  assert.equal(rejectedDb.followUps[0].status, "REJECTED");
  assert.equal(rejectedDb.followUps[0].error, "bounced");
  const rejectedRerun = await runOutreachCampaignFollowUps({ ...baseInput, db: rejectedDb as never, now: day(10) });
  assert.equal(rejectedRerun.attempted, 0);
  assert.equal(rejectedRerun.outstanding, 0);
  assert.equal(rejectedDb.followUps.length, 1);

  // Unknown outcomes keep the ledger row for reconciliation and never advance the sequence.
  const unknownDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const unknownRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: unknownDb as never,
    provider: { ...provider, send: async () => ({ state: "UNKNOWN" as const, error: "timeout" }) },
  });
  assert.equal(unknownRun.unknown, 1);
  assert.equal(unknownDb.followUps[0].status, "UNKNOWN");
  assert.equal(unknownDb.followUps[0].reservationId, "reservation-1");
  const unknownRerun = await runOutreachCampaignFollowUps({ ...baseInput, db: unknownDb as never, now: day(10) });
  assert.equal(unknownRerun.attempted, 0);

  // A final step left UNKNOWN with a live reservation keeps the campaign open until
  // a later cron run confirms it as SENT.
  const pendingDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    reservedIds: ["reservation-1"],
    now,
  });
  await runOutreachCampaignFollowUps({
    ...baseInput,
    db: pendingDb as never,
    campaign: { ...campaign, followUps: campaign.followUps.slice(0, 1) },
    provider: { ...provider, send: async () => ({ state: "UNKNOWN" as const, error: "timeout" }) },
  });
  assert.equal(pendingDb.followUps[0].status, "UNKNOWN");
  assert.equal(await unresolvedOutreachCampaignDeliveries(pendingDb as never, { id: "campaign-1", officeId: "office-1" }), 1);
  const confirmedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: pendingDb as never,
    now: day(1),
    campaign: { ...campaign, followUps: campaign.followUps.slice(0, 1) },
    provider: {
      send: async () => { throw new Error("reconciliation must not send again"); },
      reconcile: async () => ({
        state: "SENT" as const,
        provider: "GMAIL" as const,
        providerMessageId: "provider-late",
        providerThreadId: "provider-thread-1",
        sourceUrl: "https://mail.google.com",
      }),
    },
  });
  assert.equal(confirmedRun.outstanding, 0);
  assert.equal(pendingDb.followUps[0].status, "SENT");
  assert.equal(pendingDb.followUps[0].providerMessageId, "provider-late");
  assert.equal(pendingDb.reservationUpdates.at(-1)?.status, "RECORDED");
  assert.equal(
    pendingDb.followUps[0].sentAt?.getTime(),
    day(0).getTime(),
    "a recovered send keeps the original delivery time (the reservation), not the reconciliation time",
  );

  // A recovered step 1 must not restart the wait for step 2: confirmed a day
  // late, step 2 is still due from the original delivery.
  const lateRecoveryDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    reservedIds: ["reservation-1"],
    now,
  });
  await runOutreachCampaignFollowUps({
    ...baseInput,
    db: lateRecoveryDb as never,
    provider: { ...provider, send: async () => ({ state: "UNKNOWN" as const, error: "timeout" }) },
  });
  assert.equal(lateRecoveryDb.followUps[0].status, "UNKNOWN");
  const lateRecoveryProvider = {
    send: async () => { throw new Error("reconciliation must not send again"); },
    reconcile: async () => ({
      state: "SENT" as const,
      provider: "GMAIL" as const,
      providerMessageId: "provider-recovered",
      providerThreadId: "provider-thread-1",
      sourceUrl: "https://mail.google.com",
    }),
  };
  await runOutreachCampaignFollowUps({ ...baseInput, db: lateRecoveryDb as never, now: day(1), provider: lateRecoveryProvider });
  assert.equal(lateRecoveryDb.followUps[0].status, "SENT");
  assert.equal(lateRecoveryDb.followUps[0].sentAt?.getTime(), day(0).getTime());
  const stepTwoProvider = {
    ...provider,
    send: async () => ({
      state: "SENT" as const,
      provider: "GMAIL" as const,
      providerMessageId: "provider-step-2",
      providerThreadId: "provider-thread-1",
      sourceUrl: "https://mail.google.com",
    }),
  };
  const beforeDue = await runOutreachCampaignFollowUps({ ...baseInput, db: lateRecoveryDb as never, now: day(3), provider: stepTwoProvider });
  assert.equal(beforeDue.attempted, 0, "step 2 waits four days after the original step 1 delivery");
  const lateRecoveryStepTwo = await runOutreachCampaignFollowUps({ ...baseInput, db: lateRecoveryDb as never, now: day(4), provider: stepTwoProvider });
  assert.equal(lateRecoveryStepTwo.sent, 1, "step 2 is due four days after the original delivery, not after recovery");
  assert.equal(lateRecoveryDb.followUps.find((row) => row.step === 2)?.dueAt.getTime(), day(4).getTime());

  // A crash between the sender reservation and the ledger write leaves a
  // RESERVED reservation with no follow-up row once the claim is reclaimed. The
  // next run's reservation is refused as DELIVERY_UNCERTAIN; the claim must not
  // be dropped again (that would retry forever) but recorded as UNKNOWN against
  // the open reservation so reconciliation settles it.
  const uncertainKey = outreachFollowUpIdempotencyKey("campaign-1", "record-1", 1);
  const uncertainDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    reservedIds: ["reservation-orphan"],
    openReservations: { [uncertainKey]: "reservation-orphan" },
    now,
  });
  const uncertainRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: uncertainDb as never,
    reserve: async () => ({ error: "delivery outcome unknown", code: "DELIVERY_UNCERTAIN" as const }),
    provider: { ...provider, send: async () => { throw new Error("an uncertain reservation must not send"); } },
  });
  assert.equal(uncertainRun.unknown, 1);
  assert.equal(uncertainRun.rejected, 0);
  assert.equal(uncertainRun.outstanding, 0, "an UNKNOWN row ends planning for the sequence until reconciled");
  assert.equal(uncertainDb.followUps.length, 1, "the claim is settled, not released");
  assert.equal(uncertainDb.followUps[0].status, "UNKNOWN");
  assert.equal(uncertainDb.followUps[0].reservationId, "reservation-orphan");
  assert.equal(uncertainDb.followUps[0].senderEmail, "sender@example.com");
  assert.equal(await unresolvedOutreachCampaignDeliveries(uncertainDb as never, { id: "campaign-1", officeId: "office-1" }), 1);
  // Reconciliation on the next run confirms the delivery from the provider and
  // records it against the orphaned reservation at its original time.
  const uncertainConfirmed = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: uncertainDb as never,
    now: day(1),
    provider: {
      send: async () => { throw new Error("reconciliation must not send again"); },
      reconcile: async () => ({
        state: "SENT" as const,
        provider: "GMAIL" as const,
        providerMessageId: "provider-orphan",
        providerThreadId: "provider-thread-1",
        sourceUrl: "https://mail.google.com",
      }),
    },
  });
  assert.equal(uncertainDb.followUps[0].status, "SENT");
  assert.equal(uncertainDb.followUps[0].providerMessageId, "provider-orphan");
  assert.equal(uncertainDb.followUps[0].sentAt?.getTime(), day(0).getTime());
  assert.equal(uncertainDb.reservationUpdates.at(-1)?.status, "RECORDED");
  assert.equal(uncertainConfirmed.outstanding, 1, "step 2 is ahead once step 1 is confirmed");
  // The same refusal with NOT_FOUND from the provider reaches a terminal state
  // after the timeout instead of looping.
  let orphanReleases = 0;
  const orphanExpiredDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    reservedIds: ["reservation-orphan"],
    openReservations: { [uncertainKey]: "reservation-orphan" },
    now,
  });
  await runOutreachCampaignFollowUps({
    ...baseInput,
    db: orphanExpiredDb as never,
    reserve: async () => ({ error: "delivery outcome unknown", code: "DELIVERY_UNCERTAIN" as const }),
  });
  const orphanExpiredRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: orphanExpiredDb as never,
    now: day(2),
    provider: { ...provider, reconcile: async () => ({ state: "NOT_FOUND" as const }) },
    release: async () => { orphanReleases += 1; },
  });
  assert.equal(orphanReleases, 1);
  assert.equal(orphanExpiredDb.followUps[0].status, "REJECTED");
  assert.equal(orphanExpiredRun.outstanding, 0);

  // A terminal reservation conflict is recorded as REJECTED and never claimed again.
  const conflictDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const conflictReserve = async () => ({ error: "key used for different content", code: "IDEMPOTENCY_CONFLICT" as const });
  const conflictRun = await runOutreachCampaignFollowUps({ ...baseInput, db: conflictDb as never, reserve: conflictReserve });
  assert.equal(conflictRun.rejected, 1);
  assert.equal(conflictRun.outstanding, 0);
  assert.equal(conflictDb.followUps.length, 1);
  assert.equal(conflictDb.followUps[0].status, "REJECTED");
  assert.equal(conflictDb.followUps[0].error, "key used for different content");
  const conflictRerun = await runOutreachCampaignFollowUps({ ...baseInput, db: conflictDb as never, now: day(1), reserve: conflictReserve });
  assert.equal(conflictRerun.attempted + conflictRerun.rejected, 0, "a REJECTED row is not reclaimed");
  assert.equal(conflictDb.followUps.length, 1);
  assert.equal(providerCalls.length, 3);

  // NOT_FOUND after the timeout window is a terminal non-delivery: release and reject.
  assert.equal(outreachUnknownDeliveryExpired(now, new Date(now.getTime() + 23 * 3_600_000)), false);
  assert.equal(outreachUnknownDeliveryExpired(now, new Date(now.getTime() + 24 * 3_600_000)), true);
  let expiredReleases = 0;
  const expiredDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    reservedIds: ["reservation-1"],
    now,
  });
  await runOutreachCampaignFollowUps({
    ...baseInput,
    db: expiredDb as never,
    provider: { ...provider, send: async () => ({ state: "UNKNOWN" as const, error: "timeout" }) },
  });
  const notFoundRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: expiredDb as never,
    now: day(2),
    provider: { ...provider, reconcile: async () => ({ state: "NOT_FOUND" as const }) },
    release: async () => { expiredReleases += 1; },
  });
  assert.equal(expiredReleases, 1);
  assert.equal(expiredDb.followUps[0].status, "REJECTED");
  assert.equal(notFoundRun.outstanding, 0);
  assert.equal(providerCalls.length, 3);

  // A reply that lands after planning but before the provider call skips that candidate.
  const lateReplyDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-3), localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    now,
  });
  let lateReleases = 0;
  const lateReplyRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: lateReplyDb as never,
    provider: {
      ...provider,
      send: async (sendInput) => {
        lateReplyDb.repliedThreads.add("thread-2");
        return provider.send(sendInput);
      },
    },
    release: async () => { lateReleases += 1; },
  });
  assert.equal(lateReplyRun.sent, 1);
  assert.equal(lateReplyRun.skipped, 1);
  assert.equal(lateReleases, 1);
  assert.equal(providerCalls.length, 4);
  const lateSkipped = lateReplyDb.followUps.find((row) => row.recordId === "record-2");
  assert.equal(lateSkipped?.status, "SKIPPED");
  assert.equal(lateSkipped?.skipReason, "REPLIED");

  // A bounce synced after planning but before the provider call ends that
  // sequence: the reservation is released and the step is SKIPPED as BOUNCED.
  const lateBounceSuppressions: Array<{ officeId: string; email: string; reason: string }> = [];
  const lateBounceDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-3), localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    suppressions: lateBounceSuppressions,
    now,
  });
  let lateBounceReleases = 0;
  const lateBounceRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: lateBounceDb as never,
    provider: {
      ...provider,
      send: async (sendInput) => {
        lateBounceSuppressions.push({ officeId: "office-1", email: "other@example.com", reason: "BOUNCED" });
        return provider.send(sendInput);
      },
    },
    release: async () => { lateBounceReleases += 1; },
  });
  assert.equal(lateBounceRun.sent, 1);
  assert.equal(lateBounceRun.skipped, 1);
  assert.equal(lateBounceRun.outstanding, 1, "only the sent sequence (step 2 ahead) remains outstanding; the late skip does not");
  assert.equal(lateBounceReleases, 1, "the reservation for the bounced recipient is released");
  assert.equal(providerCalls.length, 5, "the bounced recipient never reaches the provider");
  const lateBounced = lateBounceDb.followUps.find((row) => row.recordId === "record-2");
  assert.equal(lateBounced?.status, "SKIPPED");
  assert.equal(lateBounced?.skipReason, "BOUNCED");

  // QUEUED first-touch claims count against the shared cap.
  const queuedFirstTouchDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    queuedSends: 1,
    now,
  });
  const queuedFirstTouchRun = await runOutreachCampaignFollowUps({ ...baseInput, db: queuedFirstTouchDb as never, campaign: { ...campaign, dailyCap: 1 } });
  assert.equal(queuedFirstTouchRun.attempted, 0);
  assert.equal(queuedFirstTouchDb.followUps.length, 0);

  // QUEUED follow-up claims for other recipients count against the shared cap too.
  const otherClaimDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    followUps: [{
      officeId: "office-1",
      campaignId: "campaign-1",
      recordId: "record-9",
      step: 1,
      recipient: "nine@example.com",
      status: "QUEUED",
      skipReason: null,
      senderEmail: null,
      reservationId: null,
      providerMessageId: null,
      providerThreadId: null,
      localThreadId: null,
      error: null,
      dueAt: day(0),
      sentAt: null,
      createdAt: now,
    }],
    now,
  });
  const otherClaimRun = await runOutreachCampaignFollowUps({ ...baseInput, db: otherClaimDb as never, campaign: { ...campaign, dailyCap: 1 } });
  assert.equal(otherClaimRun.attempted, 0);
  assert.equal(otherClaimDb.followUps.length, 1, "no new claim while another live claim holds the last slot");
  assert.equal(providerCalls.length, 5);

  // Pool exhaustion releases every unprocessed claim so the next run can take them at once.
  const exhaustedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-3), localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    now,
  });
  const exhaustedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: exhaustedDb as never,
    reserve: async () => ({ error: "pool exhausted", code: "POOL_EXHAUSTED" as const }),
  });
  assert.equal(exhaustedRun.poolExhausted, true);
  assert.equal(exhaustedDb.followUps.length, 0, "every claimed row is released");
  const afterExhaustion = await runOutreachCampaignFollowUps({ ...baseInput, db: exhaustedDb as never });
  assert.equal(afterExhaustion.sent, 2);
  assert.equal(providerCalls.length, 7);

  // A pause after the first reservation releases the current and later claims.
  const pauseMidBatchDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-3), localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    now,
  });
  let pauseReleases = 0;
  const pauseMidBatchRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: pauseMidBatchDb as never,
    reserve: async () => {
      pauseMidBatchDb.campaign.status = "PAUSED";
      return reservation;
    },
    release: async () => { pauseReleases += 1; },
  });
  assert.equal(pauseMidBatchRun.sent, 0);
  assert.equal(pauseReleases, 1);
  assert.equal(pauseMidBatchDb.followUps.length, 0);
  assert.equal(providerCalls.length, 7);

  // Stale QUEUED claims are reclaimed after the reclaim window.
  const staleDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-3), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    followUps: [{
      officeId: "office-1",
      campaignId: "campaign-1",
      recordId: "record-1",
      step: 1,
      recipient: "buyer@example.com",
      status: "QUEUED",
      skipReason: null,
      senderEmail: null,
      reservationId: null,
      providerMessageId: null,
      providerThreadId: null,
      localThreadId: null,
      error: null,
      dueAt: day(0),
      sentAt: null,
      createdAt: new Date(now.getTime() - 2 * 60 * 60_000),
    }],
    now,
  });
  const staleRun = await runOutreachCampaignFollowUps({ ...baseInput, db: staleDb as never });
  assert.equal(staleRun.sent, 1);

  // Campaigns without follow-ups are a no-op.
  const noneRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: fakeDatabase({ sends: [], now }) as never,
    campaign: { ...campaign, followUps: null },
  });
  assert.equal(noneRun.steps, 0);

  const providerCallsBeforeRecovery = providerCalls.length;
  // Recovering a delivery that happened earlier keeps the original send time and
  // provider ids, so the next step is scheduled from delivery, not from recovery.
  const recoveredDb = fakeDatabase({
    sends: [{ recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-9), localThreadId: "thread-1", providerThreadId: "provider-thread-1" }],
    now,
  });
  const recoveredRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: recoveredDb as never,
    reserve: async (input: { idempotencyKey: string }) => (
      input.idempotencyKey.endsWith(":follow-up:1")
        ? {
          ...reservation,
          reservationId: "reservation-recovered",
          completed: true,
          providerMessageId: "provider-recovered",
          providerThreadId: "provider-thread-recovered",
          localThreadId: "thread-recovered",
          sentAt: day(-5),
        }
        : reservation
    ),
  });
  assert.equal(recoveredRun.alreadySent, 1);
  const recoveredStep = recoveredDb.followUps.find((row) => row.step === 1);
  assert.equal(recoveredStep?.status, "SENT");
  assert.equal(recoveredStep?.sentAt?.getTime(), day(-5).getTime());
  assert.equal(recoveredStep?.reservationId, "reservation-recovered");
  assert.equal(recoveredStep?.providerMessageId, "provider-recovered");
  assert.equal(recoveredStep?.providerThreadId, "provider-thread-recovered");
  assert.equal(recoveredStep?.localThreadId, "thread-recovered");
  // Step 2 waits 4 days after step 1: due since day(-1), so it goes out on the next run.
  const afterRecovery = await runOutreachCampaignFollowUps({ ...baseInput, db: recoveredDb as never });
  assert.equal(afterRecovery.sent, 1);
  assert.equal(recoveredDb.followUps.find((row) => row.step === 2)?.status, "SENT");
  assert.equal(providerCalls.length, providerCallsBeforeRecovery + 1);

  // Campaign summaries report daily usage across both ledgers, since follow-ups
  // consume the same daily cap as first touches.
  const summarySource = readFileSync(path.join(process.cwd(), "src/lib/outreach-campaigns.ts"), "utf8");
  const summaryBody = summarySource.slice(summarySource.indexOf("export async function listCampaignSummaries"));
  assert.match(summaryBody, /prisma\.outreachCampaignSend\.groupBy\(\{ by: \["campaignId"\], where: todayScope/);
  assert.match(summaryBody, /prisma\.outreachCampaignFollowUp\.groupBy\(\{ by: \["campaignId"\], where: todayScope/);
  assert.match(summaryBody, /sentToday: sentToday\.get\(campaign\.id\) \?\? 0/);

  // A rotated campaign has no pinned sender. Each follow-up leaves from the
  // mailbox that sent that recipient's first touch, so the thread stays intact,
  // and one mailbox at its cap only defers its own recipients. Mailboxes are an
  // app-wide pool, so a first touch sent from a mailbox connected by another
  // office still resolves.
  const rotatedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "alpha@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-4), senderEmail: "beta@example.com", localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    emailAccounts: [
      { id: "account-alpha", email: "alpha@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
      { id: "account-beta", email: "beta@example.com", officeId: "office-2", connected: true, sendEnabled: true, sendPausedAt: null },
    ],
    now,
  });
  const rotatedReservations: Array<string | undefined> = [];
  const rotatedProviderCalls: Array<Record<string, unknown>> = [];
  const rotatedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    campaign: { ...campaign, senderAccountId: null },
    db: rotatedDb as never,
    provider: {
      ...provider,
      send: async (input: Record<string, unknown>) => {
        rotatedProviderCalls.push(input);
        return provider.send(input);
      },
    },
    reserve: async (input: { accountId?: string }) => {
      rotatedReservations.push(input.accountId);
      if (input.accountId === "account-alpha") {
        return { error: "mailbox at its daily limit", code: "POOL_EXHAUSTED" as const };
      }
      return { ...reservation, reservationId: "reservation-beta", accountId: "account-beta", senderEmail: "beta@example.com" };
    },
  });
  assert.deepEqual(rotatedReservations, ["account-alpha", "account-beta"], "each follow-up reserves its first-touch mailbox");
  assert.equal(rotatedRun.sent, 1, "the other mailbox still sends");
  assert.equal(rotatedRun.poolExhausted, false, "one exhausted mailbox does not stop a rotated campaign");
  assert.equal(rotatedProviderCalls[0]?.accountId, "account-beta");
  assert.equal(rotatedProviderCalls[0]?.providerThreadId, "provider-thread-2");
  assert.equal(rotatedDb.followUps.find((row) => row.recordId === "record-2")?.status, "SENT");
  assert.equal(rotatedDb.followUps.find((row) => row.recordId === "record-1"), undefined, "the deferred claim is released for the next run");
  // record-1 step 1 is still due, and record-2 step 2 follows later.
  assert.equal(rotatedRun.outstanding, 2);

  // With a run limit smaller than the due set, a blocked mailbox at the front
  // of the plan must not hold the only slot forever: its released claim is
  // refilled from later recipients on other mailboxes, and recipients on the
  // same blocked mailbox are not refilled in this run.
  const starvedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "alpha@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-3", recipient: "third@example.com", sentAt: new Date(day(-4).getTime() + 60_000), senderEmail: "alpha@example.com", localThreadId: "thread-3", providerThreadId: "provider-thread-3" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: new Date(day(-4).getTime() + 120_000), senderEmail: "beta@example.com", localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    emailAccounts: [
      { id: "account-alpha", email: "alpha@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
      { id: "account-beta", email: "beta@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
    ],
    now,
  });
  const starvedReservations: Array<string | undefined> = [];
  const starvedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    limit: 1,
    campaign: {
      ...campaign,
      senderAccountId: null,
      audiencePersonalization: {
        ...campaign.audiencePersonalization,
        "record-3": { email: "third@example.com", company: "Third Co", country: "FR" },
      },
    },
    db: starvedDb as never,
    reserve: async (input: { accountId?: string }) => {
      starvedReservations.push(input.accountId);
      if (input.accountId === "account-alpha") {
        return { error: "mailbox at its daily limit", code: "POOL_EXHAUSTED" as const };
      }
      return { ...reservation, reservationId: "reservation-beta", accountId: "account-beta", senderEmail: "beta@example.com" };
    },
  });
  assert.deepEqual(starvedReservations, ["account-alpha", "account-beta"], "the freed slot goes to a recipient on another mailbox");
  assert.equal(starvedRun.sent, 1);
  assert.equal(starvedDb.followUps.find((row) => row.recordId === "record-2")?.status, "SENT");
  assert.equal(starvedDb.followUps.filter((row) => row.status === "QUEUED").length, 0, "no claim is left behind");
  assert.equal(starvedRun.outstanding, 3, "record-1 and record-3 wait for their mailbox, record-2 step 2 follows later");

  // More blocked mailboxes than initial claims: the refill chain continues
  // past each newly blocked mailbox until it reaches the ready recipient.
  const chainDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "alpha@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-3", recipient: "third@example.com", sentAt: new Date(day(-4).getTime() + 60_000), senderEmail: "gamma@example.com", localThreadId: "thread-3", providerThreadId: "provider-thread-3" },
      { recordId: "record-4", recipient: "fourth@example.com", sentAt: new Date(day(-4).getTime() + 120_000), senderEmail: "delta@example.com", localThreadId: "thread-4", providerThreadId: "provider-thread-4" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: new Date(day(-4).getTime() + 180_000), senderEmail: "beta@example.com", localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    emailAccounts: [
      { id: "account-alpha", email: "alpha@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
      { id: "account-gamma", email: "gamma@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: day(-1) },
      { id: "account-delta", email: "delta@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
      { id: "account-beta", email: "beta@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
    ],
    now,
  });
  const chainReservations: Array<string | undefined> = [];
  const chainRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    limit: 1,
    campaign: {
      ...campaign,
      senderAccountId: null,
      audiencePersonalization: {
        ...campaign.audiencePersonalization,
        "record-3": { email: "third@example.com", company: "Third Co", country: "FR" },
        "record-4": { email: "fourth@example.com", company: "Fourth Co", country: "IT" },
      },
    },
    db: chainDb as never,
    reserve: async (input: { accountId?: string }) => {
      chainReservations.push(input.accountId);
      if (input.accountId === "account-alpha" || input.accountId === "account-delta") {
        return { error: "mailbox at its daily limit", code: "POOL_EXHAUSTED" as const };
      }
      return { ...reservation, reservationId: "reservation-beta", accountId: "account-beta", senderEmail: "beta@example.com" };
    },
  });
  assert.deepEqual(chainReservations, ["account-alpha", "account-delta", "account-beta"], "the chain skips the paused mailbox and continues past each refusal");
  assert.equal(chainRun.sent, 1);
  assert.equal(chainDb.followUps.find((row) => row.recordId === "record-2")?.status, "SENT");
  assert.equal(chainDb.followUps.filter((row) => row.status === "QUEUED").length, 0);

  // The same with a paused first-touch mailbox: the paused recipient releases
  // its claim without a reservation and the ready recipient behind it sends.
  const pausedFrontDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "alpha@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: new Date(day(-4).getTime() + 60_000), senderEmail: "beta@example.com", localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    emailAccounts: [
      { id: "account-alpha", email: "alpha@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: day(-1) },
      { id: "account-beta", email: "beta@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
    ],
    now,
  });
  const pausedFrontReservations: Array<string | undefined> = [];
  const pausedFrontRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    limit: 1,
    campaign: { ...campaign, senderAccountId: null },
    db: pausedFrontDb as never,
    reserve: async (input: { accountId?: string }) => {
      pausedFrontReservations.push(input.accountId);
      return { ...reservation, reservationId: "reservation-beta", accountId: "account-beta", senderEmail: "beta@example.com" };
    },
  });
  assert.deepEqual(pausedFrontReservations, ["account-beta"]);
  assert.equal(pausedFrontRun.sent, 1);
  assert.equal(pausedFrontDb.followUps.find((row) => row.recordId === "record-2")?.status, "SENT");
  assert.equal(pausedFrontDb.followUps.find((row) => row.recordId === "record-1"), undefined);

  // A first-touch mailbox that is gone (row deleted or credentials removed) or
  // that an operator disabled for sending cannot continue the thread: the step
  // settles as REJECTED instead of being reclaimed forever. A mailbox paused by
  // sender protection is resumed by an operator, so its step waits without a
  // reservation attempt.
  const unusableDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "gone@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-4), senderEmail: "disconnected@example.com", localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
      { recordId: "record-3", recipient: "third@example.com", sentAt: day(-4), senderEmail: "disabled@example.com", localThreadId: "thread-3", providerThreadId: "provider-thread-3" },
      { recordId: "record-4", recipient: "fourth@example.com", sentAt: day(-4), senderEmail: "paused@example.com", localThreadId: "thread-4", providerThreadId: "provider-thread-4" },
    ],
    emailAccounts: [
      { id: "account-disconnected", email: "disconnected@example.com", officeId: "office-1", connected: false, sendEnabled: true, sendPausedAt: null },
      { id: "account-disabled", email: "disabled@example.com", officeId: "office-1", connected: true, sendEnabled: false, sendPausedAt: null },
      { id: "account-paused", email: "paused@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: day(-1) },
    ],
    now,
  });
  let unusableReserveCalls = 0;
  const unusableRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    campaign: {
      ...campaign,
      senderAccountId: null,
      audiencePersonalization: {
        ...campaign.audiencePersonalization,
        "record-3": { email: "third@example.com", company: "Third Co", country: "FR" },
        "record-4": { email: "fourth@example.com", company: "Fourth Co", country: "ES" },
      },
    },
    db: unusableDb as never,
    reserve: async () => {
      unusableReserveCalls += 1;
      return reservation;
    },
  });
  assert.equal(unusableReserveCalls, 0);
  assert.equal(unusableRun.rejected, 3);
  assert.equal(unusableRun.poolExhausted, false);
  for (const recordId of ["record-1", "record-2", "record-3"]) {
    assert.equal(unusableDb.followUps.find((row) => row.recordId === recordId)?.status, "REJECTED", `${recordId} settles durably`);
  }
  assert.equal(unusableDb.followUps.find((row) => row.recordId === "record-4"), undefined, "the paused mailbox's claim is released for the next run");
  assert.equal(unusableRun.outcomes.find((outcome) => outcome.recordId === "record-4")?.state, "POOL_EXHAUSTED");
  assert.equal(unusableRun.outstanding, 1, "only the paused recipient is still due");

  // The same address connected twice, once disabled and once paused: the
  // resumable row wins whatever order the rows come back in, so the step waits
  // instead of settling as REJECTED.
  const disabledRow = { id: "account-dup-disabled", email: "dup@example.com", officeId: "office-1", connected: true, sendEnabled: false, sendPausedAt: null };
  const pausedRow = { id: "account-dup-paused", email: "dup@example.com", officeId: "office-2", connected: true, sendEnabled: true, sendPausedAt: day(-1) };
  for (const emailAccounts of [[disabledRow, pausedRow], [pausedRow, disabledRow]]) {
    const duplicateDb = fakeDatabase({
      sends: [
        { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "dup@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      ],
      emailAccounts,
      now,
    });
    let duplicateReserveCalls = 0;
    const duplicateRun = await runOutreachCampaignFollowUps({
      ...baseInput,
      campaign: { ...campaign, senderAccountId: null },
      db: duplicateDb as never,
      reserve: async () => {
        duplicateReserveCalls += 1;
        return reservation;
      },
    });
    const order = emailAccounts.map((row) => row.id).join(",");
    assert.equal(duplicateReserveCalls, 0, order);
    assert.equal(duplicateRun.rejected, 0, `${order}: the paused duplicate outranks the disabled one`);
    assert.equal(duplicateDb.followUps.find((row) => row.recordId === "record-1"), undefined, `${order}: the claim is released for the next run`);
    assert.equal(duplicateRun.outcomes.find((outcome) => outcome.recordId === "record-1")?.state, "POOL_EXHAUSTED", order);
  }

  // A mailbox paused by sender protection after the reservation but before the
  // provider call: the follow-up must keep the recipient's thread, so it is not
  // rerouted to another mailbox. The claim is released and waits for the resume,
  // and the recipient behind it on another mailbox still sends.
  const pausedLateDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "alpha@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-4), senderEmail: "beta@example.com", localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    emailAccounts: [
      { id: "account-alpha", email: "alpha@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
      { id: "account-beta", email: "beta@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: null },
    ],
    now,
  });
  const pausedLateReservations: Array<string | undefined> = [];
  let pausedLateReleases = 0;
  const pausedLateRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    limit: 1,
    campaign: { ...campaign, senderAccountId: null },
    db: pausedLateDb as never,
    provider: {
      ...provider,
      send: async (input: Record<string, unknown>) => (input.accountId === "account-alpha"
        ? { state: "REJECTED" as const, error: SENDER_PAUSED_ERROR }
        : provider.send(input)),
    },
    reserve: async (input: { accountId?: string }) => {
      pausedLateReservations.push(input.accountId);
      return { ...reservation, reservationId: `reservation-${input.accountId}`, accountId: input.accountId ?? "", senderEmail: `${input.accountId?.replace("account-", "")}@example.com` };
    },
    release: async () => { pausedLateReleases += 1; },
  });
  assert.deepEqual(pausedLateReservations, ["account-alpha", "account-beta"], "the paused first-touch mailbox is never swapped for another one");
  assert.equal(pausedLateReleases, 1);
  assert.equal(pausedLateRun.rejected, 0, "a pause after reservation is not a durable rejection");
  assert.equal(pausedLateRun.sent, 1);
  assert.equal(pausedLateDb.followUps.find((row) => row.recordId === "record-1"), undefined, "the paused recipient's claim is released for the next run");
  assert.equal(pausedLateDb.followUps.find((row) => row.recordId === "record-2")?.status, "SENT");
  assert.equal(pausedLateRun.outcomes.find((outcome) => outcome.recordId === "record-1")?.state, "POOL_EXHAUSTED");
  assert.equal(pausedLateRun.outstanding, 2, "the deferred follow-up is still due alongside the sent recipient's next step");

  // A pinned campaign has no other mailbox to wait on, so the run stops and
  // every remaining claim goes back for the next run.
  const pausedPinnedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
      { recordId: "record-2", recipient: "other@example.com", sentAt: day(-4), localThreadId: "thread-2", providerThreadId: "provider-thread-2" },
    ],
    now,
  });
  let pausedPinnedSends = 0;
  const pausedPinnedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    db: pausedPinnedDb as never,
    provider: {
      ...provider,
      send: async () => {
        pausedPinnedSends += 1;
        return { state: "REJECTED" as const, error: SENDER_PAUSED_ERROR };
      },
    },
  });
  assert.equal(pausedPinnedSends, 1, "the run stops at the first paused refusal");
  assert.equal(pausedPinnedRun.poolExhausted, true);
  assert.equal(pausedPinnedRun.rejected, 0);
  assert.equal(pausedPinnedDb.followUps.filter((row) => row.status === "QUEUED").length, 0, "both claims are released");
  assert.equal(pausedPinnedRun.outstanding, 2);

  // A reply that landed while the mailbox was paused ends the sequence instead
  // of leaving the step waiting for the resume.
  const pausedRepliedDb = fakeDatabase({
    sends: [
      { recordId: "record-1", recipient: "buyer@example.com", sentAt: day(-4), senderEmail: "paused@example.com", localThreadId: "thread-1", providerThreadId: "provider-thread-1" },
    ],
    emailAccounts: [
      { id: "account-paused", email: "paused@example.com", officeId: "office-1", connected: true, sendEnabled: true, sendPausedAt: day(-1) },
    ],
    now,
  });
  const pausedRepliedRun = await runOutreachCampaignFollowUps({
    ...baseInput,
    campaign: { ...campaign, senderAccountId: null },
    db: pausedRepliedDb as never,
    reserve: async () => {
      // The planning snapshot did not see the reply; it arrives before the claim is handled.
      throw new Error("a paused mailbox must not reserve");
    },
    provider: {
      ...provider,
      send: async () => { throw new Error("a paused mailbox must not send"); },
    },
  });
  assert.equal(pausedRepliedRun.outcomes.find((outcome) => outcome.recordId === "record-1")?.state, "POOL_EXHAUSTED", "without a reply the step waits");
  pausedRepliedDb.repliedThreads.add("thread-1");
  const pausedRepliedRerun = await runOutreachCampaignFollowUps({
    ...baseInput,
    campaign: { ...campaign, senderAccountId: null },
    db: pausedRepliedDb as never,
    reserve: async () => { throw new Error("a replied thread must not reserve"); },
    provider: {
      ...provider,
      send: async () => { throw new Error("a replied thread must not send"); },
    },
  });
  assert.equal(pausedRepliedRerun.skipped, 1);
  assert.equal(pausedRepliedRerun.outstanding, 0, "a human reply ends the sequence; nothing is rerouted");
  console.log("Outreach campaign follow-up checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
