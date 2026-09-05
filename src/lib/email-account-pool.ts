import type { Prisma } from "@prisma/client";
import { CONNECTED_GMAIL_ACCOUNT_FILTER } from "@/lib/email-account-connection";

/**
 * Connected mailboxes are one shared pool for the whole app. Every office can
 * send from any connected mailbox, and a mailbox daily limit is counted across
 * all offices, so `EmailAccount.officeId` records only where a mailbox was
 * first connected and must not be used to scope mailbox lookups.
 *
 * Mail itself stays office scoped: outbound messages carry the sending office
 * and inbound mail is routed to the office that owns the thread.
 */
export const SHARED_MAILBOX_POOL_FILTER = {
  isActive: true,
  ...CONNECTED_GMAIL_ACCOUNT_FILTER,
} satisfies Prisma.EmailAccountWhereInput;

// A mailbox paused by sender protection (bounce or complaint spike) stays in
// the mailbox pool for inbound sync but leaves the sender pool until an
// operator resumes it.
export const SHARED_SENDER_POOL_FILTER = {
  ...SHARED_MAILBOX_POOL_FILTER,
  sendEnabled: true,
  sendPausedAt: null,
} satisfies Prisma.EmailAccountWhereInput;

export type SenderPoolMembershipAccount = {
  id: string;
  dailySendLimit: number;
  isActive: boolean;
  provider: string;
  refreshToken: string | null;
  credentialSecret: string | null;
  sendEnabled: boolean;
  sendPausedAt: Date | null;
};

export function senderPoolMembership<T extends SenderPoolMembershipAccount>(
  accounts: readonly T[],
) {
  const monitored = accounts.filter((account) => (
    account.isActive
    && (
      (account.provider === "GMAIL" && Boolean(account.refreshToken))
      || (account.provider === "GMAIL_APP_PASSWORD" && Boolean(account.credentialSecret))
    )
  ));
  return {
    monitored,
    enabledSenders: monitored.filter((account) => account.sendEnabled && !account.sendPausedAt),
    pausedBySenderProtection: monitored.filter((account) => account.sendEnabled && Boolean(account.sendPausedAt)),
  };
}
