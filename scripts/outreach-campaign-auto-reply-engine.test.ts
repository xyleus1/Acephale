import assert from "node:assert/strict";
import {
  runOutreachCampaignAutoReplies,
  type OutreachReplyLlm,
} from "../src/lib/outreach-campaign-auto-reply";
import type { SupplierEmailProvider } from "../src/lib/supply-os/supplier-email-provider";

const now = new Date("2026-09-06T12:00:00.000Z");

function fakeDb(options: {
  context?: unknown;
  claimError?: unknown;
  body?: string;
  paused?: boolean;
  existingReply?: boolean;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const suppressions: Array<Record<string, unknown>> = [];
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
  const messages = [
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
  const db = {
    outreachCampaign: {
      findMany: async () => [campaign],
    },
    outreachCampaignSend: {
      findMany: async () => [{
        recordId: "record-1",
        recipient: "buyer@example.com",
        senderEmail: "sender@example.com",
        providerThreadId: "provider-thread-1",
        localThreadId: "thread-1",
      }],
    },
    emailThread: {
      findMany: async () => [{ id: "thread-1", subject: "Hello", externalThreadId: "provider-thread-1", messages }],
      updateMany: async () => ({ count: 1 }),
    },
    emailMessage: {
      create: async () => ({ id: "sent-1" }),
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
      findMany: async () => options.existingReply ? [{ inboundMessageId: "inbound-1" }] : [],
      create: async () => {
        if (options.claimError) throw options.claimError;
        return { id: "claim-1" };
      },
      updateMany: async (input: { data: Record<string, unknown> }) => {
        updates.push(input.data);
        return { count: 1 };
      },
      count: async () => 0,
    },
    emailSuppression: {
      upsert: async (input: { create: Record<string, unknown> }) => {
        suppressions.push(input.create);
        return input.create;
      },
    },
    emailSenderReservation: {
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as Parameters<typeof runOutreachCampaignAutoReplies>[0]["db"];
  return { db, updates, suppressions };
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
    const { db } = fakeDb({ body: "Can you send more information?", paused: true });
    const result = await runOutreachCampaignAutoReplies({ db, now, llm: noLlm });
    assert.equal(result.escalated, 1);
    assert.equal(result.items[0]?.reason, "sender_unavailable");
  }

  console.log("outreach campaign auto-reply engine checks passed");
}

void main();
