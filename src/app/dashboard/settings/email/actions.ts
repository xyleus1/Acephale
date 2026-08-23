"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireEmailAccountAdminSession } from "@/lib/email-account-access";
import { sendNewEmailFromAccount } from "@/lib/gmail-send";
import {
  GMAIL_APP_PASSWORD_PROVIDER,
  isValidGmailAppPassword,
  normalizeGmailAppPassword,
  verifyGmailAppPasswordConnection,
} from "@/lib/gmail-app-password";
import { encryptSecret } from "@/lib/security/crypto";

function revalidateEmailAccountPages() {
  revalidatePath("/dashboard/settings/email");
  revalidatePath("/dashboard/settings/connected-emails");
}

async function emailSender(accountId: string, officeId: string) {
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 220) return null;
  return prisma.emailAccount.findFirst({
    where: {
      id: accountId,
      officeId,
      OR: [
        { provider: "GMAIL", refreshToken: { not: null } },
        { provider: GMAIL_APP_PASSWORD_PROVIDER, credentialSecret: { not: null } },
      ],
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
  const account = await emailSender(accountId, session.officeId);
  if (!account) throw new Error("The email account must be connected before sending can be enabled.");
  if (enabled && !account.isActive) throw new Error("Resume monitoring before enabling this sender.");

  const updated = await prisma.emailAccount.updateMany({
    where: enabled
      ? {
          id: account.id,
          officeId: session.officeId,
          isActive: true,
          OR: [
            { provider: "GMAIL", refreshToken: { not: null } },
            { provider: GMAIL_APP_PASSWORD_PROVIDER, credentialSecret: { not: null } },
          ],
        }
      : { id: account.id, officeId: session.officeId },
    data: enabled
      ? { sendEnabled: true }
      : { sendEnabled: false, isDefaultSender: false },
  });
  if (updated.count !== 1) throw new Error("The email account changed before it could be updated.");

  revalidateEmailAccountPages();
}

export async function makeDefaultEmailSender(accountId: string) {
  const session = await requireEmailAccountAdminSession();
  const account = await emailSender(accountId, session.officeId);
  if (!account?.isActive || !account.sendEnabled) {
    throw new Error("Enable sending on an active email account before making it the default.");
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
        isActive: true,
        sendEnabled: true,
      },
      data: { isDefaultSender: true },
    });
    if (selected.count !== 1) throw new Error("The email account changed before it could become the default.");
  });

  revalidateEmailAccountPages();
}

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function addGmailAppPasswordAccount(formData: FormData) {
  const session = await requireEmailAccountAdminSession();
  const displayName = formValue(formData, "displayName").replace(/[\r\n]+/g, " ").slice(0, 120);
  const email = formValue(formData, "email").toLowerCase();
  const appPassword = normalizeGmailAppPassword(formValue(formData, "appPassword"));

  if (!displayName) return { ok: false as const, error: "Display name is required." };
  if (!/^[^\s@,;:\"<>()[\]]+@[^\s@,;:\"<>()[\]]+\.[A-Za-z]{2,}$/.test(email)) {
    return { ok: false as const, error: "Enter one valid email address." };
  }
  if (!isValidGmailAppPassword(appPassword)) {
    return { ok: false as const, error: "Enter the 16-character Gmail app password." };
  }

  const existing = await prisma.emailAccount.findUnique({
    where: { officeId_email: { officeId: session.officeId, email } },
    select: { id: true, provider: true },
  });
  if (existing && existing.provider !== GMAIL_APP_PASSWORD_PROVIDER) {
    return { ok: false as const, error: "This mailbox is already connected through another provider." };
  }

  let credentialSecret: string;
  try {
    credentialSecret = encryptSecret(appPassword);
  } catch {
    return { ok: false as const, error: "Server credential encryption is not configured." };
  }

  const verified = await verifyGmailAppPasswordConnection({ email, displayName, appPassword });
  if (!verified.ok) return verified;

  const account = existing
    ? await prisma.emailAccount.update({
        where: { id: existing.id, officeId: session.officeId },
        data: {
          displayName,
          credentialSecret,
          isActive: true,
          sendEnabled: false,
          isDefaultSender: false,
        },
        select: { id: true },
      })
    : await prisma.emailAccount.create({
        data: {
          officeId: session.officeId,
          email,
          displayName,
          provider: GMAIL_APP_PASSWORD_PROVIDER,
          credentialSecret,
          isActive: true,
          sendEnabled: false,
          isDefaultSender: false,
        },
        select: { id: true },
      });

  revalidateEmailAccountPages();
  return { ok: true as const, accountId: account.id };
}

export async function sendEmailAccountTest(accountId: string) {
  const session = await requireEmailAccountAdminSession();
  const result = await sendNewEmailFromAccount({
    officeId: session.officeId,
    accountId,
    to: session.email,
    subject: "Derya sender test",
    body: "This message confirms that the selected email account can send through Derya.",
  });
  if ("error" in result) return { ok: false as const, error: result.error };
  revalidateEmailAccountPages();
  return { ok: true as const };
}
