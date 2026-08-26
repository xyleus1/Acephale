import "server-only";

import { CONNECTED_GMAIL_ACCOUNT_FILTER } from "@/lib/email-account-connection";
import { MAX_EMAIL_DAILY_SEND_LIMIT, validEmailDailySendLimit } from "@/lib/email-sender-pool-policy";
import { prisma } from "@/lib/prisma";

export type EmailSenderPoolSettingsInput = {
  accountIds: string[];
  sendEnabled?: boolean;
  dailySendLimit?: number;
};

// The pool is shared across offices, so a sender-pool change applies to the
// mailbox itself instead of one office copy of it.
export async function updateSharedEmailSenderPoolAccounts(input: EmailSenderPoolSettingsInput) {
  const accountIds = [...new Set(
    Array.isArray(input.accountIds)
      ? input.accountIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 220)
      : [],
  )].slice(0, 100);
  if (accountIds.length === 0) {
    return { ok: false as const, error: "Select at least one email account." };
  }
  if (input.sendEnabled !== undefined && typeof input.sendEnabled !== "boolean") {
    return { ok: false as const, error: "Invalid sender-pool state." };
  }
  if (input.dailySendLimit !== undefined && !validEmailDailySendLimit(input.dailySendLimit)) {
    return { ok: false as const, error: `Daily limit must be between 1 and ${MAX_EMAIL_DAILY_SEND_LIMIT}.` };
  }
  if (input.sendEnabled === undefined && input.dailySendLimit === undefined) {
    return { ok: false as const, error: "Choose a sender-pool change." };
  }

  const data: { sendEnabled?: boolean; isDefaultSender?: boolean; dailySendLimit?: number } = {};
  if (input.sendEnabled !== undefined) {
    data.sendEnabled = input.sendEnabled;
    if (!input.sendEnabled) data.isDefaultSender = false;
  }
  if (input.dailySendLimit !== undefined) data.dailySendLimit = input.dailySendLimit;

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.emailAccount.updateMany({
        where: {
          id: { in: accountIds },
          isActive: true,
          ...CONNECTED_GMAIL_ACCOUNT_FILTER,
        },
        data,
      });
      if (updated.count !== accountIds.length) {
        throw new Error("The selected sender accounts changed before the update completed.");
      }
    });
  } catch {
    return { ok: false as const, error: "No accounts were changed. Reload and select connected, active Gmail accounts." };
  }

  return { ok: true as const, count: accountIds.length };
}
