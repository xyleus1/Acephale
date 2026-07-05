"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  buildDeskForwardEmail,
  buildLeadConfirmationEmail,
  claimInquirySendStamp,
  clearInquirySendStamp,
  isSingleEmailAddress,
  isUnforwarded,
  pendingDeskForwardWhere,
  sendRfqMail,
  type SendStampKey,
} from "@/lib/rfq-mail";

const INQUIRY_MAIL_INCLUDE = {
  company: { select: { name: true } },
  emailThreads: {
    take: 1,
    select: {
      messages: {
        take: 1,
        select: { account: { select: { email: true, provider: true } } },
      },
    },
  },
} as const;

async function loadInquiry(inquiryId: string) {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: INQUIRY_MAIL_INCLUDE,
  });
  return { session, inquiry };
}

// A stamp failure after a delivered email must NOT surface as an error —
// the operator would retry and the recipient would get a duplicate.
async function stampAfterSend(inquiryId: string, key: SendStampKey): Promise<void> {
  try {
    await claimInquirySendStamp(inquiryId, key);
  } catch {
    // Sent-state will simply show as unsent; preferable to a duplicate send.
  }
}

export async function sendDeskForwardAction(
  inquiryId: string,
): Promise<{ ok: true } | { error: string }> {
  const { session, inquiry } = await loadInquiry(inquiryId);
  if (!inquiry) return { error: "RFQ not found." };

  const email = buildDeskForwardEmail(inquiry);
  const result = await sendRfqMail({
    officeId: session.officeId,
    inquiryId: inquiry.id,
    to: email.to,
    cc: email.cc,
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.text,
  });
  if ("error" in result) return result;

  await stampAfterSend(inquiry.id, "deskForwardedAt");
  revalidatePath("/dashboard/rfq");
  return { ok: true };
}

export async function sendLeadConfirmationAction(
  inquiryId: string,
): Promise<{ ok: true } | { error: string }> {
  const { session, inquiry } = await loadInquiry(inquiryId);
  if (!inquiry) return { error: "RFQ not found." };
  if (!isSingleEmailAddress(inquiry.fromEmail)) {
    return { error: "Sender email is missing or not a single valid address — fix it on the RFQ first." };
  }

  const email = buildLeadConfirmationEmail(inquiry);
  const result = await sendRfqMail({
    officeId: session.officeId,
    inquiryId: inquiry.id,
    to: inquiry.fromEmail,
    cc: email.cc,
    replyTo: email.replyTo,
    subject: email.subject,
    text: email.text,
  });
  if ("error" in result) return result;

  await stampAfterSend(inquiry.id, "confirmationSentAt");
  revalidatePath("/dashboard/rfq");
  return { ok: true };
}

// Forward every open Meta-lead RFQ that has not been sent to the desk yet.
// Each row is claimed (CAS on the stamp) before sending, so overlapping
// invocations or a mid-batch per-row send skip instead of double-sending.
// Capped per invocation so one click can't hold the request open for minutes.
const SEND_ALL_CAP = 60;

export async function sendAllDeskForwardsAction(): Promise<
  { ok: true; sent: number; failed: number; skipped: number; remaining: number } | { error: string }
> {
  const session = await requireSession();
  const candidates = await prisma.inquiry.findMany({
    where: pendingDeskForwardWhere(session.officeId),
    include: INQUIRY_MAIL_INCLUDE,
    orderBy: { receivedAt: "desc" },
    take: 500,
  });

  const pending = candidates.filter(isUnforwarded);
  const batch = pending.slice(0, SEND_ALL_CAP);
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let firstError: string | null = null;

  for (const inquiry of batch) {
    try {
      const claim = await claimInquirySendStamp(inquiry.id, "deskForwardedAt");
      if (claim !== "claimed") {
        skipped++;
        continue;
      }

      const email = buildDeskForwardEmail(inquiry);
      const result = await sendRfqMail({
        officeId: session.officeId,
        inquiryId: inquiry.id,
        to: email.to,
        cc: email.cc,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
      });
      if ("error" in result) {
        await clearInquirySendStamp(inquiry.id, "deskForwardedAt");
        failed++;
        firstError = firstError ?? result.error;
        continue;
      }
      sent++;
    } catch (e) {
      failed++;
      firstError = firstError ?? (e instanceof Error ? e.message : String(e));
    }
  }

  revalidatePath("/dashboard/rfq");
  if (sent === 0 && failed > 0) return { error: firstError ?? "All sends failed." };
  return { ok: true, sent, failed, skipped, remaining: pending.length - batch.length };
}
