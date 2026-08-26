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

export const SHARED_SENDER_POOL_FILTER = {
  ...SHARED_MAILBOX_POOL_FILTER,
  sendEnabled: true,
} satisfies Prisma.EmailAccountWhereInput;
