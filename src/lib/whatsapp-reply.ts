"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { prisma } from "./prisma";
import { waDigitsFromWhatsAppAddress } from "./rfq-whatsapp";
import { logOutboundWhatsAppMessage, sendWhatsAppText, whatsAppSendConfigured } from "./whatsapp";

// Send an operator-approved reply into a WhatsApp inbox thread through the
// CRM's Cloud API number. The counterparty is derived server-side from the
// thread — the client only supplies the text, never the recipient.
export async function sendWhatsAppReplyToThread(args: {
  threadDbId: string;
  body: string;
}): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  if (!whatsAppSendConfigured()) {
    return { error: "CRM WhatsApp sending is not configured — set WHATSAPP_SEND_ENABLED and the Cloud API credentials." };
  }
  const body = args.body.trim();
  if (!body) return { error: "Message body is required." };

  const thread = await prisma.emailThread.findFirst({
    where: { id: args.threadDbId, officeId: session.officeId },
    include: { messages: { orderBy: { sentAt: "desc" }, take: 50 } },
  });
  if (!thread) return { error: "Thread not found." };

  // Counterparty digits: the thread's externalThreadId is
  // "whatsapp:<phoneNumberId>:<counterpartyDigits>"; fall back to the most
  // recent inbound sender for threads created before that convention.
  let digits: string | null = null;
  if (thread.externalThreadId?.startsWith("whatsapp:")) {
    const tail = thread.externalThreadId.split(":")[2]?.replace(/\D/g, "") ?? "";
    digits = tail.length >= 10 ? tail : null;
  }
  if (!digits) {
    const inbound = thread.messages.find(
      (m) => m.direction === "INBOUND" && m.fromEmail.startsWith("whatsapp:"),
    );
    digits = waDigitsFromWhatsAppAddress(inbound?.fromEmail ?? null);
  }
  if (!digits) return { error: "This thread has no WhatsApp counterparty to reply to." };

  const sent = await sendWhatsAppText({ to: digits, body });
  if ("error" in sent) return sent;

  try {
    await logOutboundWhatsAppMessage({
      officeId: session.officeId,
      to: digits,
      body,
      providerMessageId: sent.providerMessageId,
      threadId: thread.id,
    });
  } catch {
    // The message already left our hands; a logging failure must not
    // surface as "not sent" or the operator would send a duplicate.
  }

  // Replying implies the operator has read the conversation.
  await prisma.emailMessage.updateMany({
    where: { threadId: thread.id, direction: "INBOUND", isRead: false },
    data: { isRead: true },
  }).catch(() => null);

  revalidatePath("/dashboard/inbox");
  if (thread.inquiryId) revalidatePath(`/dashboard/rfq/${thread.inquiryId}`);
  return { ok: true };
}
