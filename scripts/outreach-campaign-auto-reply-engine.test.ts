import assert from "node:assert/strict";
import {
  runOutreachCampaignAutoReplies,
  type OutreachReplyLlm,
} from "../src/lib/outreach-campaign-auto-reply";
import type { SupplierEmailProvider } from "../src/lib/supply-os/supplier-email-provider";

const now = new Date("2026-09-06T12:00:00.000Z");

type TestMessage = {
  id: string;
  accountId: string | null;
  direction: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string;
  subject: string | null;
  bodyText: string | null;
  sentAt: Date;
  rfcMessageId: string | null;
  deliveryKind: string | null;
  classification: string | null;
};

function fakeDb(options: {
  context?: unknown;
  claimError?: unknown;
  body?: string;
  paused?: boolean;
  existingReply?: boolean | {
    action: string;
    claimedAt: Date | null;
    rfcMessageId?: string | null;
    reservationId?: string | null;
  };
  messages?: TestMessage[];
  pendingReply?: boolean;
  pendingIncomplete?: "rfcMessageId" | "reservationId";
  pendingAt?: Date;
  claimUpdateCount?: number;
  preparedUpdateCount?: number;
  preparedUpdateError?: boolean | "once";
  batch?: boolean;
  suppressionError?: boolean | "once";
  sendThreadId?: string;
  existingReplies?: Array<{
    threadId: string;
    action: string;
    claimedAt: Date | null;
    rfcMessageId?: string | null;
    reservationId?: string | null;
  }>;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const suppressions: Array<Record<string, unknown>> = [];
  const createdMessages: Array<Record<string, unknown>> = [];
  const campaign = {
    id: "campaign-1",
    officeId: "office-1",
    name: "Campaign",
    listId: "list-1",
    status: "ACTIVE",
    replyMode: "AUTO",
    replyContext: options.context === undefined ? { pitch: "A pitch" } : options.context,
    senderDisplayName: "Matt",
    audiencePersonalization: { "record-1": { email: "buyer@example.com", company: "Buyer" } },
    emailField: "email",
    companyField: "company",
    countryField: "country",
  };
  const messages: TestMessage[] = [
    {
      id: "outbound-1",
      accountId: "account-1",
      direction: "OUTBOUND",
      fromEmail: "sender@example.com",
      fromName: "Matt",
      toEmails: "[\"buyer@example.com\"]",
      subject: "Hello",
      bodyText: "Hello",
      sentAt: new Date("2026-09-05T12:00:00.000Z"),
      rfcMessageId: "<outbound@derya.ai>",
      deliveryKind: null,
      classification: null,
    },
    {
      id: "inbound-1",
      accountId: "account-1",
      direction: "INBOUND",
      fromEmail: "buyer@example.com",
      fromName: "Buyer",
      toEmails: "[\"sender@example.com\"]",
      subject: "Re: Hello",
      bodyText: options.body ?? "Please stop emailing me",
      sentAt: new Date("2026-09-06T11:00:00.000Z"),
      rfcMessageId: "<inbound@buyer.example>",
      deliveryKind: null,
      classification: null,
    },
  ];
  const threadMessages = options.messages ?? messages;
  const campaignRows = options.batch
    ? [campaign, { ...campaign, id: "campaign-2", audiencePersonalization: { "record-2": { email: "second@example.com", company: "Second" } } }]
    : [campaign];
  const pendingReply = {
    id: "pending-1",
    officeId: "office-1",
    campaignId: "campaign-1",
    threadId: "thread-1",
    inboundMessageId: "inbound-1",
    rfcMessageId: options.pendingIncomplete === "rfcMessageId" ? null : "<pending@derya.ai>",
    reservationId: options.pendingIncomplete === "reservationId" ? null : "reservation-1",
    draft: "Thanks for your interest.",
    createdAt: new Date("2026-09-06T11:00:00.000Z"),
    pendingAt: options.pendingAt ?? new Date("2026-09-06T11:00:00.000Z"),
    action: "PENDING",
    claimedAt: null,
  };
  const db = {
    outreachCampaign: {
      findMany: async () => campaignRows,
      findFirst: async () => campaign,
    },
    outreachCampaignSend: {
      findMany: async (input: { where?: { campaignId?: string } }) => [{
        recordId: input.where?.campaignId === "campaign-2" ? "record-2" : "record-1",
        recipient: input.where?.campaignId === "campaign-2" ? "second@example.com" : "buyer@example.com",
        senderEmail: "sender@example.com",
        providerThreadId: "provider-thread-1",
        localThreadId: input.where?.campaignId === "campaign-2"
          ? "thread-2"
          : (options.sendThreadId ?? "thread-1"),
      }],
      findFirst: async () => ({
        recordId: "record-1",
        recipient: "buyer@example.com",
        senderEmail: "sender@example.com",
        providerThreadId: "provider-thread-1",
        localThreadId: "thread-1",
      }),
    },
    emailThread: {
      findMany: async (input: { where?: { id?: { in?: string[] } } }) => {
        const id = input.where?.id?.in?.[0] ?? "thread-1";
        const suffix = id === "thread-2" ? "2" : "1";
        return [{
          id,
          subject: "Hello",
          externalThreadId: "provider-thread-1",
          messages: threadMessages.map((message) => ({ ...message, id: `${message.id.replace(/[12]$/, "")}${suffix}` })),
        }];
      },
      findFirst: async () => ({ id: "thread-1", subject: "Hello", externalThreadId: "provider-thread-1", messages: threadMessages }),
      updateMany: async () => ({ count: 1 }),
    },
    emailMessage: {
      findFirst: async () => null,
      create: async (input: { data: Record<string, unknown> }) => {
        createdMessages.push(input.data);
        return { id: "sent-1" };
      },
    },
    emailAccount: {
      findFirst: async () => ({
        id: "account-1",
        email: "sender@example.com",
        isActive: true,
        sendEnabled: true,
        sendPausedAt: options.paused ? now : null,
      }),
    },
    researchRecord: {
      findFirst: async () => ({ data: { name: "Buyer" } }),
    },
    outreachCampaignReply: {
      findMany: async (input: { where?: { action?: string | { in?: string[] }; threadId?: { in?: string[] } } }) => {
        if (typeof input.where?.action === "object" && input.where.action.in?.includes("PENDING")) {
          return options.pendingReply ? [pendingReply] : [];
        }
        if (input.where?.threadId && options.existingReplies) {
          return options.existingReplies;
        }
        if (options.pendingReply) return [{ ...pendingReply, action: "PENDING", claimedAt: null }];
        if (!options.existingReply) return [];
        const existing = typeof options.existingReply === "object"
          ? options.existingReply
          : { action: "ESCALATED", claimedAt: null };
        return [{
          id: "existing-1",
          threadId: "thread-1",
          inboundMessageId: "inbound-1",
          rfcMessageId: null,
          reservationId: null,
          draft: null,
          ...existing,
        }];
      },
      create: async () => {
        if (options.claimError) throw options.claimError;
        return { id: "claim-1" };
      },
      updateMany: async (input: { data: Record<string, unknown> }) => {
        updates.push(input.data);
        if (input.data.rfcMessageId && options.preparedUpdateCount !== undefined) {
          return { count: options.preparedUpdateCount };
        }
        if (input.data.rfcMessageId && options.preparedUpdateError) {
          if (options.preparedUpdateError === "once") options.preparedUpdateError = false;
          throw new Error("prepared update unavailable");
        }
        return input.data.action === "CLAIMED" && options.claimUpdateCount !== undefined
          ? { count: options.claimUpdateCount }
          : { count: 1 };
      },
      count: async () => 0,
    },
    emailSuppression: {
      upsert: async (input: { create: Record<string, unknown> }) => {
        if (options.suppressionError) {
          if (options.suppressionError === "once") options.suppressionError = false;
          throw new Error("suppression unavailable");
        }
        suppressions.push(input.create);
        return input.create;
      },
    },
    emailSenderReservation: {
      findFirst: async () => ({
        id: "reservation-1",
        accountId: "account-1",
        account: { id: "account-1", email: "sender@example.com" },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as Parameters<typeof runOutreachCampaignAutoReplies>[0]["db"];
  return { db, updates, suppressions, createdMessages };
}

const noLlm: OutreachReplyLlm = {
  classify: async () => {
    throw new Error("LLM must not be called");
  },
};

async function main() {
  {
    const { db, suppressions } = fakeDb({ body: "Please unsubscribe me" });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.suppressed, 1);
    assert.equal(suppressions.length, 1);
    assert.equal(result.items[0]?.reason, "unsubscribe");
  }

  {
    const { db, updates, suppressions } = fakeDb({
      body: "Please unsubscribe me",
      existingReply: { action: "CLAIMED", claimedAt: null },
      claimError: { code: "P2002" },
      suppressionError: "once",
    });
    const first = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(first.failed, 1);
    assert.equal(first.items[0]?.reason, "suppression_failed");
    assert.equal(suppressions.length, 0);
    assert.ok(updates.some((data) => data.reason === "suppression_retry" && data.claimedAt === null));
    const second = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(second.suppressed, 1);
    assert.equal(suppressions.length, 1);
  }

  {
    const { db, updates, suppressions } = fakeDb({
      body: "I would like details.",
      existingReply: { action: "CLAIMED", claimedAt: null },
      claimError: { code: "P2002" },
      suppressionError: "once",
    });
    const first = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => ({
          intent: "UNSUBSCRIBE",
          confidence: 0.95,
          needsHuman: false,
          reason: "Unsubscribe",
          reply: null,
        }),
      },
    });
    assert.equal(first.failed, 1);
    assert.equal(first.items[0]?.reason, "suppression_failed");
    assert.ok(updates.some((data) => data.reason === "suppression_retry" && data.claimedAt === null));
    const second = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => ({
          intent: "UNSUBSCRIBE",
          confidence: 0.95,
          needsHuman: false,
          reason: "Unsubscribe",
          reply: null,
        }),
      },
    });
    assert.equal(second.suppressed, 1);
    assert.equal(suppressions.length, 1);
  }

  {
    const { db } = fakeDb({ context: null, body: "Can you share details?" });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.escalated, 1);
    assert.equal(result.items[0]?.reason, "no_reply_context");
  }

  {
    const { db } = fakeDb({ claimError: { code: "P2002" } });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.skipped, 1);
    assert.equal(result.items[0]?.reason, "claimed");
  }

  {
    let llmCalls = 0;
    const { db } = fakeDb({ existingReply: true });
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => {
          llmCalls += 1;
          throw new Error("LLM must not be called");
        },
      },
    });
    assert.equal(result.examined, 0);
    assert.equal(llmCalls, 0);
  }

  {
    let llmCalls = 0;
    const { db } = fakeDb({
      messages: [{
        id: "outbound-only",
        accountId: "account-1",
        direction: "OUTBOUND",
        fromEmail: "sender@example.com",
        fromName: "Matt",
        toEmails: "[\"sender@example.com\"]",
        subject: "Hello",
        bodyText: "Our own message",
        sentAt: new Date("2026-09-06T11:00:00.000Z"),
        rfcMessageId: "<outbound-only@derya.ai>",
        deliveryKind: null,
        classification: null,
      }],
    });
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => {
          llmCalls += 1;
          throw new Error("LLM must not be called");
        },
      },
    });
    assert.equal(result.examined, 0);
    assert.equal(llmCalls, 0);
  }

  {
    const { db } = fakeDb({
      messages: [
        {
          id: "outbound-1",
          accountId: "account-1",
          direction: "OUTBOUND",
          fromEmail: "sender@example.com",
          fromName: "Matt",
          toEmails: "[\"buyer@example.com\"]",
          subject: "Hello",
          bodyText: "Hello",
          sentAt: new Date("2026-09-05T12:00:00.000Z"),
          rfcMessageId: "<outbound@derya.ai>",
          deliveryKind: null,
          classification: null,
        },
        {
          id: "auto-reply-1",
          accountId: "account-1",
          direction: "OUTBOUND",
          fromEmail: "sender@example.com",
          fromName: "Matt",
          toEmails: "[\"buyer@example.com\"]",
          subject: "Re: Hello",
          bodyText: "Thanks for your interest.",
          sentAt: new Date("2026-09-06T11:30:00.000Z"),
          rfcMessageId: "<auto-reply@derya.ai>",
          deliveryKind: null,
          classification: null,
        },
      ],
    });
    let llmCalls = 0;
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => {
          llmCalls += 1;
          throw new Error("LLM must not be called");
        },
      },
    });
    assert.equal(result.examined, 0);
    assert.equal(llmCalls, 0);
  }

  {
    const { db } = fakeDb({
      existingReply: { action: "CLAIMED", claimedAt: new Date(now.getTime() - 31 * 60_000) },
      body: "I would like details.",
    });
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => ({
          intent: "INTERESTED",
          confidence: 0.95,
          needsHuman: false,
          reason: "Interested",
          reply: null,
        }),
      },
    });
    assert.equal(result.escalated, 1);
  }

  {
    const { db } = fakeDb({
      existingReply: { action: "CLAIMED", claimedAt: new Date(now.getTime() - 31 * 60_000) },
      claimError: { code: "P2002" },
      claimUpdateCount: 0,
    });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.skipped, 1);
    assert.equal(result.items[0]?.reason, "claimed");
  }

  {
    const { db } = fakeDb({
      sendThreadId: "thread-2",
      body: "I would like details.",
      existingReplies: [{
        threadId: "thread-1",
        action: "PENDING",
        claimedAt: null,
      }],
    });
    let providerSends = 0;
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => ({
          intent: "INTERESTED",
          confidence: 0.95,
          needsHuman: false,
          reason: "Interested",
          reply: "Thanks for your interest.",
        }),
      },
      provider: {
        send: async () => {
          providerSends += 1;
          return {
            state: "SENT" as const,
            providerMessageId: "provider-message-2",
            providerThreadId: "provider-thread-2",
          };
        },
        reconcile: async () => ({ state: "NOT_FOUND" as const, error: "not used" }),
      },
      reserve: async () => ({
        ok: true as const,
        reservationId: "reservation-1",
        accountId: "account-1",
        senderEmail: "sender@example.com",
        dailySendLimit: 50,
        sentToday: 0,
        reservedToday: 1,
        completed: false,
        providerMessageId: null,
        providerThreadId: null,
        localThreadId: null,
        sentAt: null,
      }),
      release: async () => undefined,
    });
    assert.equal(result.sent, 1);
    assert.equal(providerSends, 1);
  }

  {
    const { db } = fakeDb({
      body: "I would like details.",
      preparedUpdateCount: 0,
    });
    let providerSends = 0;
    let releaseCalls = 0;
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => ({
          intent: "INTERESTED",
          confidence: 0.95,
          needsHuman: false,
          reason: "Interested",
          reply: "Thanks for your interest.",
        }),
      },
      provider: {
        send: async () => {
          providerSends += 1;
          return { state: "SENT" as const, providerMessageId: "unused" };
        },
        reconcile: async () => ({ state: "NOT_FOUND" as const, error: "not used" }),
      },
      reserve: async () => ({
        ok: true as const,
        reservationId: "reservation-1",
        accountId: "account-1",
        senderEmail: "sender@example.com",
        dailySendLimit: 50,
        sentToday: 0,
        reservedToday: 1,
        completed: false,
        providerMessageId: null,
        providerThreadId: null,
        localThreadId: null,
        sentAt: null,
      }),
      release: async () => {
        releaseCalls += 1;
      },
    });
    assert.equal(result.skipped, 1);
    assert.equal(result.items[0]?.reason, "claimed");
    assert.equal(providerSends, 0);
    assert.equal(releaseCalls, 1);
  }

  {
    const { db } = fakeDb({
      body: "I would like details.",
      preparedUpdateError: "once",
    });
    let providerSends = 0;
    let releaseCalls = 0;
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => ({
          intent: "INTERESTED",
          confidence: 0.95,
          needsHuman: false,
          reason: "Interested",
          reply: "Thanks for your interest.",
        }),
      },
      provider: {
        send: async () => {
          providerSends += 1;
          throw new Error("provider.send must not be called");
        },
        reconcile: async () => ({ state: "NOT_FOUND" as const, error: "not used" }),
      },
      reserve: async () => ({
        ok: true as const,
        reservationId: "reservation-1",
        accountId: "account-1",
        senderEmail: "sender@example.com",
        dailySendLimit: 50,
        sentToday: 0,
        reservedToday: 1,
        completed: false,
        providerMessageId: null,
        providerThreadId: null,
        localThreadId: null,
        sentAt: null,
      }),
      release: async () => {
        releaseCalls += 1;
      },
    });
    assert.equal(result.failed, 1);
    assert.equal(result.items[0]?.reason, "prepared update unavailable");
    assert.equal(providerSends, 0);
    assert.equal(releaseCalls, 1);
  }

  {
    const oldRfcMessageId = "<interrupted-reply@derya.ai>";
    const { db, updates } = fakeDb({
      existingReply: {
        action: "CLAIMED",
        claimedAt: new Date(now.getTime() - 31 * 60_000),
        rfcMessageId: oldRfcMessageId,
        reservationId: "reservation-1",
        draft: "Thanks for your interest.",
      },
      body: "I would like details.",
      claimError: { code: "P2002" },
    });
    let llmCalls = 0;
    let providerSends = 0;
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => {
          llmCalls += 1;
          throw new Error("LLM must not be called");
        },
      },
      provider: {
        send: async () => {
          providerSends += 1;
          throw new Error("provider.send must not be called");
        },
        reconcile: async () => ({ state: "NOT_FOUND", error: "not used" }),
      },
    });
    assert.equal(result.items[0]?.action, "PENDING");
    assert.equal(result.items[0]?.reason, "delivery_uncertain");
    assert.equal(llmCalls, 0);
    assert.equal(providerSends, 0);
    assert.deepEqual(
      updates.find((data) => data.action === "PENDING"),
      {
        action: "PENDING",
        reason: "delivery_uncertain",
        draft: "Thanks for your interest.",
        pendingAt: now,
        claimedAt: null,
      },
    );
  }

  {
    const { db } = fakeDb({
      existingReply: { action: "CLAIMED", claimedAt: new Date(now.getTime() - 5 * 60_000) },
    });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.examined, 0);
  }

  {
    const { db } = fakeDb({ body: "I would like details." });
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => {
          throw new Error("unexpected classifier failure");
        },
      },
    });
    assert.equal(result.failed, 1);
    assert.equal(result.items[0]?.reason, "unexpected classifier failure");
  }

  {
    const { db } = fakeDb({ body: "I would like details.", batch: true });
    let llmCalls = 0;
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => {
          llmCalls += 1;
          if (llmCalls === 1) throw new Error("unexpected classifier failure");
          return {
            intent: "INTERESTED",
            confidence: 0.95,
            needsHuman: false,
            reason: "Interested",
            reply: "Thanks for your interest.",
          };
        },
      },
      provider: {
        send: async () => ({
          state: "SENT",
          providerMessageId: "provider-message-2",
          providerThreadId: "provider-thread-1",
        }),
        reconcile: async () => ({
          state: "NOT_FOUND",
          error: "not used",
        }),
      },
      reserve: async () => ({
        ok: true as const,
        reservationId: "reservation-1",
        accountId: "account-1",
        senderEmail: "sender@example.com",
        dailySendLimit: 50,
        sentToday: 0,
        reservedToday: 1,
        completed: false,
        providerMessageId: null,
        providerThreadId: null,
        localThreadId: null,
        sentAt: null,
      }),
      release: async () => undefined,
    });
    assert.equal(llmCalls, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.sent, 1);
  }

  {
    const { db, createdMessages } = fakeDb({ pendingReply: true });
    let reconcileInput: { accountId: string; senderEmail: string } | null = null;
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: noLlm,
      provider: {
        send: async () => ({
          state: "UNKNOWN",
          error: "not used",
        }),
        reconcile: async (input) => {
          reconcileInput = { accountId: input.accountId, senderEmail: input.senderEmail };
          return {
            state: "SENT",
            providerMessageId: "reconciled-provider-message",
            providerThreadId: "provider-thread-1",
          };
        },
      },
      release: async () => undefined,
    });
    assert.equal(result.examined, 0);
    assert.equal(createdMessages.length, 1);
    assert.equal(createdMessages[0]?.direction, "OUTBOUND");
    assert.deepEqual(reconcileInput, { accountId: "account-1", senderEmail: "sender@example.com" });
  }

  {
    const { db } = fakeDb({ pendingReply: true, pendingIncomplete: "rfcMessageId" });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.examined, 0);
  }

  {
    const { db, updates } = fakeDb({
      pendingReply: true,
      pendingAt: new Date(now.getTime() - 31 * 60_000),
    });
    let releaseCalls = 0;
    await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: noLlm,
      provider: {
        send: async () => ({ state: "UNKNOWN", error: "not used" }),
        reconcile: async () => ({ state: "NOT_FOUND", error: "not found" }),
      },
      release: async () => {
        releaseCalls += 1;
      },
    });
    assert.equal(releaseCalls, 1);
    assert.ok(updates.some((data) => data.action === "FAILED" && data.reason === "delivery_unconfirmed"));
  }

  {
    const { db } = fakeDb({ body: "I would like to learn more." });
    let llmCalls = 0;
    const llm: OutreachReplyLlm = {
      classify: async () => {
        llmCalls += 1;
        return {
          intent: "INTERESTED",
          confidence: 0.95,
          needsHuman: false,
          reason: "Interested",
          reply: "Thanks for your interest. I can share the details.",
        };
      },
    };
    const provider: SupplierEmailProvider = {
      send: async () => ({
        state: "SENT",
        providerMessageId: "provider-message-1",
        providerThreadId: "provider-thread-1",
      }),
      reconcile: async () => [],
    };
    const reservation = {
      ok: true as const,
      reservationId: "reservation-1",
      accountId: "account-1",
      senderEmail: "sender@example.com",
      dailySendLimit: 50,
      sentToday: 0,
      reservedToday: 1,
      completed: false,
      providerMessageId: null,
      providerThreadId: null,
      localThreadId: null,
      sentAt: null,
    };
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm,
      provider,
      reserve: async () => reservation,
      release: async () => undefined,
    });
    assert.equal(result.sent, 1);
    assert.equal(llmCalls, 1);
    assert.equal(result.items[0]?.sentMessageId, "sent-1");
  }

  {
    const { db, updates } = fakeDb({
      body: "I would like to learn more.",
      suppressionError: true,
    });
    const result = await runOutreachCampaignAutoReplies({
      db,
      now,
      llm: {
        classify: async () => ({
          intent: "NOT_INTERESTED",
          confidence: 0.95,
          needsHuman: false,
          reason: "Not interested",
          reply: "Understood, we will not follow up.",
        }),
      },
      provider: {
        send: async () => ({
          state: "SENT",
          providerMessageId: "provider-message-1",
          providerThreadId: "provider-thread-1",
        }),
        reconcile: async () => ({ state: "NOT_FOUND", error: "not used" }),
      },
      reserve: async () => ({
        ok: true as const,
        reservationId: "reservation-1",
        accountId: "account-1",
        senderEmail: "sender@example.com",
        dailySendLimit: 50,
        sentToday: 0,
        reservedToday: 1,
        completed: false,
        providerMessageId: null,
        providerThreadId: null,
        localThreadId: null,
        sentAt: null,
      }),
      release: async () => undefined,
    });
    assert.equal(result.sent, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.items[0]?.reason, "suppression_failed");
    assert.ok(updates.some((data) => data.action === "SENT"));
  }

  {
    const { db } = fakeDb({ body: "Can you send more information?", paused: true });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.escalated, 1);
    assert.equal(result.items[0]?.reason, "sender_unavailable");
  }

  console.log("outreach campaign auto-reply engine checks passed");
}

void main();
