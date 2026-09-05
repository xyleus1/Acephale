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
import { MAX_BULK_GMAIL_ACCOUNTS, parseGmailAppPasswordBulkInput } from "@/lib/gmail-app-password-bulk";
import { updateSharedEmailSenderPoolAccounts } from "@/lib/email-sender-pool-settings";
import { resumeSenderAccount } from "@/lib/email-delivery-events";

const BULK_CONNECT_CONCURRENCY = 6;

function revalidateEmailAccountPages() {
  revalidatePath("/dashboard/settings/email");
  revalidatePath("/dashboard/settings/connected-emails");
}

// Mailboxes are a shared pool, so an administrator manages every connected
// account regardless of the office that first connected it.
async function emailSender(accountId: string) {
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 220) return null;
  return prisma.emailAccount.findFirst({
    where: {
      id: accountId,
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
  await requireEmailAccountAdminSession();
  if (typeof enabled !== "boolean") throw new Error("Invalid sending state.");
  const account = await emailSender(accountId);
  if (!account) throw new Error("The email account must be connected before sending can be enabled.");
  if (enabled && !account.isActive) throw new Error("Resume monitoring before enabling this sender.");

  const updated = await prisma.emailAccount.updateMany({
    where: enabled
      ? {
          id: account.id,
          isActive: true,
          OR: [
            { provider: "GMAIL", refreshToken: { not: null } },
            { provider: GMAIL_APP_PASSWORD_PROVIDER, credentialSecret: { not: null } },
          ],
        }
      : { id: account.id },
    data: enabled
      ? { sendEnabled: true }
      : { sendEnabled: false, isDefaultSender: false },
  });
  if (updated.count !== 1) throw new Error("The email account changed before it could be updated.");

  revalidateEmailAccountPages();
}

export async function updateEmailSenderPoolAccounts(input: {
  accountIds: string[];
  sendEnabled?: boolean;
  dailySendLimit?: number;
}) {
  await requireEmailAccountAdminSession();
  const result = await updateSharedEmailSenderPoolAccounts(input);
  if (!result.ok) return result;
  revalidateEmailAccountPages();
  return result;
}

export async function resumeSenderPoolAccount(input: { accountId: string }) {
  await requireEmailAccountAdminSession();
  const accountId = typeof input?.accountId === "string" ? input.accountId.trim() : "";
  if (!accountId || accountId.length > 220) return { resumed: false };
  const resumed = await resumeSenderAccount(accountId);
  if (resumed) revalidateEmailAccountPages();
  return { resumed };
}

export async function makeDefaultEmailSender(accountId: string) {
  await requireEmailAccountAdminSession();
  const account = await emailSender(accountId);
  if (!account?.isActive || !account.sendEnabled) {
    throw new Error("Enable sending on an active email account before making it the default.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.emailAccount.updateMany({
      where: { isDefaultSender: true },
      data: { isDefaultSender: false },
    });
    const selected = await tx.emailAccount.updateMany({
      where: {
        id: account.id,
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

  const existing = await prisma.emailAccount.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
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
        where: { id: existing.id },
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

export async function addGmailAppPasswordAccountsBulk(formData: FormData) {
  const session = await requireEmailAccountAdminSession();
  const parsed = parseGmailAppPasswordBulkInput(formValue(formData, "accounts"));
  if (parsed.errors.length > 0) {
    return { ok: false as const, errors: parsed.errors, results: [], accountIds: [] };
  }

  const existing = await prisma.emailAccount.findMany({
    where: { email: { in: parsed.rows.map((row) => row.email) } },
    select: { id: true, email: true, provider: true },
  });
  const existingByEmail = new Map(existing.map((account) => [account.email.toLowerCase(), account]));

  let encryptedRows: Array<(typeof parsed.rows)[number] & { credentialSecret: string }>;
  try {
    encryptedRows = parsed.rows.map((row) => ({ ...row, credentialSecret: encryptSecret(row.appPassword) }));
  } catch {
    return { ok: false as const, errors: ["Server credential encryption is not configured."], results: [], accountIds: [] };
  }

  const connectRow = async (row: (typeof encryptedRows)[number]) => {
    const current = existingByEmail.get(row.email);
    if (current && current.provider !== GMAIL_APP_PASSWORD_PROVIDER) {
      return { email: row.email, ok: false as const, error: "Already connected through another provider." };
    }
    const verified = await verifyGmailAppPasswordConnection(row);
    if (!verified.ok) return { email: row.email, ok: false as const, error: verified.error };

    try {
      const account = current
        ? await prisma.emailAccount.update({
            where: { id: current.id },
            data: {
              displayName: row.displayName,
              credentialSecret: row.credentialSecret,
              isActive: true,
            },
            select: { id: true },
          })
        : await prisma.emailAccount.create({
            data: {
              officeId: session.officeId,
              email: row.email,
              displayName: row.displayName,
              provider: GMAIL_APP_PASSWORD_PROVIDER,
              credentialSecret: row.credentialSecret,
              isActive: true,
              sendEnabled: false,
              isDefaultSender: false,
            },
            select: { id: true },
          });
      return { email: row.email, ok: true as const, accountId: account.id };
    } catch {
      return { email: row.email, ok: false as const, error: "Verified, but the account could not be saved." };
    }
  };

  const results: Array<Awaited<ReturnType<typeof connectRow>>> = [];
  for (let index = 0; index < encryptedRows.length; index += BULK_CONNECT_CONCURRENCY) {
    const slice = encryptedRows.slice(index, index + BULK_CONNECT_CONCURRENCY);
    results.push(...(await Promise.all(slice.map(connectRow))));
  }

  revalidateEmailAccountPages();
  const accountIds = results.flatMap((result) => result.ok ? [result.accountId] : []);
  return {
    ok: accountIds.length > 0,
    errors: [],
    results,
    accountIds,
  };
}

export async function enableBulkEmailAccounts(accountIds: string[]) {
  await requireEmailAccountAdminSession();
  const ids = [...new Set(accountIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 220))].slice(0, MAX_BULK_GMAIL_ACCOUNTS);
  if (ids.length === 0) return { ok: false as const, error: "No verified accounts selected." };

  const enabled = await prisma.$transaction(async (tx) => {
    const result = await tx.emailAccount.updateMany({
      where: {
        id: { in: ids },
        provider: GMAIL_APP_PASSWORD_PROVIDER,
        credentialSecret: { not: null },
        isActive: true,
      },
      data: { sendEnabled: true },
    });
    const currentDefault = await tx.emailAccount.findFirst({
      where: { isActive: true, sendEnabled: true, isDefaultSender: true },
      select: { id: true },
    });
    let defaultAccountId = currentDefault?.id ?? null;
    if (!defaultAccountId) {
      const selected = await tx.emailAccount.updateMany({
        where: {
          id: ids[0],
          provider: GMAIL_APP_PASSWORD_PROVIDER,
          credentialSecret: { not: null },
          isActive: true,
          sendEnabled: true,
        },
        data: { isDefaultSender: true },
      });
      if (selected.count === 1) defaultAccountId = ids[0];
    }
    return { count: result.count, defaultAccountId };
  });

  revalidateEmailAccountPages();
  if (enabled.count !== ids.length) {
    return { ok: false as const, error: `Enabled ${enabled.count} of ${ids.length} verified accounts.` };
  }
  return { ok: true as const, count: enabled.count, defaultAccountId: enabled.defaultAccountId };
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
