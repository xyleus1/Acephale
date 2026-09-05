import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import type { LiveRecipientCheck } from "../src/lib/outreach-recipient-quality";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test?sslmode=require";

async function main() {
  const {
    outreachCampaignBatchLimit,
    outreachCampaignClaimLimit,
    outreachCampaignReclaimBefore,
    outreachCampaignDeliveryOutcome,
    outreachCampaignIdempotencyKey,
    outreachCampaignRequestHash,
    outreachCampaignReservationOutcome,
    outreachCampaignRfcMessageId,
    selectOutreachCampaignRows,
    selectOutreachCampaignSnapshotRows,
    outreachCampaignStatusAllowsSend,
    outreachCampaignRunNowLimitValid,
    outreachCampaignUtcDayBounds,
    outreachCampaignPausedSenderAction,
    runOutreachCampaignBatch,
  } = await import("../src/lib/outreach-campaign-send");
  const { SENDER_PAUSED_ERROR } = await import("../src/lib/supply-os/supplier-email-provider");
  const { renderCampaignEmail, selectCampaignVariant } = await import("../src/lib/outreach-campaign-copy");
  const { RECIPIENT_QUALITY_SUPPRESSION_SOURCE } = await import("../src/lib/outreach-campaign-send");
  const offlineRecipientCheck: LiveRecipientCheck = {
    verifier: null,
    resolveMx: async () => [{ exchange: "mx.buyerco.com", priority: 10 }],
  };
  const rows = [
    { id: "late", status: "new", data: { email: "late@buyerco.com" }, createdAt: new Date("2026-01-02") },
    { id: "early", status: "new", data: { email: "early@buyerco.com" }, createdAt: new Date("2026-01-01") },
    { id: "bad", status: "rejected", data: { email: "bad@buyerco.com" }, createdAt: new Date("2026-01-01") },
  ];
  assert.equal(outreachCampaignBatchLimit(undefined, 40, 12), 28);
  assert.equal(outreachCampaignBatchLimit(5, 40, 12), 5);
  assert.equal(outreachCampaignBatchLimit(50, 40, 40), 0);
  assert.deepEqual(selectOutreachCampaignRows({
    rows,
    sentRecordIds: new Set(["late", "bad"]),
    audienceRecordIds: new Set(["early", "bad"]),
    statuses: ["new"],
    emailField: "email",
    limit: 10,
  }).map((row) => row.id), ["early"]);
const pinnedRows = selectOutreachCampaignSnapshotRows({
    rows: [{
      id: "record-1",
      status: "new",
      data: { email: "changed@buyerco.com", company: "Changed Co", country: "FR" },
      createdAt: new Date("2026-01-01"),
    }, {
      id: "record-2",
      status: "new",
      data: { email: "other@buyerco.com" },
      createdAt: new Date("2026-01-02"),
    }],
    audienceRecordIds: ["record-1", "missing", "record-2"],
    audiencePersonalization: {
      "record-1": { email: "pinned@buyerco.com", company: "Pinned Co", country: "GB" },
      "record-2": { email: "other-pinned@buyerco.com", company: null, country: null },
    },
    statuses: ["new"],
    emailField: "email",
    limit: 10,
  });
  assert.deepEqual(pinnedRows.map((row) => row.data), [{
    email: "pinned@buyerco.com",
    company: "Pinned Co",
    country: "GB",
  }, {
    email: "other-pinned@buyerco.com",
    company: null,
    country: null,
  }]);
  assert.deepEqual(renderCampaignEmail({
    subject: "Hello {{company}}",
    bodyTemplate: "We serve {{country}}. Reply STOP to opt out.",
    row: { data: pinnedRows[0].data },
  }), {
    subject: "Hello Pinned Co",
    body: "We serve GB. Reply STOP to opt out.",
  });
  assert.deepEqual(selectOutreachCampaignSnapshotRows({
    rows: [{
      id: "record-1",
      status: "new",
      data: { email: "changed@buyerco.com" },
      createdAt: new Date("2026-01-01"),
    }, {
      id: "record-2",
      status: "rejected",
      data: { email: "rejected@buyerco.com" },
      createdAt: new Date("2026-01-02"),
    }],
    audienceRecordIds: ["record-1", "record-2"],
    audiencePersonalization: {
      "record-1": { email: "pinned@buyerco.com", company: null, country: null },
      "record-2": { email: "rejected-pinned@buyerco.com", company: null, country: null },
    },
    statuses: ["new"],
    emailField: "email",
    limit: 10,
  }).map((row) => row.id), ["record-1"]);
  assert.equal(outreachCampaignClaimLimit(10, 40, 12, 8), 10);
  assert.equal(outreachCampaignClaimLimit(50, 40, 35, 5), 0);
  assert.equal(outreachCampaignReclaimBefore(new Date("2026-01-01T12:30:00Z")).toISOString(), "2026-01-01T12:00:00.000Z");
  assert.equal(outreachCampaignStatusAllowsSend("ACTIVE"), true);
  assert.equal(outreachCampaignStatusAllowsSend("PAUSED"), false);
  for (const invalid of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(outreachCampaignRunNowLimitValid(invalid, 5), false);
  }
  assert.equal(outreachCampaignRunNowLimitValid(5, 5), true);
  const utcBounds = outreachCampaignUtcDayBounds(new Date("2026-01-02T01:00:00-08:00"));
  assert.equal(utcBounds.start.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.equal(utcBounds.end.toISOString(), "2026-01-03T00:00:00.000Z");
  assert.equal(outreachCampaignIdempotencyKey("campaign-1", "record-1"), "outreach-campaign:campaign-1:record-1");
  const hash = outreachCampaignRequestHash({
    campaignId: "campaign-1",
    recordId: "record-1",
    recipient: "early@buyerco.com",
    subject: "Hello",
    body: "Reply STOP to opt out.",
  });
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(outreachCampaignRfcMessageId("123456789/unsafe", "record/1"), "<outreach-12345678-record-1@derya.ai>");
  assert.deepEqual(outreachCampaignDeliveryOutcome({
    state: "SENT",
    provider: "GMAIL",
    providerMessageId: "message",
    providerThreadId: "thread",
    sourceUrl: "https://mail.google.com",
  }), { state: "SENT", releaseReservation: false });
  assert.deepEqual(outreachCampaignDeliveryOutcome({ state: "REJECTED", error: "rejected" }), {
    state: "REJECTED",
    releaseReservation: true,
    error: "rejected",
  });
  assert.deepEqual(outreachCampaignDeliveryOutcome({ state: "UNKNOWN", error: "uncertain" }), {
    state: "UNKNOWN",
    releaseReservation: false,
    error: "uncertain",
  });
  assert.deepEqual(outreachCampaignReservationOutcome("POOL_EXHAUSTED"), {
    state: "POOL_EXHAUSTED",
    poolExhausted: true,
  });
  assert.deepEqual(outreachCampaignReservationOutcome("POOL_EMPTY"), {
    state: "POOL_EXHAUSTED",
    poolExhausted: true,
  });

  function fakeDatabase(
    campaignOverrides: Record<string, unknown> = {},
    suppressions: Array<{ officeId: string; email: string; reason: string }> = [],
  ) {
    const send = {
      count: async () => 0,
      findMany: async () => [],
      deleteMany: async () => undefined,
      createMany: async () => undefined,
      updateMany: async () => ({ count: 1 }),
      upsert: async () => undefined,
    };
    const db = {
      emailSuppression: {
        findMany: async (args: { where: { officeId: string; email: { in: string[] } } }) => suppressions
          .filter((row) => row.officeId === args.where.officeId && args.where.email.in.includes(row.email))
          .map((row) => ({ email: row.email, reason: row.reason })),
      },
      outreachCampaign: {
        findFirst: async () => ({
          id: "campaign-1",
          officeId: "office-1",
          status: "ACTIVE",
          subject: "Hello {{company}}",
          bodyTemplate: "Reply STOP to opt out.",
          emailField: "email",
          countryField: null,
          companyField: "company",
          rowStatuses: ["new"],
          filters: null,
          senderAccountId: "account-1",
          senderDisplayName: "Wens",
          dailyCap: 5,
          listId: "list-1",
          audienceRecordIds: ["record-1"],
          audiencePersonalization: {
            "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
          },
          ...campaignOverrides,
        }),
        updateMany: async () => undefined,
      },
      outreachCampaignSend: send,
      outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
      emailSenderReservation: { findUnique: async () => null },
      researchRecord: {
        findMany: async () => [{
          id: "record-1",
          status: "new",
          data: { email: "buyer@buyerco.com", company: "Buyer Co" },
          createdAt: new Date("2026-01-01"),
        }],
      },
      $transaction: async (callback: (tx: {
        $queryRaw: () => Promise<Array<{ locked: number }>>;
        emailMessage: { findFirst: () => Promise<null>; create: () => Promise<{ id: string }> };
        emailThread: { create: () => Promise<{ id: string }> };
        emailSenderReservation: { updateMany: () => Promise<void> };
        outreachCampaignSend: {
          upsert: () => Promise<void>;
          deleteMany: () => Promise<void>;
          findMany: () => Promise<never[]>;
          count: () => Promise<number>;
          createMany: () => Promise<void>;
          updateMany: () => Promise<void>;
        };
        outreachCampaignFollowUp: { count: () => Promise<number>; findMany: () => Promise<never[]> };
        outreachCampaign: { updateMany: () => Promise<void> };
      }) => Promise<unknown>) => callback({
        $queryRaw: async () => [{ locked: 1 }],
        emailMessage: {
          findFirst: async () => null,
          create: async () => ({ id: "message-1" }),
        },
        emailThread: { create: async () => ({ id: "thread-1" }) },
        emailSenderReservation: { updateMany: async () => undefined },
        outreachCampaignSend: {
          upsert: async () => undefined,
          deleteMany: async () => undefined,
          findMany: async () => [],
          count: async () => 0,
          createMany: async () => undefined,
          updateMany: async () => undefined,
        },
        outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
        outreachCampaign: { updateMany: async () => undefined },
      }),
    };
    return db;
  }

  // One first touch plus one due follow-up share the per-run limit.
  function budgetDatabase(now: Date) {
    const followUpRows: Array<Record<string, unknown>> = [];
    const followUpModel = {
      findMany: async (args: { where?: { status?: string } }) => followUpRows.filter((row) => !args.where?.status || row.status === args.where.status),
      count: async (args: { where?: { status?: string } }) => followUpRows.filter((row) => row.status === args.where?.status).length,
      deleteMany: async () => ({ count: 0 }),
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        followUpRows.push(...args.data.map((row) => ({ ...row, createdAt: now })));
        return { count: args.data.length };
      },
      updateMany: async (args: { data: Record<string, unknown> }) => {
        for (const row of followUpRows) Object.assign(row, args.data);
        return { count: followUpRows.length };
      },
    };
    const sendModel = {
      count: async () => 0,
      findMany: async (args: { where?: { status?: string } }) => (args.where?.status === "SENT"
        ? [{ recordId: "record-2", recipient: "other@buyerco.com", sentAt: new Date(now.getTime() - 3 * 86_400_000), localThreadId: "thread-2", providerThreadId: "provider-thread-2" }]
        : []),
      deleteMany: async () => undefined,
      createMany: async () => undefined,
      updateMany: async () => undefined,
      upsert: async () => undefined,
    };
    const base = fakeDatabase({
      audienceRecordIds: ["record-1", "record-2"],
      audiencePersonalization: {
        "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
        "record-2": { email: "other@buyerco.com", company: "Other Co", country: null },
      },
      followUps: [{ waitDays: 3, subject: null, body: "Still interested, {{company}}? Reply STOP to opt out." }],
    });
    const tx = {
      $queryRaw: async () => [{ locked: 1 }],
      emailMessage: { findFirst: async () => null, create: async () => ({ id: "message-1" }) },
      emailThread: { create: async () => ({ id: "thread-1" }), updateMany: async () => ({ count: 1 }) },
      emailSenderReservation: { updateMany: async () => undefined },
      outreachCampaignSend: sendModel,
      outreachCampaignFollowUp: followUpModel,
      outreachCampaign: { updateMany: async () => undefined },
    };
    return {
      ...base,
      followUpRows,
      outreachCampaignSend: sendModel,
      outreachCampaignFollowUp: followUpModel,
      emailMessage: { groupBy: async () => [], findFirst: async () => null, create: async () => ({ id: "message-1" }) },
      emailThread: { create: async () => ({ id: "thread-1" }), updateMany: async () => ({ count: 1 }) },
      emailSenderReservation: { findUnique: async () => null, updateMany: async () => undefined },
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    };
  }

  const reservation = {
    ok: true as const,
    reservationId: "reservation-1",
    accountId: "account-1",
    senderEmail: "sender@buyerco.com",
    dailySendLimit: 30,
    sentToday: 0,
    reservedToday: 1,
    completed: false,
    providerMessageId: null,
    providerThreadId: null,
    localThreadId: null,
    sentAt: null,
  };
  let sentProviderInput: Record<string, unknown> | undefined;
  const provider = {
    send: async (input: Record<string, unknown>) => {
      sentProviderInput = input;
      return {
        state: "SENT" as const,
        provider: "GMAIL" as const,
        providerMessageId: "provider-message",
        providerThreadId: "provider-thread",
        sourceUrl: "https://mail.google.com",
      };
    },
    reconcile: async () => ({ state: "UNKNOWN" as const, error: "unused" }),
  };
  const noSenderDb = fakeDatabase({
    senderAccountId: null,
    dailyCap: 5,
    audienceRecordIds: ["record-1"],
    audiencePersonalization: {
      "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
    },
  });
  const noSenderRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: noSenderDb,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(noSenderRun.blocked, "NO_SENDER");
  let completionCalled = false;
  const noAudienceRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: fakeDatabase({ audienceRecordIds: [], audiencePersonalization: {} }) as never,
    complete: async () => {
      completionCalled = true;
      return { completed: false };
    },
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(noAudienceRun.blocked, "NO_AUDIENCE");
  assert.equal(completionCalled, false);
  const sentRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: fakeDatabase() as never,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(sentRun.sent, 1);
  assert.equal(sentRun.pruned, 0);
  assert.equal(sentProviderInput?.senderDisplayName, "Wens");

  // A provider that accepts the message but whose receipt cannot be recorded
  // (here: the same native message id handed out twice, tripping the
  // reservation's unique message link) settles that one row as UNKNOWN with
  // its reservation kept for reconciliation; the batch carries on.
  const recordedMessageIds = new Map<string, string>();
  const recordingOutcomes: Array<Record<string, unknown>> = [];
  const recordingReleases: string[] = [];
  const recordingDb = fakeDatabase({
    audienceRecordIds: ["record-1", "record-2"],
    audiencePersonalization: {
      "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
      "record-2": { email: "other@otherco.com", company: "Other Co", country: null },
    },
  });
  recordingDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-2", status: "new", data: { email: "other@otherco.com", company: "Other Co" }, createdAt: new Date("2026-01-02") },
  ];
  recordingDb.outreachCampaignSend.updateMany = (async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (args.data.status) recordingOutcomes.push({ ...args.where, ...args.data });
    return { count: 1 };
  }) as () => Promise<{ count: number }>;
  recordingDb.$transaction = async (callback) => callback({
    $queryRaw: async () => [{ locked: 1 }],
    emailMessage: { findFirst: async () => null, create: async () => ({ id: "message-1" }) },
    emailThread: { create: async () => ({ id: "thread-1" }) },
    emailSenderReservation: {
      updateMany: (async (args: { where: { id: string }; data: { messageId: string } }) => {
        const owner = recordedMessageIds.get(args.data.messageId);
        if (owner && owner !== args.where.id) {
          throw new Error("Unique constraint failed on the fields: (`messageId`,`accountId`,`officeId`)");
        }
        recordedMessageIds.set(args.data.messageId, args.where.id);
      }) as () => Promise<void>,
    },
    outreachCampaignSend: {
      upsert: (async (args: { create: Record<string, unknown> }) => { recordingOutcomes.push(args.create); }) as () => Promise<void>,
      deleteMany: async () => undefined,
      findMany: async () => [],
      count: async () => 0,
      createMany: async () => undefined,
      updateMany: async () => undefined,
    },
    outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
    outreachCampaign: { updateMany: async () => undefined },
  });
  let recordingReservations = 0;
  const recordingRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: recordingDb as never,
    provider,
    reserve: async () => {
      recordingReservations += 1;
      return { ...reservation, reservationId: `reservation-${recordingReservations}` };
    },
    release: async (args) => {
      recordingReleases.push(args.reservationId);
      return { ok: true, released: true } as never;
    },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(recordingRun.attempted, 2, "the batch continues past the row whose receipt could not be recorded");
  assert.equal(recordingRun.sent, 1);
  assert.equal(recordingRun.unknown, 1);
  assert.deepEqual(
    recordingRun.outcomes.map((outcome) => [outcome.recordId, outcome.state]),
    [["record-1", "SENT"], ["record-2", "UNKNOWN"]],
  );
  assert.match(recordingRun.outcomes[1].error ?? "", /could not be recorded/);
  assert.deepEqual(recordingReleases, [], "a delivered message keeps its reservation for reconciliation");
  const unknownLedger = recordingOutcomes.find((row) => row.recordId === "record-2");
  assert.equal(unknownLedger?.status, "UNKNOWN");
  assert.equal(unknownLedger?.reservationId, "reservation-2");
  assert.equal(unknownLedger?.senderEmail, "sender@buyerco.com");

  // An ambiguous commit: the recording transaction writes SENT and settles
  // the reservation, then the call still throws (lost response, post-commit
  // side effect). The committed row must not be downgraded to UNKNOWN, which
  // would leave it unreconcilable behind a RECORDED reservation. The UNKNOWN
  // write is conditional on the row not being SENT, so it touches nothing.
  const ambiguousLedger: Array<Record<string, unknown>> = [];
  const ambiguousOuterWrites: Array<Record<string, unknown>> = [];
  const ambiguousDb = fakeDatabase();
  ambiguousDb.outreachCampaignSend.upsert = (async (args: { create: Record<string, unknown> }) => {
    ambiguousOuterWrites.push(args.create);
  }) as () => Promise<void>;
  ambiguousDb.outreachCampaignSend.updateMany = (async (args: {
    where: { officeId: string; campaignId: string; recordId: string; status: string | { not: string } };
    data: Record<string, unknown>;
  }) => {
    if (!args.data.status) return { count: 1 };
    assert.deepEqual(args.where.status, { not: "SENT" }, "the UNKNOWN write must be conditional on the row not being SENT");
    if (typeof args.where.status === "string") return { count: 0 };
    const rows = ambiguousLedger.filter((row) =>
      row.officeId === args.where.officeId
      && row.campaignId === args.where.campaignId
      && row.recordId === args.where.recordId
      && row.status !== args.where.status.not);
    for (const row of rows) {
      Object.assign(row, args.data);
      ambiguousOuterWrites.push({ ...row });
    }
    return { count: rows.length };
  }) as () => Promise<{ count: number }>;
  ambiguousDb.$transaction = async (callback) => {
    let recorded = false;
    const result = await callback({
      $queryRaw: async () => [{ locked: 1 }],
      emailMessage: { findFirst: async () => null, create: async () => ({ id: "message-1" }) },
      emailThread: { create: async () => ({ id: "thread-1" }) },
      emailSenderReservation: { updateMany: async () => undefined },
      outreachCampaignSend: {
        upsert: (async (args: { create: Record<string, unknown> }) => {
          ambiguousLedger.push(args.create);
          recorded = true;
        }) as () => Promise<void>,
        deleteMany: async () => undefined,
        findMany: async () => [],
        count: async () => 0,
        createMany: async () => undefined,
        updateMany: async () => undefined,
      },
      outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
      outreachCampaign: { updateMany: async () => undefined },
    });
    if (recorded) throw new Error("connection closed before the commit acknowledgement arrived");
    return result;
  };
  const ambiguousReleases: string[] = [];
  const ambiguousRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: ambiguousDb as never,
    provider,
    reserve: async () => reservation,
    release: async (args) => {
      ambiguousReleases.push(args.reservationId);
      return { ok: true, released: true } as never;
    },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(ambiguousRun.sent, 1, "a committed SENT row is reported as sent");
  assert.equal(ambiguousRun.unknown, 0);
  assert.deepEqual(ambiguousRun.outcomes.map((outcome) => [outcome.recordId, outcome.state, outcome.error]), [["record-1", "SENT", null]]);
  assert.deepEqual(ambiguousOuterWrites, [], "the committed SENT row is not overwritten with UNKNOWN");
  assert.deepEqual(ambiguousReleases, []);

  // A recording that fails before the ledger write (database blip) settles
  // the row as UNKNOWN with the recording error and the batch continues to
  // the next recipient.
  const outageOuterWrites: Array<Record<string, unknown>> = [];
  const outageReleases: string[] = [];
  const outageDb = fakeDatabase({
    audienceRecordIds: ["record-1", "record-2"],
    audiencePersonalization: {
      "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
      "record-2": { email: "other@otherco.com", company: "Other Co", country: null },
    },
  });
  outageDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-2", status: "new", data: { email: "other@otherco.com", company: "Other Co" }, createdAt: new Date("2026-01-02") },
  ];
  outageDb.outreachCampaignSend.updateMany = (async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (args.data.status) outageOuterWrites.push({ ...args.where, ...args.data });
    return { count: 1 };
  }) as () => Promise<{ count: number }>;
  let outageRecordings = 0;
  outageDb.$transaction = async (callback) => callback({
    $queryRaw: async () => [{ locked: 1 }],
    emailMessage: { findFirst: async () => null, create: async () => ({ id: "message-1" }) },
    emailThread: { create: async () => ({ id: "thread-1" }) },
    emailSenderReservation: {
      updateMany: (async () => {
        outageRecordings += 1;
        if (outageRecordings === 1) throw new Error("Can't reach database server");
      }) as () => Promise<void>,
    },
    outreachCampaignSend: {
      upsert: (async (args: { create: Record<string, unknown> }) => { outageOuterWrites.push(args.create); }) as () => Promise<void>,
      deleteMany: async () => undefined,
      findMany: async () => [],
      count: async () => 0,
      createMany: async () => undefined,
      updateMany: async () => undefined,
    },
    outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
    outreachCampaign: { updateMany: async () => undefined },
  });
  let outageReservations = 0;
  const outageRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: outageDb as never,
    provider,
    reserve: async () => {
      outageReservations += 1;
      return { ...reservation, reservationId: `reservation-${outageReservations}` };
    },
    release: async (args) => {
      outageReleases.push(args.reservationId);
      return { ok: true, released: true } as never;
    },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(outageRecordings, 2);
  assert.equal(outageRun.attempted, 2, "a failed recording does not abort the batch");
  assert.equal(outageRun.sent, 1);
  assert.equal(outageRun.unknown, 1);
  assert.deepEqual(outageRun.outcomes.map((outcome) => [outcome.recordId, outcome.state]), [["record-1", "UNKNOWN"], ["record-2", "SENT"]]);
  assert.match(outageRun.outcomes[0].error ?? "", /could not be recorded/);
  assert.deepEqual(outageReleases, [], "the delivered message keeps its reservation for reconciliation");
  const outageLedger = outageOuterWrites.find((row) => row.recordId === "record-1");
  assert.equal(outageLedger?.status, "UNKNOWN");
  assert.equal(outageLedger?.reservationId, "reservation-1");

  // Consecutive runs at dailyCap 1: the delivered-but-unrecorded row's
  // reservation, still RESERVED and taken today, holds the campaign's only
  // slot, so the next run sends nothing. The day a reservation counts against
  // is its usageDate (moved by every reuse), not its first createdAt: a
  // reservation from an earlier day reused today still holds today's slot,
  // one that stayed on the earlier day (or has been settled) does not.
  const capLedger: Array<Record<string, unknown>> = [];
  const capReservationCounts: Array<Record<string, unknown>> = [];
  const capNow = new Date("2026-01-01T12:00:00Z");
  const capProviderCalls: string[] = [];
  const capProvider = {
    ...provider,
    send: async (input: { recipient: string }) => {
      capProviderCalls.push(input.recipient);
      return provider.send(input);
    },
  };
  // `retained` is the RESERVED reservation behind the UNKNOWN rows, or null once settled.
  function capDatabase(capLedger: Array<Record<string, unknown>>, retained: { createdAt: Date; usageDate: Date } | null) {
    const db = fakeDatabase({
      dailyCap: 1,
      audienceRecordIds: ["record-1", "record-2"],
      audiencePersonalization: {
        "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
        "record-2": { email: "other@otherco.com", company: "Other Co", country: null },
      },
    });
    db.researchRecord.findMany = async () => [
      { id: "record-1", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
      { id: "record-2", status: "new", data: { email: "other@otherco.com", company: "Other Co" }, createdAt: new Date("2026-01-02") },
    ];
    const ledgerRows = (args: { where?: { status?: string } }) => capLedger
      .filter((row) => !args.where?.status || row.status === args.where.status)
      .map((row) => ({ ...row, id: `send-${row.recordId}`, updatedAt: capNow }));
    db.outreachCampaignSend.findMany = ledgerRows as () => Promise<never[]>;
    db.outreachCampaignSend.upsert = async (args: { create: Record<string, unknown> }) => {
      capLedger.push(args.create);
    };
    db.outreachCampaignSend.updateMany = (async (args: { where: { recordId: string }; data: Record<string, unknown> }) => {
      if (!args.data.status) return { count: 1 };
      const existing = capLedger.find((row) => row.recordId === args.where.recordId && row.status !== "SENT");
      if (existing) Object.assign(existing, args.data);
      else {
        // The fake's claim createMany is a no-op, so the settled QUEUED row is materialized here.
        const recipient = args.where.recordId === "record-1" ? "buyer@buyerco.com" : "other@otherco.com";
        capLedger.push({ officeId: "office-1", campaignId: "campaign-1", recordId: args.where.recordId, recipient, ...args.data });
      }
      return { count: 1 };
    }) as () => Promise<{ count: number }>;
    const reservationModel = {
      findUnique: async () => null,
      count: async (args: { where: { id: { in: string[] }; status: string; usageDate: Date; createdAt?: unknown } }) => {
        capReservationCounts.push(args.where);
        if (!retained || args.where.status !== "RESERVED") return 0;
        return retained.usageDate.getTime() === args.where.usageDate.getTime() ? args.where.id.in.length : 0;
      },
      updateMany: async () => {
        throw new Error("Unique constraint failed on the fields: (`messageId`,`accountId`,`officeId`)");
      },
    };
    db.emailSenderReservation = reservationModel as typeof db.emailSenderReservation;
    db.$transaction = async (callback) => callback({
      $queryRaw: async () => [{ locked: 1 }],
      emailMessage: { findFirst: async () => null, create: async () => ({ id: "message-1" }) },
      emailThread: { create: async () => ({ id: "thread-1" }) },
      emailSenderReservation: reservationModel,
      outreachCampaignSend: {
        upsert: (async (args: { create: Record<string, unknown> }) => { capLedger.push(args.create); }) as () => Promise<void>,
        deleteMany: async () => undefined,
        findMany: ledgerRows as () => Promise<never[]>,
        count: async () => 0,
        createMany: async () => undefined,
        updateMany: async () => undefined,
      },
      outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
      outreachCampaign: { updateMany: async () => undefined },
    });
    return db;
  }
  const capRun = (db: ReturnType<typeof capDatabase>) => runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: db as never,
    provider: capProvider,
    reserve: async () => ({ ...reservation, reservationId: "reservation-cap" }),
    release: async () => ({ ok: true, released: true } as never),
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: capNow,
  });
  const today = new Date("2026-01-01T00:00:00Z");
  const yesterday = new Date("2025-12-31T00:00:00Z");
  const firstCapRun = await capRun(capDatabase(capLedger, { createdAt: capNow, usageDate: today }));
  assert.equal(firstCapRun.unknown, 1);
  assert.equal(firstCapRun.sent, 0);
  assert.deepEqual(capProviderCalls, ["buyer@buyerco.com"]);
  assert.equal(capLedger.filter((row) => row.status === "UNKNOWN").length, 1);
  const secondCapRun = await capRun(capDatabase(capLedger, { createdAt: capNow, usageDate: today }));
  assert.equal(secondCapRun.attempted, 0, "the unrecorded delivery still holds the only daily slot");
  assert.equal(secondCapRun.blocked, "DAILY_CAP");
  assert.deepEqual(capProviderCalls, ["buyer@buyerco.com"], "no second message goes out while the cap is held");
  assert.ok(capReservationCounts.length > 0);
  for (const where of capReservationCounts) {
    assert.equal(where.status, "RESERVED", "only retained reservations are counted");
    assert.deepEqual(where.usageDate, today, "reservations are matched on the day the sender pool counts them against");
    assert.equal(where.createdAt, undefined, "a reused reservation keeps its first createdAt, so it is not a day filter");
  }
  const reusedCapRun = await capRun(capDatabase([...capLedger], { createdAt: new Date("2025-12-31T12:00:00Z"), usageDate: today }));
  assert.equal(reusedCapRun.attempted, 0, "a reservation first taken yesterday but reused today holds today's slot");
  assert.equal(reusedCapRun.blocked, "DAILY_CAP");
  assert.deepEqual(capProviderCalls, ["buyer@buyerco.com"]);
  const yesterdayCapRun = await capRun(capDatabase([...capLedger], { createdAt: new Date("2025-12-31T12:00:00Z"), usageDate: yesterday }));
  assert.equal(yesterdayCapRun.attempted, 1, "an UNKNOWN row still counted against an earlier day does not hold today's slot");
  assert.deepEqual(capProviderCalls, ["buyer@buyerco.com", "other@otherco.com"]);
  const settledCapRun = await capRun(capDatabase([...capLedger], null));
  assert.equal(settledCapRun.attempted, 1, "an UNKNOWN row whose reservation was settled does not hold today's slot");

  // Pre-send gate: a placeholder, a Null MX domain, and a verifier-undeliverable
  // mailbox are refused before any claim, so with a run limit of one the fourth,
  // clean recipient still goes out. Refusals about the address itself are
  // suppressed office-wide with the gate as source.
  const gateSuppressions: Array<Record<string, unknown>> = [];
  const gateRejections: Array<Record<string, unknown>> = [];
  const gateDb = fakeDatabase({
    dailyCap: 1,
    audienceRecordIds: ["record-placeholder", "record-nullmx", "record-gone", "record-1"],
    audiencePersonalization: {
      "record-placeholder": { email: "someone@example.com", company: "Template Co", country: null },
      "record-nullmx": { email: "buyer@nullmx.com", company: "Null Co", country: null },
      "record-gone": { email: "gone@buyerco.com", company: "Gone Co", country: null },
      "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
    },
  });
  gateDb.researchRecord.findMany = async () => [
    { id: "record-placeholder", status: "new", data: { email: "someone@example.com", company: "Template Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-nullmx", status: "new", data: { email: "buyer@nullmx.com", company: "Null Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-gone", status: "new", data: { email: "gone@buyerco.com", company: "Gone Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-1", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
  ];
  (gateDb.emailSuppression as { upsert?: (args: Record<string, unknown>) => Promise<unknown> }).upsert = async (args) => {
    gateSuppressions.push(args);
    return null;
  };
  gateDb.outreachCampaignSend.createMany = async (args: { data: Array<Record<string, unknown>> }) => {
    gateRejections.push(...args.data);
  };
  const verifierCalls: string[] = [];
  const gateRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: gateDb as never,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    limit: 1,
    recipientCheck: {
      resolveMx: async (domain) => (domain === "nullmx.com" ? [{ exchange: ".", priority: 0 }] : [{ exchange: "mx.buyerco.com", priority: 10 }]),
      verifier: {
        name: "fake",
        async verify(email) {
          verifierCalls.push(email);
          return {
            provider: "fake",
            status: email.startsWith("gone@") ? "undeliverable" : "deliverable",
            reason: "fixture",
            score: null,
            acceptAll: null,
            disposable: null,
            free: null,
            role: null,
            disabled: null,
            fullMailbox: null,
            checkedAt: new Date(0).toISOString(),
          };
        },
        usage: () => ({ provider: "fake", calls: verifierCalls.length, cached: 0, failures: 0, exhausted: false }),
      },
    },
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(gateRun.sent, 1, "the clean recipient fills the single slot");
  assert.equal(gateRun.pruned, 3);
  assert.equal(gateRun.rejected, 3);
  assert.equal(gateRun.verificationChecks, 2, "placeholder and Null MX rows never reach the paid verifier");
  assert.deepEqual(verifierCalls, ["gone@buyerco.com", "buyer@buyerco.com"]);
  assert.equal(sentProviderInput?.recipient, "buyer@buyerco.com");
  const rejectedLedger = gateRejections.filter((row) => row.status === "REJECTED").map((row) => [row.recipient, row.error]);
  assert.deepEqual(rejectedLedger, [
    ["someone@example.com", "Recipient skipped: placeholder or template address (placeholder address)."],
    ["buyer@nullmx.com", "Recipient skipped: domain accepts no mail (nullmx.com publishes a Null MX record and does not accept email)."],
    ["gone@buyerco.com", "Recipient skipped: mailbox verified undeliverable (fake: fixture)."],
  ]);
  assert.deepEqual(
    gateSuppressions.map((args) => (args.create as Record<string, unknown>).email),
    ["someone@example.com", "buyer@nullmx.com", "gone@buyerco.com"],
    "permanent refusals are suppressed office-wide",
  );

  // The office-wide suppression is written before the terminal ledger row. If
  // the suppression write fails, no REJECTED row marks the record handled, the
  // run surfaces the failure, and the next run repeats the check so the
  // suppression is retried instead of the address staying eligible elsewhere.
  const failingSuppressionDb = fakeDatabase({
    dailyCap: 1,
    audiencePersonalization: {
      "record-1": { email: "someone@example.com", company: "Template Co", country: null },
    },
  });
  failingSuppressionDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "someone@example.com", company: "Template Co" }, createdAt: new Date("2026-01-01") },
  ];
  (failingSuppressionDb.emailSuppression as { upsert?: (args: Record<string, unknown>) => Promise<unknown> }).upsert = async () => {
    throw new Error("suppression store unavailable");
  };
  const ledgerWritesAfterFailedSuppression: Array<Record<string, unknown>> = [];
  failingSuppressionDb.outreachCampaignSend.createMany = async (args: { data: Array<Record<string, unknown>> }) => {
    ledgerWritesAfterFailedSuppression.push(...args.data);
  };
  await assert.rejects(
    runOutreachCampaignBatch({
      officeId: "office-1",
      campaignId: "campaign-1",
      db: failingSuppressionDb as never,
      provider,
      reserve: async () => reservation,
      complete: async () => ({ completed: false }),
      pauseMs: 0,
      limit: 1,
      recipientCheck: { resolveMx: async () => [{ exchange: "mx.example.com", priority: 10 }] },
      now: new Date("2026-01-01T12:00:00Z"),
    }),
    /suppression store unavailable/,
  );
  assert.deepEqual(
    ledgerWritesAfterFailedSuppression.filter((row) => row.status === "REJECTED"),
    [],
    "a failed suppression must not leave a terminal ledger row behind",
  );

  // A stored verdict belongs to the address the row carried when it was
  // verified. After the row's address is edited past approval, the approved
  // recipient still goes out: a current `undeliverable` for the new mailbox
  // does not block it, and a current `deliverable_likely` does not let it skip
  // its own paid check.
  for (const currentVerdict of ["undeliverable", "deliverable_likely"]) {
    const editedDb = fakeDatabase({
      dailyCap: 1,
      audiencePersonalization: {
        "record-1": { email: "approved@buyerco.com", company: "Buyer Co", country: null },
      },
    });
    editedDb.researchRecord.findMany = async () => [
      { id: "record-1", status: "new", data: { email: "replacement@buyerco.com", company: "Buyer Co", email_verdict: currentVerdict }, createdAt: new Date("2026-01-01") },
    ];
    const editedRejections: Array<Record<string, unknown>> = [];
    editedDb.outreachCampaignSend.createMany = async (args: { data: Array<Record<string, unknown>> }) => {
      editedRejections.push(...args.data);
    };
    const editedVerifierCalls: string[] = [];
    const editedRun = await runOutreachCampaignBatch({
      officeId: "office-1",
      campaignId: "campaign-1",
      db: editedDb as never,
      provider,
      reserve: async () => reservation,
      complete: async () => ({ completed: false }),
      pauseMs: 0,
      limit: 1,
      recipientCheck: {
        resolveMx: async () => [{ exchange: "mx.buyerco.com", priority: 10 }],
        verifier: {
          name: "fake",
          async verify(email) {
            editedVerifierCalls.push(email);
            return {
              provider: "fake",
              status: "deliverable",
              reason: "fixture",
              score: null,
              acceptAll: null,
              disposable: null,
              free: null,
              role: null,
              disabled: null,
              fullMailbox: null,
              checkedAt: new Date(0).toISOString(),
            };
          },
          usage: () => ({ provider: "fake", calls: editedVerifierCalls.length, cached: 0, failures: 0, exhausted: false }),
        },
      },
      now: new Date("2026-01-01T12:00:00Z"),
    });
    assert.equal(editedRun.sent, 1, `current ${currentVerdict} on the replacement address must not decide the approved one`);
    assert.equal(editedRun.pruned, 0, currentVerdict);
    assert.deepEqual(editedRejections.filter((row) => row.status === "REJECTED"), [], currentVerdict);
    assert.equal(sentProviderInput?.recipient, "approved@buyerco.com", currentVerdict);
    assert.deepEqual(editedVerifierCalls, ["approved@buyerco.com"], `${currentVerdict}: the approved address is verified itself`);
  }

  // The same row with an unchanged address keeps its stored verdict: a
  // `deliverable_likely` skips the paid check for the approved recipient.
  const confirmedDb = fakeDatabase({
    dailyCap: 1,
    audiencePersonalization: {
      "record-1": { email: "approved@buyerco.com", company: "Buyer Co", country: null },
    },
  });
  confirmedDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "approved@buyerco.com", company: "Buyer Co", email_verdict: "deliverable_likely" }, createdAt: new Date("2026-01-01") },
  ];
  const confirmedVerifierCalls: string[] = [];
  const confirmedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: confirmedDb as never,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    limit: 1,
    recipientCheck: {
      resolveMx: async () => [{ exchange: "mx.buyerco.com", priority: 10 }],
      verifier: {
        name: "fake",
        async verify(email) {
          confirmedVerifierCalls.push(email);
          throw new Error("must not be called");
        },
        usage: () => ({ provider: "fake", calls: confirmedVerifierCalls.length, cached: 0, failures: 0, exhausted: false }),
      },
    },
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(confirmedRun.sent, 1);
  assert.deepEqual(confirmedVerifierCalls, [], "a matching stored deliverable_likely skips the paid check");

  // A campaign parked at its daily cap must not buy DNS or verifier checks for
  // recipients it cannot claim today, however often the cron retries it.
  const cappedDb = fakeDatabase({
    dailyCap: 2,
    audienceRecordIds: ["record-1", "record-2", "record-3"],
    audiencePersonalization: {
      "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
      "record-2": { email: "ops@buyerco.com", company: "Buyer Co", country: null },
      "record-3": { email: "sales@buyerco.com", company: "Buyer Co", country: null },
    },
  });
  cappedDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-2", status: "new", data: { email: "ops@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-3", status: "new", data: { email: "sales@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
  ];
  const cappedLookups: string[] = [];
  const cappedCheck: LiveRecipientCheck = {
    resolveMx: async (domain) => {
      cappedLookups.push(`mx:${domain}`);
      return [{ exchange: "mx.buyerco.com", priority: 10 }];
    },
    verifier: {
      name: "fake",
      async verify(email) {
        cappedLookups.push(`verify:${email}`);
        return {
          provider: "fake",
          status: "deliverable",
          reason: "fixture",
          score: null,
          acceptAll: null,
          disposable: null,
          free: null,
          role: null,
          disabled: null,
          fullMailbox: null,
          checkedAt: new Date(0).toISOString(),
        };
      },
      usage: () => ({ provider: "fake", calls: 0, cached: 0, failures: 0, exhausted: false }),
    },
  };
  let cappedSentToday = 2;
  (cappedDb.outreachCampaignSend as { count: (args: { where?: { status?: string } }) => Promise<number> }).count =
    async (args) => (args.where?.status === "SENT" ? cappedSentToday : 0);
  let cappedProviderCalls = 0;
  const cappedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: cappedDb as never,
    provider: { ...provider, send: async (input: Record<string, unknown>) => { cappedProviderCalls += 1; return provider.send(input); } },
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: cappedCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(cappedRun.sent, 0);
  assert.equal(cappedRun.verificationChecks, 0, "no paid check when no daily capacity remains");
  assert.deepEqual(cappedLookups, [], "no DNS or verifier lookups when no daily capacity remains");
  assert.equal(cappedProviderCalls, 0);
  // With one slot left, verification is bounded by that slot rather than the
  // whole audience: at most the claimable count of rows is checked.
  cappedSentToday = 1;
  const oneSlotRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: cappedDb as never,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: cappedCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(oneSlotRun.sent, 1);
  assert.equal(oneSlotRun.verificationChecks, 1, "verification stops at the claimable capacity");
  assert.deepEqual(cappedLookups, ["mx:buyerco.com", "verify:buyer@buyerco.com"]);
  assert.deepEqual(
    gateSuppressions.map((args) => {
      const create = args.create as Record<string, unknown>;
      return [create.officeId, create.email, create.reason, create.source];
    }),
    [
      ["office-1", "someone@example.com", "UNDELIVERABLE", RECIPIENT_QUALITY_SUPPRESSION_SOURCE],
      ["office-1", "buyer@nullmx.com", "UNDELIVERABLE", RECIPIENT_QUALITY_SUPPRESSION_SOURCE],
      ["office-1", "gone@buyerco.com", "UNDELIVERABLE", RECIPIENT_QUALITY_SUPPRESSION_SOURCE],
    ],
    "permanent refusals are suppressed for the office, scoped by officeId",
  );
  assert.deepEqual(
    gateRun.outcomes.map((outcome) => [outcome.recipient, outcome.state]),
    [
      ["someone@example.com", "REJECTED"],
      ["buyer@nullmx.com", "REJECTED"],
      ["gone@buyerco.com", "REJECTED"],
      ["buyer@buyerco.com", "SENT"],
    ],
  );

  let reservationMarkerInput: { where?: Record<string, unknown>; data?: Record<string, unknown> } | undefined;
  const reservationMarkerDb = fakeDatabase() as unknown as {
    outreachCampaignSend: {
      updateMany: (input: typeof reservationMarkerInput) => Promise<void>;
    };
  };
  reservationMarkerDb.outreachCampaignSend.updateMany = async (input: typeof reservationMarkerInput) => {
    reservationMarkerInput = input;
  };
  await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: reservationMarkerDb as never,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.deepEqual(reservationMarkerInput, {
    where: {
      officeId: "office-1",
      campaignId: "campaign-1",
      recordId: "record-1",
      status: "QUEUED",
    },
    data: { reservationId: "reservation-1" },
  });
  const rotationDb = fakeDatabase({ senderAccountId: null, senderRotation: true }) as never;
  let rotationReservationInput: Record<string, unknown> | undefined;
  const rotationRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: rotationDb,
    provider,
    reserve: async (input) => {
      rotationReservationInput = input as unknown as Record<string, unknown>;
      return reservation;
    },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(rotationRun.sent, 1);
  assert.equal("accountId" in (rotationReservationInput ?? {}), false);

  const serializationError = () => new Prisma.PrismaClientKnownRequestError(
    "serialization conflict",
    { code: "P2034", clientVersion: Prisma.prismaVersion.client },
  );
  type TransactionDb = {
    $transaction: (
      callback: (tx: unknown) => Promise<unknown>,
      options?: unknown,
    ) => Promise<unknown>;
  };
  const retryDb = fakeDatabase() as unknown as TransactionDb;
  const baseTransaction = retryDb.$transaction;
  let retryAttempts = 0;
  retryDb.$transaction = async (callback, options) => {
    retryAttempts += 1;
    if (retryAttempts === 1) throw serializationError();
    return baseTransaction(callback, options);
  };
  const retryRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: retryDb,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(retryAttempts, 3);
  assert.equal(retryRun.sent, 1);
  const serializationExhaustedDb = fakeDatabase() as unknown as TransactionDb;
  let exhaustedAttempts = 0;
  serializationExhaustedDb.$transaction = async () => {
    exhaustedAttempts += 1;
    throw serializationError();
  };
  const serializationExhaustedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: serializationExhaustedDb,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(exhaustedAttempts, 2);
  assert.equal(serializationExhaustedRun.sent, 0);

  async function runWithContactedStatus(status: string) {
    let createdRows = 0;
    const base = fakeDatabase();
    const sendModel = {
      ...base.outreachCampaignSend,
      findMany: async (args: { where?: { campaignId?: { not?: string } } }) => (
        args.where?.campaignId?.not
          ? (status === "REJECTED" ? [] : [{ recipient: " BUYER@buyerco.com " }])
          : []
      ),
      createMany: async (args: { data: unknown[] }) => {
        createdRows = args.data.length;
      },
    };
    const db = {
      ...base,
      outreachCampaignSend: sendModel,
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        $queryRaw: async () => [{ locked: 1 }],
        emailMessage: {
          findFirst: async () => null,
          create: async () => ({ id: "message-1" }),
        },
        emailThread: { create: async () => ({ id: "thread-1" }) },
        emailSenderReservation: { updateMany: async () => undefined },
        outreachCampaignSend: sendModel,
        outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
        outreachCampaign: { updateMany: async () => undefined },
      }),
    };
    const run = await runOutreachCampaignBatch({
      officeId: "office-1",
      campaignId: "campaign-1",
      db: db as never,
      provider,
      reserve: async () => reservation,
      complete: async () => ({ completed: false }),
      pauseMs: 0,
      recipientCheck: offlineRecipientCheck,
    });
    return { run, createdRows };
  }
  const sentElsewhere = await runWithContactedStatus("SENT");
  assert.equal(sentElsewhere.run.sent, 0);
  assert.equal(sentElsewhere.createdRows, 0);
  const rejectedElsewhere = await runWithContactedStatus("REJECTED");
  assert.equal(rejectedElsewhere.run.sent, 1);
  assert.equal(rejectedElsewhere.createdRows, 1);
  const variantCampaign = fakeDatabase({
    variants: [
      { key: "A", subject: "Variant A {{company}}", bodyTemplate: "A body {{company}}. Reply STOP to opt out." },
      { key: "B", subject: "Variant B {{company}}", bodyTemplate: "B body {{company}}. Reply STOP to opt out." },
    ],
  }) as never;
  const variantRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: variantCampaign,
    provider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  const expectedVariant = selectCampaignVariant({
    campaignId: "campaign-1",
    recordId: "record-1",
    variants: [{ key: "A" }, { key: "B" }],
  });
  assert.equal(variantRun.outcomes[0]?.variantKey, expectedVariant?.key);
  assert.equal(sentProviderInput?.subject, `${expectedVariant?.key === "A" ? "Variant A" : "Variant B"} Buyer Co`);
  assert.match(String(sentProviderInput?.body), new RegExp(`${expectedVariant?.key === "A" ? "A" : "B"} body Buyer Co`));

  let released = 0;
  const rejectedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: fakeDatabase() as never,
    provider: {
      ...provider,
      send: async () => ({ state: "REJECTED" as const, error: "rejected" }),
    },
    reserve: async () => reservation,
    release: async () => { released += 1; },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(rejectedRun.rejected, 1);
  assert.equal(released, 1);

  const unknownRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: fakeDatabase() as never,
    provider: {
      ...provider,
      send: async () => ({ state: "UNKNOWN" as const, error: "uncertain" }),
    },
    reserve: async () => reservation,
    release: async () => { released += 1; },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(unknownRun.unknown, 1);
  assert.equal(released, 1);

  const budgetNow = new Date("2026-01-10T12:00:00Z");
  const budgetProviderCalls: string[] = [];
  const budgetProvider = {
    ...provider,
    send: async (input: Record<string, unknown>) => {
      budgetProviderCalls.push(String(input.recipient));
      return provider.send(input);
    },
  };
  const limitedDb = budgetDatabase(budgetNow);
  const limitedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: limitedDb as never,
    provider: budgetProvider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: budgetNow,
    limit: 1,
  });
  assert.equal(limitedRun.sent, 1);
  assert.equal(limitedRun.followUps?.attempted, 0, "follow-ups get no budget after one first touch with limit 1");
  assert.deepEqual(budgetProviderCalls, ["buyer@buyerco.com"]);
  assert.equal(limitedDb.followUpRows.length, 0);
  const unlimitedDb = budgetDatabase(budgetNow);
  const unlimitedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: unlimitedDb as never,
    provider: budgetProvider,
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: budgetNow,
    limit: 2,
  });
  assert.equal(unlimitedRun.sent, 1);
  assert.equal(unlimitedRun.followUps?.sent, 1);
  assert.deepEqual(budgetProviderCalls, ["buyer@buyerco.com", "buyer@buyerco.com", "other@buyerco.com"]);

  // A persisted suppression for this office is recorded as REJECTED before any
  // claim and never reaches the reservation or provider. Another office's
  // suppression of the same address does not block this office.
  const suppressedLedger: Array<Record<string, unknown>> = [];
  const suppressedDb = fakeDatabase(
    {
      audienceRecordIds: ["record-1", "record-2"],
      audiencePersonalization: {
        "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
        "record-2": { email: "other@buyerco.com", company: "Other Co", country: null },
      },
    },
    [
      { officeId: "office-1", email: "buyer@buyerco.com", reason: "BOUNCED" },
      { officeId: "office-2", email: "other@buyerco.com", reason: "COMPLAINED" },
    ],
  );
  suppressedDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-2", status: "new", data: { email: "other@buyerco.com", company: "Other Co" }, createdAt: new Date("2026-01-01") },
  ];
  suppressedDb.outreachCampaignSend.createMany = async (args: { data: Array<Record<string, unknown>> }) => {
    suppressedLedger.push(...args.data);
    return undefined;
  };
  const suppressedProviderCalls: string[] = [];
  let suppressedReserveCalls = 0;
  const suppressedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: suppressedDb as never,
    provider: {
      ...provider,
      send: async (input: Record<string, unknown>) => {
        suppressedProviderCalls.push(String(input.recipient));
        return provider.send(input);
      },
    },
    reserve: async () => {
      suppressedReserveCalls += 1;
      return reservation;
    },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(suppressedRun.rejected, 1);
  assert.equal(suppressedRun.sent, 1);
  assert.deepEqual(suppressedProviderCalls, ["other@buyerco.com"]);
  assert.equal(suppressedReserveCalls, 1, "a suppressed recipient never reserves a sender");
  const suppressedRow = suppressedLedger.find((row) => row.recordId === "record-1");
  assert.equal(suppressedRow?.status, "REJECTED");
  assert.equal(suppressedRow?.error, "Recipient skipped: the address bounced permanently.");
  assert.equal(
    suppressedRun.outcomes.find((outcome) => outcome.recordId === "record-1")?.state,
    "REJECTED",
  );

  // Suppressed audience rows are rejected without taking a slot of the run
  // budget: with a cap of 2 and suppressed rows interleaved, two eligible
  // recipients still go out in the same run.
  const displacedProviderCalls: string[] = [];
  const displacedLedger: Array<Record<string, unknown>> = [];
  const displacedDb = fakeDatabase(
    {
      dailyCap: 2,
      audienceRecordIds: ["record-1", "record-2", "record-3", "record-4"],
      audiencePersonalization: {
        "record-1": { email: "gone@buyerco.com", company: "Gone Co", country: null },
        "record-2": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
        "record-3": { email: "left@buyerco.com", company: "Left Co", country: null },
        "record-4": { email: "other@buyerco.com", company: "Other Co", country: null },
      },
    },
    [
      { officeId: "office-1", email: "gone@buyerco.com", reason: "BOUNCED" },
      { officeId: "office-1", email: "left@buyerco.com", reason: "OPTED_OUT" },
    ],
  );
  displacedDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "gone@buyerco.com", company: "Gone Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-2", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-3", status: "new", data: { email: "left@buyerco.com", company: "Left Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-4", status: "new", data: { email: "other@buyerco.com", company: "Other Co" }, createdAt: new Date("2026-01-01") },
  ];
  displacedDb.outreachCampaignSend.createMany = async (args: { data: Array<Record<string, unknown>> }) => {
    displacedLedger.push(...args.data);
    return undefined;
  };
  const displacedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: displacedDb as never,
    provider: {
      ...provider,
      send: async (input: Record<string, unknown>) => {
        displacedProviderCalls.push(String(input.recipient));
        return provider.send(input);
      },
    },
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(displacedRun.sent, 2, "suppressed rows do not shrink the batch");
  assert.equal(displacedRun.rejected, 2);
  assert.deepEqual(displacedProviderCalls, ["buyer@buyerco.com", "other@buyerco.com"]);
  assert.deepEqual(
    displacedLedger.filter((row) => row.status === "REJECTED").map((row) => row.recordId).sort(),
    ["record-1", "record-3"],
    "every suppressed row the run walked past is recorded as REJECTED",
  );

  // A suppression synced after the pre-batch snapshot (a bounce arriving while
  // earlier rows were being sent) is caught by the per-row recheck: the
  // reservation goes back, the claim becomes REJECTED, and the provider is
  // never called for that recipient.
  const lateSuppressions: Array<{ officeId: string; email: string; reason: string }> = [];
  const lateDb = fakeDatabase(
    {
      audienceRecordIds: ["record-1", "record-2"],
      audiencePersonalization: {
        "record-1": { email: "buyer@buyerco.com", company: "Buyer Co", country: null },
        "record-2": { email: "other@buyerco.com", company: "Other Co", country: null },
      },
    },
    lateSuppressions,
  );
  lateDb.researchRecord.findMany = async () => [
    { id: "record-1", status: "new", data: { email: "buyer@buyerco.com", company: "Buyer Co" }, createdAt: new Date("2026-01-01") },
    { id: "record-2", status: "new", data: { email: "other@buyerco.com", company: "Other Co" }, createdAt: new Date("2026-01-01") },
  ];
  const lateUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  lateDb.outreachCampaignSend.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    lateUpdates.push(args);
    return undefined;
  };
  const lateProviderCalls: string[] = [];
  let lateReleased = 0;
  const lateRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: lateDb as never,
    provider: {
      ...provider,
      send: async (input: Record<string, unknown>) => {
        lateProviderCalls.push(String(input.recipient));
        // The first delivery takes long enough for a bounce report about the
        // second recipient to be synced and suppressed.
        lateSuppressions.push({ officeId: "office-1", email: "other@buyerco.com", reason: "OPTED_OUT" });
        return provider.send(input);
      },
    },
    reserve: async () => reservation,
    release: async () => { lateReleased += 1; },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(lateRun.sent, 1);
  assert.equal(lateRun.rejected, 1);
  assert.deepEqual(lateProviderCalls, ["buyer@buyerco.com"], "a recipient suppressed mid-batch never reaches the provider");
  assert.equal(lateReleased, 1, "the reservation taken for the suppressed recipient is released");
  const lateRejected = lateUpdates.find((update) => update.where.recordId === "record-2" && update.data.status === "REJECTED");
  assert.ok(lateRejected, "the suppressed claim is settled as REJECTED");
  assert.equal(lateRejected.where.status, "QUEUED", "only this run's claim is settled");
  assert.equal(lateRejected.data.error, "Recipient skipped: the recipient asked not to be contacted.");

  const exhaustedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: fakeDatabase() as never,
    provider,
    reserve: async () => ({ error: "pool exhausted", code: "POOL_EXHAUSTED" as const }),
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(exhaustedRun.poolExhausted, true);

  // A non-capacity refusal settles the claimed row instead of leaving it QUEUED
  // to be reclaimed and refused again: DELIVERY_UNCERTAIN with an open
  // reservation is recorded UNKNOWN against that reservation, and a terminal
  // conflict is recorded REJECTED.
  const uncertainBase = fakeDatabase();
  const uncertainUpserts: Array<Record<string, unknown>> = [];
  const uncertainDeletes: unknown[] = [];
  const uncertainDb = {
    ...uncertainBase,
    outreachCampaignSend: {
      ...uncertainBase.outreachCampaignSend,
      upsert: async (args: { create: Record<string, unknown> }) => { uncertainUpserts.push(args.create); },
      deleteMany: async (args: unknown) => { uncertainDeletes.push(args); },
    },
    emailSenderReservation: {
      findUnique: async () => null,
      findFirst: async (args: { where: { officeId: string; idempotencyKey: string; status: string } }) => {
        assert.equal(args.where.officeId, "office-1");
        assert.equal(args.where.idempotencyKey, outreachCampaignIdempotencyKey("campaign-1", "record-1"));
        assert.equal(args.where.status, "RESERVED");
        return { id: "reservation-orphan", account: { email: "sender@buyerco.com" } };
      },
    },
  };
  const uncertainRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: uncertainDb as never,
    provider: { ...provider, send: async () => { throw new Error("an uncertain reservation must not send"); } },
    reserve: async () => ({ error: "delivery outcome unknown", code: "DELIVERY_UNCERTAIN" as const }),
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(uncertainRun.unknown, 1);
  assert.equal(uncertainRun.rejected, 0);
  assert.equal(uncertainRun.poolExhausted, false);
  assert.equal(uncertainDeletes.length, 0, "the claim is settled, not released");
  assert.equal(uncertainUpserts.length, 1);
  assert.equal(uncertainUpserts[0].status, "UNKNOWN");
  assert.equal(uncertainUpserts[0].reservationId, "reservation-orphan");
  assert.equal(uncertainUpserts[0].senderEmail, "sender@buyerco.com");
  assert.equal(uncertainRun.outcomes[0].state, "UNKNOWN");

  const conflictBase = fakeDatabase();
  const conflictUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const conflictDb = {
    ...conflictBase,
    outreachCampaignSend: {
      ...conflictBase.outreachCampaignSend,
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { conflictUpdates.push(args); },
      deleteMany: async () => { throw new Error("a terminal refusal must not release the claim"); },
    },
    emailSenderReservation: {
      findUnique: async () => null,
      findFirst: async () => { throw new Error("a terminal conflict does not look for an open reservation"); },
    },
  };
  const conflictRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: conflictDb as never,
    provider,
    reserve: async () => ({ error: "key used for different content", code: "IDEMPOTENCY_CONFLICT" as const }),
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(conflictRun.rejected, 1);
  assert.equal(conflictRun.unknown, 0);
  const conflictSettled = conflictUpdates.find((update) => update.data.status === "REJECTED");
  assert.equal(conflictSettled?.where.recordId, "record-1");
  assert.equal(conflictSettled?.where.status, "QUEUED", "only this run's claim is settled");
  assert.equal(conflictSettled?.data.error, "key used for different content");

  // Pool exhaustion mid-batch releases every remaining first-touch claim so it
  // does not hold campaign cap capacity for the reclaim window.
  const exhaustedDeletes: Array<{ recordId?: string | { in: string[] }; status?: string }> = [];
  const exhaustedBase = fakeDatabase({
    audienceRecordIds: ["record-1", "record-2", "record-3"],
    audiencePersonalization: Object.fromEntries(["record-1", "record-2", "record-3"].map((id) => [id, {
      email: `${id}@buyerco.com`,
      company: `Company ${id}`,
      country: null,
    }])),
  });
  const exhaustedDb = {
    ...exhaustedBase,
    outreachCampaignSend: {
      ...exhaustedBase.outreachCampaignSend,
      deleteMany: async (args: { where: { recordId?: string | { in: string[] }; status?: string } }) => {
        exhaustedDeletes.push(args.where);
      },
    },
    researchRecord: {
      findMany: async () => ["record-1", "record-2", "record-3"].map((id, index) => ({
        id,
        status: "new",
        data: { email: `${id}@buyerco.com`, company: `Company ${id}` },
        createdAt: new Date(2026, 0, 1 + index),
      })),
    },
  };
  let exhaustedReserves = 0;
  const exhaustedMidBatch = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: exhaustedDb as never,
    provider,
    reserve: async () => {
      exhaustedReserves += 1;
      return exhaustedReserves === 1 ? reservation : { error: "pool exhausted", code: "POOL_EXHAUSTED" as const };
    },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(exhaustedMidBatch.sent, 1);
  assert.equal(exhaustedMidBatch.poolExhausted, true);
  const releasedClaims = exhaustedDeletes.find((where) => typeof where.recordId === "object" && where.status === "QUEUED");
  assert.ok(releasedClaims, "unprocessed claims are deleted when the pool is exhausted");
  assert.deepEqual(
    typeof releasedClaims.recordId === "object" ? releasedClaims.recordId.in : [],
    ["record-2", "record-3"],
    "only the claims this run did not attempt are released",
  );

  // A pause that lands after the batch was claimed releases the remaining
  // claims too, so a resumed campaign (or follow-ups) can use the capacity.
  const pausedDeletes: Array<{ recordId?: string | { in: string[] }; status?: string }> = [];
  let pausedStatusReads = 0;
  const pausedDb = {
    ...exhaustedBase,
    outreachCampaign: {
      ...exhaustedBase.outreachCampaign,
      findFirst: async () => {
        pausedStatusReads += 1;
        const base = await exhaustedBase.outreachCampaign.findFirst();
        return { ...base, status: pausedStatusReads > 1 ? "PAUSED" : "ACTIVE" };
      },
    },
    outreachCampaignSend: {
      ...exhaustedBase.outreachCampaignSend,
      deleteMany: async (args: { where: { recordId?: string | { in: string[] }; status?: string } }) => {
        pausedDeletes.push(args.where);
      },
    },
    researchRecord: exhaustedDb.researchRecord,
  };
  const pausedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: pausedDb as never,
    provider,
    reserve: async () => { throw new Error("a paused campaign must not reserve a sender"); },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(pausedRun.sent, 0);
  assert.equal(pausedRun.attempted, 0);
  const pausedReleased = pausedDeletes.find((where) => typeof where.recordId === "object" && where.status === "QUEUED");
  assert.deepEqual(
    pausedReleased && typeof pausedReleased.recordId === "object" ? pausedReleased.recordId.in : [],
    ["record-1", "record-2", "record-3"],
    "every claimed first touch is released when the campaign pauses before sending",
  );

  // Day two must page past yesterday's ledger rows instead of re-reading the
  // first dailyCap audience rows (which are all already handled).
  const pagingLedger: Array<{ recordId: string; recipient: string; status: string; sentAt: Date | null; createdAt: Date }> = [];
  const pagingAudience = ["record-1", "record-2", "record-3"];
  const pagingPersonalization = Object.fromEntries(pagingAudience.map((id) => [id, {
    email: `${id}@buyerco.com`,
    company: `Company ${id}`,
    country: null,
  }]));
  type PagingWhere = {
    status?: string | { in: string[] };
    sentAt?: { gte?: Date; lt?: Date };
    createdAt?: { gte?: Date; lt?: Date };
  };
  const pagingMatches = (row: typeof pagingLedger[number], where: PagingWhere | undefined) => {
    if (!where) return true;
    const status = where.status;
    if (typeof status === "string" && row.status !== status) return false;
    if (status && typeof status !== "string" && !status.in.includes(row.status)) return false;
    for (const field of ["sentAt", "createdAt"] as const) {
      const range = where[field];
      if (!range) continue;
      const value = row[field];
      if (!value) return false;
      if (range.gte && value < range.gte) return false;
      if (range.lt && value >= range.lt) return false;
    }
    return true;
  };
  const pagingSendModel = {
    count: async (args: { where?: PagingWhere }) => pagingLedger.filter((row) => pagingMatches(row, args.where)).length,
    findMany: async (args: { where?: PagingWhere }) => pagingLedger.filter((row) => pagingMatches(row, args.where)),
    deleteMany: async () => undefined,
    createMany: async (args: { data: Array<{ recordId: string; recipient: string; status: string }> }) => {
      for (const row of args.data) pagingLedger.push({ ...row, sentAt: null, createdAt: new Date() });
    },
    updateMany: async (args: { where: { recordId?: string }; data: { status?: string; sentAt?: Date } }) => {
      for (const row of pagingLedger) {
        if (args.where.recordId && row.recordId !== args.where.recordId) continue;
        if (args.data.status) row.status = args.data.status;
        if (args.data.sentAt) row.sentAt = args.data.sentAt;
      }
    },
    upsert: async (args: {
      where: { campaignId_recordId: { recordId: string } };
      create: { recordId: string; recipient: string; status: string; sentAt?: Date };
      update: { status: string; sentAt?: Date };
    }) => {
      const existing = pagingLedger.find((row) => row.recordId === args.where.campaignId_recordId.recordId);
      if (existing) {
        existing.status = args.update.status;
        existing.sentAt = args.update.sentAt ?? existing.sentAt;
        return;
      }
      pagingLedger.push({ ...args.create, sentAt: args.create.sentAt ?? null, createdAt: new Date() });
    },
  };
  const pagingBase = fakeDatabase({
    dailyCap: 1,
    audienceRecordIds: pagingAudience,
    audiencePersonalization: pagingPersonalization,
  });
  const pagingDb = {
    ...pagingBase,
    outreachCampaignSend: pagingSendModel,
    researchRecord: {
      findMany: async () => pagingAudience.map((id, index) => ({
        id,
        status: "new",
        data: { email: `${id}@buyerco.com`, company: `Company ${id}` },
        createdAt: new Date(2026, 0, 1 + index),
      })),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: async () => [{ locked: 1 }],
      emailMessage: { findFirst: async () => null, create: async () => ({ id: "message-1" }) },
      emailThread: { create: async () => ({ id: "thread-1" }) },
      emailSenderReservation: { updateMany: async () => undefined },
      outreachCampaignSend: pagingSendModel,
      outreachCampaignFollowUp: { count: async () => 0, findMany: async () => [] },
      outreachCampaign: { updateMany: async () => undefined },
    }),
  };
  const sentRecipients: string[] = [];
  const pagingProvider = {
    ...provider,
    send: async (input: Record<string, unknown>) => {
      sentRecipients.push(String(input.recipient));
      return provider.send(input);
    },
  };
  for (const day of [1, 2, 3]) {
    const run = await runOutreachCampaignBatch({
      officeId: "office-1",
      campaignId: "campaign-1",
      db: pagingDb as never,
      provider: pagingProvider,
      reserve: async () => reservation,
      complete: async () => ({ completed: false }),
      pauseMs: 0,
      recipientCheck: offlineRecipientCheck,
      now: new Date(`2026-02-0${day}T12:00:00Z`),
    });
    assert.equal(run.sent, 1, `day ${day} should send exactly one first touch`);
  }
  assert.deepEqual(sentRecipients, ["record-1@buyerco.com", "record-2@buyerco.com", "record-3@buyerco.com"]);

  // A mailbox paused by sender protection between the reservation and the
  // provider call: a rotated first touch moves to another ready mailbox once,
  // a pinned campaign waits for its mailbox, and any other refusal settles.
  assert.equal(outreachCampaignPausedSenderAction({ error: SENDER_PAUSED_ERROR, rotated: true, rerouted: false }), "REROUTE");
  assert.equal(outreachCampaignPausedSenderAction({ error: SENDER_PAUSED_ERROR, rotated: true, rerouted: true }), "WAIT");
  assert.equal(outreachCampaignPausedSenderAction({ error: SENDER_PAUSED_ERROR, rotated: false, rerouted: false }), "WAIT");
  assert.equal(outreachCampaignPausedSenderAction({ error: "mailbox rejected the message", rotated: true, rerouted: false }), "SETTLE");

  // Rotated first touch: the paused mailbox's reservation is released and the
  // same recipient is re-reserved under the same idempotency key, so the pool
  // picks another ready mailbox and the message is delivered exactly once.
  const rerouteUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const rerouteBase = fakeDatabase({ senderAccountId: null, senderRotation: true });
  const rerouteDb = {
    ...rerouteBase,
    outreachCampaignSend: {
      ...rerouteBase.outreachCampaignSend,
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { rerouteUpdates.push(args); },
      deleteMany: async () => { throw new Error("a rerouted first touch must keep its claim"); },
    },
  };
  const rerouteReservations: Array<{ idempotencyKey: string; requestHash: string; accountId?: string }> = [];
  const rerouteSends: string[] = [];
  let rerouteReleases = 0;
  const rerouteRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: rerouteDb as never,
    provider: {
      ...provider,
      send: async (input: Record<string, unknown>) => {
        rerouteSends.push(String(input.accountId));
        return input.accountId === "account-1"
          ? { state: "REJECTED" as const, error: SENDER_PAUSED_ERROR }
          : provider.send(input);
      },
    },
    reserve: async (input) => {
      rerouteReservations.push({ idempotencyKey: input.idempotencyKey, requestHash: input.requestHash, accountId: input.accountId });
      return rerouteReservations.length === 1
        ? reservation
        : { ...reservation, accountId: "account-2", senderEmail: "second@buyerco.com" };
    },
    release: async () => { rerouteReleases += 1; },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.deepEqual(rerouteSends, ["account-1", "account-2"]);
  assert.equal(rerouteReservations.length, 2);
  assert.equal(rerouteReservations[0].idempotencyKey, rerouteReservations[1].idempotencyKey, "the retry reuses the idempotency key");
  assert.equal(rerouteReservations[0].requestHash, rerouteReservations[1].requestHash);
  assert.equal(rerouteReservations[1].accountId, undefined, "the pool picks the replacement mailbox");
  assert.equal(rerouteReleases, 1, "the paused mailbox's reservation is released before the retry");
  assert.equal(rerouteRun.rerouted, 1);
  assert.equal(rerouteRun.sent, 1);
  assert.equal(rerouteRun.rejected, 0);
  assert.equal(rerouteRun.poolExhausted, false);
  assert.equal(rerouteUpdates.filter((update) => update.data.status === "REJECTED").length, 0, "a pause is not a durable rejection");
  assert.deepEqual(rerouteRun.outcomes.map((outcome) => [outcome.state, outcome.senderEmail]), [["SENT", "second@buyerco.com"]]);

  // The replacement mailbox pausing too is not retried again in this run: the
  // claim is released and the recipient waits for the next run.
  const doublePauseDeletes: Array<{ recordId?: string | { in: string[] }; status?: string }> = [];
  const doublePauseDb = {
    ...rerouteBase,
    outreachCampaignSend: {
      ...rerouteBase.outreachCampaignSend,
      updateMany: async (args: { data: Record<string, unknown> }) => {
        if (args.data.status === "REJECTED") throw new Error("a pause must not settle the recipient as REJECTED");
      },
      deleteMany: async (args: { where: { recordId?: string | { in: string[] }; status?: string } }) => { doublePauseDeletes.push(args.where); },
    },
  };
  let doublePauseSends = 0;
  const doublePauseRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: doublePauseDb as never,
    provider: {
      ...provider,
      send: async () => {
        doublePauseSends += 1;
        return { state: "REJECTED" as const, error: SENDER_PAUSED_ERROR };
      },
    },
    reserve: async () => reservation,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.equal(doublePauseSends, 2);
  assert.equal(doublePauseRun.rerouted, 1);
  assert.equal(doublePauseRun.sent, 0);
  assert.equal(doublePauseRun.rejected, 0);
  assert.equal(doublePauseRun.poolExhausted, true);
  assert.equal(doublePauseRun.outcomes.at(-1)?.state, "POOL_EXHAUSTED");
  const doublePauseReleased = doublePauseDeletes.find((where) => typeof where.recordId === "object" && where.status === "QUEUED");
  assert.deepEqual(doublePauseReleased && typeof doublePauseReleased.recordId === "object" ? doublePauseReleased.recordId.in : [], ["record-1"]);

  // A pinned campaign keeps the operator's mailbox: no reroute, the claim is
  // released and the first touch waits for the mailbox to resume.
  const pinnedPauseDeletes: Array<{ recordId?: string | { in: string[] }; status?: string }> = [];
  const pinnedPauseBase = fakeDatabase();
  const pinnedPauseDb = {
    ...pinnedPauseBase,
    outreachCampaignSend: {
      ...pinnedPauseBase.outreachCampaignSend,
      updateMany: async (args: { data: Record<string, unknown> }) => {
        if (args.data.status === "REJECTED") throw new Error("a pause must not settle the recipient as REJECTED");
      },
      deleteMany: async (args: { where: { recordId?: string | { in: string[] }; status?: string } }) => { pinnedPauseDeletes.push(args.where); },
    },
  };
  const pinnedPauseReservations: Array<string | undefined> = [];
  const pinnedPauseRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: pinnedPauseDb as never,
    provider: {
      ...provider,
      send: async () => ({ state: "REJECTED" as const, error: SENDER_PAUSED_ERROR }),
    },
    reserve: async (input) => {
      pinnedPauseReservations.push(input.accountId);
      return reservation;
    },
    complete: async () => ({ completed: false }),
    pauseMs: 0,
    recipientCheck: offlineRecipientCheck,
  });
  assert.deepEqual(pinnedPauseReservations, ["account-1"], "a pinned campaign never asks the pool for another mailbox");
  assert.equal(pinnedPauseRun.rerouted, 0);
  assert.equal(pinnedPauseRun.rejected, 0);
  assert.equal(pinnedPauseRun.poolExhausted, true);
  const pinnedPauseReleased = pinnedPauseDeletes.find((where) => typeof where.recordId === "object" && where.status === "QUEUED");
  assert.deepEqual(pinnedPauseReleased && typeof pinnedPauseReleased.recordId === "object" ? pinnedPauseReleased.recordId.in : [], ["record-1"]);
  console.log("Outreach campaign send checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
