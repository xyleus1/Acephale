import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { classifyInboundEmail } from "./email-classifier";
import { autoCreateInquiryFromThread } from "./thread-actions";
import { ensureProposedJobsForOpenInquiries } from "./job-actions";

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
  if (!appSecret) return true;
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

        await prisma.emailMessage.create({
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

        await prisma.emailThread.update({
          where: { id: localThread.id },
          data: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
        });

        touchedThreadIds.add(localThread.id);
        created++;
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

  await ensureProposedJobsForOpenInquiries(officeId);
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
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = args.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v23.0";

  if (!accessToken) return { error: "WHATSAPP_ACCESS_TOKEN is not configured." };
  if (!phoneNumberId) return { error: "WHATSAPP_PHONE_NUMBER_ID is not configured." };

  const to = args.to.replace(/[^\d]/g, "");
  if (!to) return { error: "A recipient phone number is required." };
  if (!args.body.trim()) return { error: "Message body is required." };

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
