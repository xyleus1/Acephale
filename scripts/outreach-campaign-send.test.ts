import assert from "node:assert/strict";

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
    runOutreachCampaignBatch,
  } = await import("../src/lib/outreach-campaign-send");
  const { renderCampaignEmail } = await import("../src/lib/outreach-campaign-copy");
  const rows = [
    { id: "late", status: "new", data: { email: "late@example.com" }, createdAt: new Date("2026-01-02") },
    { id: "early", status: "new", data: { email: "early@example.com" }, createdAt: new Date("2026-01-01") },
    { id: "bad", status: "rejected", data: { email: "bad@example.com" }, createdAt: new Date("2026-01-01") },
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
      data: { email: "changed@example.com", company: "Changed Co", country: "FR" },
      createdAt: new Date("2026-01-01"),
    }, {
      id: "record-2",
      status: "new",
      data: { email: "other@example.com" },
      createdAt: new Date("2026-01-02"),
    }],
    audienceRecordIds: ["record-1", "missing", "record-2"],
    audiencePersonalization: {
      "record-1": { email: "pinned@example.com", company: "Pinned Co", country: "GB" },
      "record-2": { email: "other-pinned@example.com", company: null, country: null },
    },
    statuses: ["new"],
    emailField: "email",
    limit: 10,
  });
  assert.deepEqual(pinnedRows.map((row) => row.data), [{
    email: "pinned@example.com",
    company: "Pinned Co",
    country: "GB",
  }, {
    email: "other-pinned@example.com",
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
      data: { email: "changed@example.com" },
      createdAt: new Date("2026-01-01"),
    }, {
      id: "record-2",
      status: "rejected",
      data: { email: "rejected@example.com" },
      createdAt: new Date("2026-01-02"),
    }],
    audienceRecordIds: ["record-1", "record-2"],
    audiencePersonalization: {
      "record-1": { email: "pinned@example.com", company: null, country: null },
      "record-2": { email: "rejected-pinned@example.com", company: null, country: null },
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
    recipient: "early@example.com",
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

  function fakeDatabase(campaignOverrides: Record<string, unknown> = {}) {
    const send = {
      count: async () => 0,
      findMany: async () => [],
      deleteMany: async () => undefined,
      createMany: async () => undefined,
      updateMany: async () => undefined,
      upsert: async () => undefined,
    };
    const db = {
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
            "record-1": { email: "buyer@example.com", company: "Buyer Co", country: null },
          },
          ...campaignOverrides,
        }),
        updateMany: async () => undefined,
      },
      outreachCampaignSend: send,
      emailSenderReservation: { findUnique: async () => null },
      researchRecord: {
        findMany: async () => [{
          id: "record-1",
          status: "new",
          data: { email: "buyer@example.com", company: "Buyer Co" },
          createdAt: new Date("2026-01-01"),
        }],
      },
      $transaction: async (callback: (tx: {
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
        outreachCampaign: { updateMany: () => Promise<void> };
      }) => Promise<unknown>) => callback({
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
        outreachCampaign: { updateMany: async () => undefined },
      }),
    };
    return db;
  }

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
  const noSenderDb = fakeDatabase() as any;
  noSenderDb.outreachCampaign.findFirst = async () => ({
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
    senderAccountId: null,
    dailyCap: 5,
    listId: "list-1",
    audienceRecordIds: ["record-1"],
    audiencePersonalization: {
      "record-1": { email: "buyer@example.com", company: "Buyer Co", country: null },
    },
  });
  const noSenderRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: noSenderDb,
    complete: async () => ({ completed: false }),
    pauseMs: 0,
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
    now: new Date("2026-01-01T12:00:00Z"),
  });
  assert.equal(sentRun.sent, 1);
  assert.equal(sentProviderInput?.senderDisplayName, "Wens");

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
  });
  assert.equal(unknownRun.unknown, 1);
  assert.equal(released, 1);

  const exhaustedRun = await runOutreachCampaignBatch({
    officeId: "office-1",
    campaignId: "campaign-1",
    db: fakeDatabase() as never,
    provider,
    reserve: async () => ({ error: "pool exhausted", code: "POOL_EXHAUSTED" as const }),
    complete: async () => ({ completed: false }),
    pauseMs: 0,
  });
  assert.equal(exhaustedRun.poolExhausted, true);
  console.log("Outreach campaign send checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
