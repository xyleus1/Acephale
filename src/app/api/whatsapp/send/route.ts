import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureWhatsAppAccount, sendWhatsAppText } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await requireSession();
  const input = await req.json().catch(() => null) as {
    to?: string;
    body?: string;
    threadId?: string;
  } | null;

  const to = input?.to?.trim() ?? "";
  const body = input?.body?.trim() ?? "";
  if (!to || !body) {
    return NextResponse.json({ error: "Both `to` and `body` are required." }, { status: 400 });
  }

  const sent = await sendWhatsAppText({ to, body });
  if ("error" in sent) {
    return NextResponse.json(sent, { status: 400 });
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    return NextResponse.json({ error: "WHATSAPP_PHONE_NUMBER_ID is not configured." }, { status: 400 });
  }

  const account = await ensureWhatsAppAccount({ officeId: session.officeId, phoneNumberId });
  const normalizedTo = to.replace(/[^\d]/g, "");
  const fromAddress = `whatsapp:${phoneNumberId}`;
  const toAddress = `whatsapp:${normalizedTo}`;

  let thread = input?.threadId
    ? await prisma.emailThread.findFirst({ where: { id: input.threadId, officeId: session.officeId } })
    : null;

  if (!thread) {
    const externalThreadId = `whatsapp:${phoneNumberId}:${normalizedTo}`;
    thread = await prisma.emailThread.findFirst({
      where: { officeId: session.officeId, externalThreadId },
    });
    if (!thread) {
      thread = await prisma.emailThread.create({
        data: {
          officeId: session.officeId,
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
      externalId: sent.providerMessageId,
      direction: "OUTBOUND",
      fromEmail: fromAddress,
      toEmails: JSON.stringify([toAddress]),
      subject: thread.subject,
      bodyText: body,
      sentAt: new Date(),
    },
  });
  await prisma.emailThread.updateMany({
    where: { id: thread.id, officeId: session.officeId },
    data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
  });

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/settings/email");
  if (thread.inquiryId) revalidatePath(`/dashboard/rfq/${thread.inquiryId}`);
  if (thread.jobId) revalidatePath(`/dashboard/jobs/${thread.jobId}`);

  return NextResponse.json({ ok: true, threadId: thread.id, providerMessageId: sent.providerMessageId });
}
