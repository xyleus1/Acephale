"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEmailAccountAdminSession } from "@/lib/email-account-access";
import { sendNewEmailFromAccount } from "@/lib/gmail-send";

async function gmailSender(accountId: string, officeId: string) {
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 220) return null;
  return prisma.emailAccount.findFirst({
    where: {
      id: accountId,
      officeId,
      provider: "GMAIL",
      refreshToken: { not: null },
    },
    select: {
      id: true,
      isActive: true,
      sendEnabled: true,
      isDefaultSender: true,
    },
  });
}

export async function setEmailAccountSendEnabled(accountId: string, enabled: boolean) {
  const session = await requireEmailAccountAdminSession();
  if (typeof enabled !== "boolean") throw new Error("Invalid sending state.");
  const account = await gmailSender(accountId, session.officeId);
  if (!account) throw new Error("The Gmail account must be connected before sending can be enabled.");
  if (enabled && !account.isActive) throw new Error("Resume monitoring before enabling this sender.");

  const updated = await prisma.emailAccount.updateMany({
    where: enabled
      ? {
          id: account.id,
          officeId: session.officeId,
          provider: "GMAIL",
          isActive: true,
          refreshToken: { not: null },
        }
      : { id: account.id, officeId: session.officeId },
    data: enabled
      ? { sendEnabled: true }
      : { sendEnabled: false, isDefaultSender: false },
  });
  if (updated.count !== 1) throw new Error("The Gmail account changed before it could be updated.");

  revalidatePath("/dashboard/settings/email");
}

export async function makeDefaultEmailSender(accountId: string) {
  const session = await requireEmailAccountAdminSession();
  const account = await gmailSender(accountId, session.officeId);
  if (!account?.isActive || !account.sendEnabled) {
    throw new Error("Enable sending on an active Gmail account before making it the default.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.emailAccount.updateMany({
      where: { officeId: session.officeId, isDefaultSender: true },
      data: { isDefaultSender: false },
    });
    const selected = await tx.emailAccount.updateMany({
      where: {
        id: account.id,
        officeId: session.officeId,
        provider: "GMAIL",
        isActive: true,
        sendEnabled: true,
      },
      data: { isDefaultSender: true },
    });
    if (selected.count !== 1) throw new Error("The Gmail account changed before it could become the default.");
  });

  revalidatePath("/dashboard/settings/email");
}

export async function sendEmailAccountTest(accountId: string) {
  const session = await requireEmailAccountAdminSession();
  const result = await sendNewEmailFromAccount({
    officeId: session.officeId,
    accountId,
    to: session.email,
    subject: "Derya sender test",
    body: "This message confirms that the selected Gmail account can send through Derya.",
  });
  if ("error" in result) return { ok: false as const, error: result.error };
  revalidatePath("/dashboard/settings/email");
  return { ok: true as const };
}
