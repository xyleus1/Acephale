import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { classifyInboundEmail } from "./email-classifier";
import { autoCreateInquiryFromThread } from "./thread-actions";
import { ingestKnowledgeObject } from "./memory/ingest-object";
import { recordMemoryEvent } from "./memory/record-event";

type WhatsAppTextMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
};

type WhatsAppChange = {
  value?: {
    metadata?: {
      display_phone_number?: string;
      phone_number_id?: string;
    };
    contacts?: Array<{
      profile?: { name?: string };
      wa_id?: string;
    }>;
    messages?: WhatsAppTextMessage[];
  };
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: WhatsAppChange[];
  }>;
};

export type WhatsAppIngestResult = {
  ok: true;
  processed: number;
  created: number;
  threadsTouched: number;
  autoInquiries: number;
  autoLinked: number;
};

export function verifyWhatsAppSignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  // Fail closed in production: an unsigned inbound payload must never be
  // accepted when no app secret is configured (F3). Dev/preview stays permissive.
  if (!appSecret) return process.env.NODE_ENV !== "production";
  if (!signature?.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function resolveWhatsAppOfficeId(): Promise<string | null> {
  if (process.env.WHATSAPP_OFFICE_ID) return process.env.WHATSAPP_OFFICE_ID;

  const offices = await prisma.office.findMany({ select: { id: true }, take: 2 });
  return offices.length === 1 ? offices[0].id : null;
}

export async function ensureWhatsAppAccount(args: {
  officeId: string;
  phoneNumberId: string;
}) {
  const accountEmail = `whatsapp:${args.phoneNumberId}`;
  const existing = await prisma.emailAccount.findFirst({
    where: { officeId: args.officeId, email: accountEmail },
  });
  if (existing) return existing;

  return prisma.emailAccount.create({
    data: {
      officeId: args.officeId,
      email: accountEmail,
      provider: "WHATSAPP",
      isActive: true,
    },
  });
}

function whatsappAddress(phone: string) {
  return `whatsapp:${phone.replace(/[^\d]/g, "")}`;
}

// Which gateway carries WhatsApp traffic. "meta" is the official Cloud API;
// "greenapi" is the hosted WhatsApp-Web gateway used until Meta creds exist.
// Inbound arrives on a provider-specific webhook route; outbound and read
// receipts branch here. Everything downstream is provider-agnostic.
export function whatsAppProvider(): "meta" | "greenapi" {
  return process.env.WHATSAPP_PROVIDER === "greenapi" ? "greenapi" : "meta";
}

function greenApiConfig(): { baseUrl: string; idInstance: string; token: string } | null {
  const idInstance = process.env.GREEN_API_ID_INSTANCE;
  const token = process.env.GREEN_API_TOKEN;
  if (!idInstance || !token) return null;
  const baseUrl = (process.env.GREEN_API_BASE_URL ?? "https://api.green-api.com").replace(/\/+$/, "");
  return { baseUrl, idInstance, token };
}

// True when outbound sending through the active provider is operationally
// enabled. Mirrors the /api/whatsapp/send gate (F5/EXT): sending is opt-in.
export function whatsAppSendConfigured(): boolean {
  if (process.env.WHATSAPP_SEND_ENABLED !== "true") return false;
  if (whatsAppProvider() === "greenapi") {
    // WHATSAPP_PHONE_NUMBER_ID doubles as the thread key for outbound logging.
    return Boolean(greenApiConfig()) && Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID);
  }
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN) && Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID);
}

function whatsAppAutoReadEnabled(): boolean {
  return process.env.WHATSAPP_AUTO_READ_ENABLED === "true";
}

// Mark an inbound message as read (blue ticks) via the active provider.
// Best-effort: a failure must never break webhook ingest, so callers wrap
// or ignore errors. `senderDigits` is required in greenapi mode (readChat
// is chat-addressed there), unused on the Meta path.
export async function markWhatsAppMessageRead(args: {
  messageId: string;
  phoneNumberId?: string;
  senderDigits?: string;
}): Promise<{ ok: true } | { error: string }> {
  if (whatsAppProvider() === "greenapi") {
    const green = greenApiConfig();
    if (!green) return { error: "Green API credentials are not configured." };
    if (!args.senderDigits) return { error: "senderDigits is required for Green API mark-read." };
    const res = await fetch(
      `${green.baseUrl}/waInstance${green.idInstance}/readChat/${green.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: `${args.senderDigits}@c.us`, idMessage: args.messageId }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `WhatsApp mark-read failed: ${res.status} ${body.slice(0, 200)}` };
    }
    return { ok: true };
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = args.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v23.0";
  if (!accessToken || !phoneNumberId) return { error: "WhatsApp credentials are not configured." };

  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: args.messageId,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `WhatsApp mark-read failed: ${res.status} ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

// Store an outbound WhatsApp text into the matching inbox thread (find or
// create by the counterparty number). Shared by the /api/whatsapp/send route
// and the RFQ/inbox server actions so every send leaves the same trail.
export async function logOutboundWhatsAppMessage(args: {
  officeId: string;
  to: string; // digits or formatted; normalized here
  body: string;
  providerMessageId: string | null;
  threadId?: string | null;
}): Promise<{ threadId: string }> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured.");

  const account = await ensureWhatsAppAccount({ officeId: args.officeId, phoneNumberId });
  const normalizedTo = args.to.replace(/[^\d]/g, "");
  const fromAddress = `whatsapp:${phoneNumberId}`;
  const toAddress = `whatsapp:${normalizedTo}`;

  let thread = args.threadId
    ? await prisma.emailThread.findFirst({ where: { id: args.threadId, officeId: args.officeId } })
    : null;

  if (!thread) {
    const externalThreadId = `whatsapp:${phoneNumberId}:${normalizedTo}`;
    thread = await prisma.emailThread.findFirst({
      where: { officeId: args.officeId, externalThreadId },
    });
    if (!thread) {
      thread = await prisma.emailThread.create({
        data: {
          officeId: args.officeId,
          subject: `WhatsApp · ${normalizedTo}`,
          participants: JSON.stringify([fromAddress, toAddress]),
          externalThreadId,
          lastMessageAt: new Date(),
        },
      });
    }
  }

  await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      accountId: account.id,
      externalId: args.providerMessageId,
      direction: "OUTBOUND",
      fromEmail: fromAddress,
      toEmails: JSON.stringify([toAddress]),
      subject: thread.subject,
      bodyText: args.body,
      sentAt: new Date(),
    },
  });
  await prisma.emailThread.updateMany({
    where: { id: thread.id, officeId: args.officeId },
    data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
  });

  return { threadId: thread.id };
}

function messageBody(message: WhatsAppTextMessage) {
  if (message.type === "text" && message.text?.body) return message.text.body;
  return `[Unsupported WhatsApp ${message.type || "unknown"} message]`;
}

function sentAtFromWhatsApp(timestamp: string) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

export async function ingestWhatsAppWebhook(payload: WhatsAppWebhookPayload): Promise<WhatsAppIngestResult | { error: string }> {
  const officeId = await resolveWhatsAppOfficeId();
  if (!officeId) {
    return { error: "WHATSAPP_OFFICE_ID is required when more than one office exists." };
  }

  let processed = 0;
  let created = 0;
  let autoInquiries = 0;
  let autoLinked = 0;
  const touchedThreadIds = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const account = await ensureWhatsAppAccount({ officeId, phoneNumberId });
      const businessNumber = value?.metadata?.display_phone_number
        ? whatsappAddress(value.metadata.display_phone_number)
        : account.email;

      for (const message of value.messages ?? []) {
        if (!message.id || !message.from) continue;
        processed++;

        const existingMessage = await prisma.emailMessage.findUnique({
          where: { externalId: message.id },
          select: { threadId: true },
        });
        if (existingMessage) {
          touchedThreadIds.add(existingMessage.threadId);
          continue;
        }

        const senderAddress = whatsappAddress(message.from);
        const contact = value.contacts?.find((c) => c.wa_id === message.from) ?? value.contacts?.[0];
        const contactName = contact?.profile?.name ?? null;
        const externalThreadId = `whatsapp:${phoneNumberId}:${message.from}`;
        const subject = `WhatsApp · ${contactName ?? message.from}`;
        const bodyText = messageBody(message);
        const sentAt = sentAtFromWhatsApp(message.timestamp);

        let localThread = await prisma.emailThread.findFirst({
          where: { officeId, externalThreadId },
        });

        let classificationLabel: string | null = null;
        let classificationReason: string | null = null;
        let classifiedMatchJobId: string | null = null;
        let classifiedMatchInquiryId: string | null = null;
        try {
          const cls = await classifyInboundEmail({
            subject,
            fromEmail: senderAddress,
            bodyText,
            officeId,
          });
          classificationLabel = cls.kind;
          classificationReason = cls.reason;
          classifiedMatchJobId = cls.matchJobId ?? null;
          classifiedMatchInquiryId = cls.matchInquiryId ?? null;
        } catch {
          classificationLabel = "OTHER";
          classificationReason = "Classification failed during WhatsApp ingest.";
        }

        if (!localThread) {
          localThread = await prisma.emailThread.create({
            data: {
              officeId,
              subject,
              participants: JSON.stringify([senderAddress, businessNumber]),
              externalThreadId,
              jobId: classifiedMatchJobId,
              inquiryId: classifiedMatchInquiryId,
              lastMessageAt: sentAt,
            },
          });
        } else if (!localThread.jobId && !localThread.inquiryId && (classifiedMatchJobId || classifiedMatchInquiryId)) {
          await prisma.emailThread.updateMany({
            where: { id: localThread.id, officeId },
            data: { jobId: classifiedMatchJobId, inquiryId: classifiedMatchInquiryId },
          });
          localThread.jobId = classifiedMatchJobId;
          localThread.inquiryId = classifiedMatchInquiryId;
        }

        const createdMessage = await prisma.emailMessage.create({
          data: {
            threadId: localThread.id,
            accountId: account.id,
            externalId: message.id,
            direction: "INBOUND",
            fromEmail: senderAddress,
            fromName: contactName,
            toEmails: JSON.stringify([businessNumber]),
            subject,
            bodyText: bodyText.slice(0, 50000),
            sentAt,
            classification: classificationLabel,
            classificationReason,
            classificationAt: classificationLabel ? new Date() : null,
          },
        });
        const sourceExternalId = `whatsapp:message:${createdMessage.id}`;
        const messagePayload = {
          messageId: createdMessage.id,
          threadId: localThread.id,
          whatsappMessageId: message.id,
          phoneNumberId,
          direction: "INBOUND",
          fromEmail: senderAddress,
          fromName: contactName,
          subject,
          sentAt,
          classification: classificationLabel,
          classificationReason,
        };
        const memoryObject = await ingestKnowledgeObject({
          officeId,
          sourceType: "WHATSAPP",
          sourceExternalId,
          sourceLabel: account.email,
          sourceMetadata: { accountId: account.id, provider: "WHATSAPP", phoneNumberId },
          canonicalType: "email_message",
          title: subject,
          text: [subject, senderAddress, contactName, bodyText.slice(0, 8000)].filter(Boolean).join("\n"),
          entityType: "email_message",
          entityId: createdMessage.id,
          jobId: localThread.jobId,
          inquiryId: localThread.inquiryId,
          emailThreadId: localThread.id,
          emailMessageId: createdMessage.id,
          occurredAt: sentAt,
          payload: messagePayload,
          provenance: {
            source: "whatsapp",
            operation: "message_ingest",
            path: "src/lib/whatsapp.ts",
            function: "ingestWhatsAppWebhook",
            sourceRecordId: createdMessage.id,
            sourceExternalId: message.id,
          },
        }).catch(() => null);
        await recordMemoryEvent({
          officeId,
          sourceType: "WHATSAPP",
          sourceExternalId,
          sourceLabel: account.email,
          sourceMetadata: { accountId: account.id, provider: "WHATSAPP", phoneNumberId },
          objectId: memoryObject?.id ?? null,
          eventType: "whatsapp.message.ingested",
          entityType: "email_message",
          entityId: createdMessage.id,
          occurredAt: sentAt,
          payloadVersion: 1,
          payload: messagePayload,
          provenance: {
            source: "whatsapp",
            operation: "message_ingest",
            path: "src/lib/whatsapp.ts",
            function: "ingestWhatsAppWebhook",
            sourceRecordId: createdMessage.id,
            sourceExternalId: message.id,
          },
          idempotencyKey: `whatsapp:message:${createdMessage.id}:ingested`,
        }).catch(() => null);

        await prisma.emailThread.update({
          where: { id: localThread.id },
          data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
        });

        touchedThreadIds.add(localThread.id);
        created++;

        // Auto-read (blue ticks) — opt-in via WHATSAPP_AUTO_READ_ENABLED.
        // Best-effort: a provider hiccup must not fail webhook ingest.
        if (whatsAppAutoReadEnabled()) {
          await markWhatsAppMessageRead({
            messageId: message.id,
            phoneNumberId,
            senderDigits: message.from.replace(/\D/g, ""),
          }).catch(() => null);
        }
      }
    }
  }

  for (const threadId of touchedThreadIds) {
    const thread = await prisma.emailThread.findFirst({
      where: { id: threadId, officeId, jobId: null, inquiryId: null, autoLinkedAt: null },
      select: { id: true },
    });
    if (!thread) continue;
    try {
      const result = await autoCreateInquiryFromThread(thread.id);
      if ("ok" in result) {
        if (result.created) autoInquiries++;
        else if ("linkedInquiryId" in result || "linkedJobId" in result) autoLinked++;
      }
    } catch {
      // The message is still stored; auto-link can be retried from the inbox.
    }
  }

  await prisma.emailAccount.updateMany({
    where: { officeId, provider: "WHATSAPP" },
    data: { lastSyncAt: new Date() },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/settings/email");

  return {
    ok: true,
    processed,
    created,
    threadsTouched: touchedThreadIds.size,
    autoInquiries,
    autoLinked,
  };
}

export async function sendWhatsAppText(args: {
  to: string;
  body: string;
  phoneNumberId?: string;
}): Promise<{ ok: true; providerMessageId: string | null } | { error: string }> {
  const toDigits = args.to.replace(/[^\d]/g, "");
  if (!toDigits) return { error: "A recipient phone number is required." };
  if (!args.body.trim()) return { error: "Message body is required." };

  if (whatsAppProvider() === "greenapi") {
    const green = greenApiConfig();
    if (!green) return { error: "GREEN_API_ID_INSTANCE / GREEN_API_TOKEN are not configured." };

    const res = await fetch(
      `${green.baseUrl}/waInstance${green.idInstance}/sendMessage/${green.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: `${toDigits}@c.us`, message: args.body }),
      },
    );
    const responseBody = await res.text();
    if (!res.ok) {
      return { error: `WhatsApp send failed: ${res.status} ${responseBody.slice(0, 300)}` };
    }
    let parsedGreen: unknown = null;
    try {
      parsedGreen = JSON.parse(responseBody);
    } catch {
      // Green API returned 2xx; keep going without a provider id.
    }
    const idMessage =
      parsedGreen && typeof parsedGreen === "object" && "idMessage" in parsedGreen
        ? String((parsedGreen as { idMessage: unknown }).idMessage ?? "")
        : "";
    return { ok: true, providerMessageId: idMessage || null };
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = args.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v23.0";

  if (!accessToken) return { error: "WHATSAPP_ACCESS_TOKEN is not configured." };
  if (!phoneNumberId) return { error: "WHATSAPP_PHONE_NUMBER_ID is not configured." };

  const to = toDigits;

  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: args.body },
    }),
  });

  const responseBody = await res.text();
  if (!res.ok) {
    return { error: `WhatsApp send failed: ${res.status} ${responseBody.slice(0, 300)}` };
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    // Meta returned 2xx; keep going without a provider id.
  }

  return { ok: true, providerMessageId: parsed?.messages?.[0]?.id ?? null };
}
