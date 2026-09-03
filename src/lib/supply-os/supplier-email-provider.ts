import "server-only";

import { stripEmDashes } from "@/lib/no-em-dash";
import {
  buildMimeMessage,
  encodeGmailRawMessage,
  type OutboundEmailAttachment,
} from "@/lib/outbound-email-attachments";
import { prisma } from "@/lib/prisma";
import {
  GMAIL_APP_PASSWORD_PROVIDER,
  gmailImapClient,
  readGmailAppPasswordAccount,
  sendGmailAppPasswordMail,
} from "@/lib/gmail-app-password";
import { imapThreadExternalId } from "@/lib/imap-identifiers";
import {
  buildCampaignFromHeader,
  normalizeCampaignSenderDisplayName,
} from "@/lib/outreach-campaign-copy";

export type SupplierEmailSendInput = {
  officeId: string;
  accountId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
  rfcMessageId: string;
  providerThreadId?: string | null;
  inReplyToRfcMessageId?: string | null;
  attachments?: readonly OutboundEmailAttachment[];
  senderDisplayName?: string | null;
};

export type SupplierEmailSent = {
  state: "SENT";
  provider: "GMAIL";
  providerMessageId: string;
  providerThreadId: string;
  sourceUrl: string;
};

export type SupplierEmailSendResult = SupplierEmailSent | {
  state: "REJECTED" | "UNKNOWN";
  error: string;
  needsReauth?: boolean;
};

export type SupplierEmailReconcileResult = SupplierEmailSent | {
  state: "NOT_FOUND" | "UNKNOWN";
  error?: string;
};

export type SupplierEmailProvider = {
  send(input: SupplierEmailSendInput): Promise<SupplierEmailSendResult>;
  reconcile(input: Pick<SupplierEmailSendInput, "officeId" | "accountId" | "senderEmail" | "rfcMessageId">): Promise<SupplierEmailReconcileResult>;
};

type GmailAccountIdentity = { id: string; email: string };

type GmailSupplierEmailProviderDependencies = {
  account: (officeId: string, accountId: string, expectedEmail: string) => Promise<GmailAccountIdentity>;
  sendAccount: (officeId: string, accountId: string, expectedEmail: string) => Promise<GmailAccountIdentity>;
  token: (accountId: string) => Promise<string>;
  request: typeof fetch;
};

function cleanHeader(value: string) {
  return stripEmDashes(value).replace(/[\r\n]+/g, " ").trim();
}

export const SENDER_PAUSED_ERROR = "The selected Gmail sender is paused by sender protection.";

// Sender-side policy refusals (disabled, paused) are not credential problems.
function senderRefusalNeedsReauth(message: string) {
  return !message.includes("disabled for sending") && message !== SENDER_PAUSED_ERROR;
}

async function gmailAccount(_officeId: string, accountId: string, expectedEmail: string) {
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, provider: "GMAIL", isActive: true },
    select: { id: true, email: true },
  });
  if (!account) throw new Error("The selected Gmail sender is missing or inactive.");
  if (account.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    throw new Error("The connected Gmail sender changed after approval. Save and approve a new email draft.");
  }
  return account;
}

async function gmailSendAccount(_officeId: string, accountId: string, expectedEmail: string) {
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, provider: "GMAIL", isActive: true },
    select: { id: true, email: true, sendEnabled: true, sendPausedAt: true },
  });
  if (!account) throw new Error("The selected Gmail sender is missing or inactive.");
  if (!account.sendEnabled) throw new Error("The selected Gmail sender is disabled for sending.");
  if (account.sendPausedAt) throw new Error(SENDER_PAUSED_ERROR);
  if (account.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    throw new Error("The connected Gmail sender changed after approval. Save and approve a new email draft.");
  }
  return account;
}

async function gmailToken(accountId: string) {
  try {
    const { getValidAccessToken } = await import("@/lib/gmail-oauth");
    return await getValidAccessToken(accountId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "The Gmail sender must be reconnected.");
  }
}

function gmailSourceUrl(accountEmail: string, threadId: string) {
  return `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#sent/${encodeURIComponent(threadId)}`;
}

function gmailMessageSearchUrl(accountEmail: string, rfcMessageId: string) {
  return `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#search/${encodeURIComponent(`rfc822msgid:${rfcMessageId}`)}`;
}

export function createGmailSupplierEmailProvider(
  dependencies: Partial<GmailSupplierEmailProviderDependencies> = {},
): SupplierEmailProvider {
  const accountForSend = dependencies.sendAccount ?? dependencies.account ?? gmailSendAccount;
  const accountForReconcile = dependencies.account ?? gmailAccount;
  const tokenFor = dependencies.token ?? gmailToken;
  const request = dependencies.request ?? fetch;
  return {
  async send(input) {
    let account: GmailAccountIdentity;
    let token: string;
    try {
      account = await accountForSend(input.officeId, input.accountId, input.senderEmail);
      token = await tokenFor(account.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Gmail sender is unavailable.";
      return {
        state: "REJECTED",
        error: message,
        ...(senderRefusalNeedsReauth(message) ? { needsReauth: true } : {}),
      };
    }

    const headers = [
      `From: ${buildCampaignFromHeader(cleanHeader(account.email), normalizeCampaignSenderDisplayName(cleanHeader(input.senderDisplayName ?? "")))}`,
      `To: ${cleanHeader(input.recipient)}`,
      `Subject: ${cleanHeader(input.subject)}`,
      `Message-ID: ${cleanHeader(input.rfcMessageId)}`,
      ...(input.inReplyToRfcMessageId ? [
        `In-Reply-To: ${cleanHeader(input.inReplyToRfcMessageId)}`,
        `References: ${cleanHeader(input.inReplyToRfcMessageId)}`,
      ] : []),
    ];
    let raw: string;
    try {
      raw = encodeGmailRawMessage(buildMimeMessage({
        headers,
        text: stripEmDashes(input.body),
        attachments: input.attachments,
      }));
    } catch (error) {
      return {
        state: "REJECTED",
        error: error instanceof Error ? error.message : "The message attachments could not be prepared.",
      };
    }
    let response: Response;
    try {
      response = await request("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          raw,
          ...(input.providerThreadId ? { threadId: cleanHeader(input.providerThreadId) } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      return { state: "UNKNOWN", error: error instanceof Error ? error.message : "Gmail did not return a delivery result." };
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      if (response.status === 401 || response.status === 403) {
        return { state: "REJECTED", error: "Gmail send permission is missing. Reconnect the selected inbox.", needsReauth: true };
      }
      if (response.status === 429 || response.status >= 500) {
        return { state: "UNKNOWN", error: `Gmail returned ${response.status}. Reconcile before retrying. ${detail}`.trim() };
      }
      return { state: "REJECTED", error: `Gmail rejected the message with ${response.status}. ${detail}`.trim() };
    }
    const sent = await response.json().catch(() => null) as { id?: string; threadId?: string } | null;
    if (!sent?.id || !sent.threadId) {
      return { state: "UNKNOWN", error: "Gmail accepted the request without a complete delivery receipt." };
    }
    return {
      state: "SENT",
      provider: "GMAIL",
      providerMessageId: sent.id,
      providerThreadId: sent.threadId,
      sourceUrl: gmailSourceUrl(account.email, sent.threadId),
    };
  },

  async reconcile(input) {
    let account: GmailAccountIdentity;
    let token: string;
    try {
      account = await accountForReconcile(input.officeId, input.accountId, input.senderEmail);
      token = await tokenFor(account.id);
    } catch (error) {
      return { state: "UNKNOWN", error: error instanceof Error ? error.message : "The Gmail sender is unavailable." };
    }
    const query = new URLSearchParams({
      q: `in:sent rfc822msgid:${input.rfcMessageId}`,
      maxResults: "10",
      fields: "messages(id,threadId)",
    });
    let response: Response;
    try {
      response = await request(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      return { state: "UNKNOWN", error: error instanceof Error ? error.message : "Gmail reconciliation did not finish." };
    }
    if (!response.ok) {
      return { state: "UNKNOWN", error: `Gmail reconciliation returned ${response.status}.` };
    }
    const result = await response.json().catch(() => null) as { messages?: Array<{ id?: string; threadId?: string }> } | null;
    const sent = result?.messages?.find((message) => message.id && message.threadId);
    if (!sent?.id || !sent.threadId) return { state: "NOT_FOUND" };
    return {
      state: "SENT",
      provider: "GMAIL",
      providerMessageId: sent.id,
      providerThreadId: sent.threadId,
      sourceUrl: gmailSourceUrl(account.email, sent.threadId),
    };
  },
  };
}

const oauthGmailSupplierEmailProvider = createGmailSupplierEmailProvider();

async function gmailAppPasswordAccount(input: {
  officeId: string;
  accountId: string;
  expectedEmail: string;
  requireSendEnabled: boolean;
}) {
  const account = await prisma.emailAccount.findFirst({
    where: {
      id: input.accountId,
      provider: GMAIL_APP_PASSWORD_PROVIDER,
      isActive: true,
      credentialSecret: { not: null },
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      credentialSecret: true,
      sendEnabled: true,
      sendPausedAt: true,
    },
  });
  if (!account) throw new Error("The selected Gmail app-password sender is missing or inactive.");
  if (input.requireSendEnabled && !account.sendEnabled) {
    throw new Error("The selected Gmail app-password sender is disabled for sending.");
  }
  if (input.requireSendEnabled && account.sendPausedAt) throw new Error(SENDER_PAUSED_ERROR);
  if (account.email.trim().toLowerCase() !== input.expectedEmail.trim().toLowerCase()) {
    throw new Error("The connected Gmail sender changed after approval. Save and approve a new email draft.");
  }
  return account;
}

const gmailAppPasswordSupplierEmailProvider: SupplierEmailProvider = {
  async send(input) {
    let account;
    try {
      account = await gmailAppPasswordAccount({
        officeId: input.officeId,
        accountId: input.accountId,
        expectedEmail: input.senderEmail,
        requireSendEnabled: true,
      });
    } catch (caught) {
      return {
        state: "REJECTED",
        error: caught instanceof Error ? caught.message : "The Gmail sender is unavailable.",
      };
    }

    const references = input.inReplyToRfcMessageId ? [input.inReplyToRfcMessageId] : [];
    let sent: Awaited<ReturnType<typeof sendGmailAppPasswordMail>>;
    try {
      const senderDisplayName = normalizeCampaignSenderDisplayName(cleanHeader(input.senderDisplayName ?? ""));
      sent = await sendGmailAppPasswordMail({
        account,
        ...(senderDisplayName ? { from: { name: senderDisplayName, address: account.email } } : {}),
        to: cleanHeader(input.recipient),
        subject: cleanHeader(input.subject),
        text: stripEmDashes(input.body),
        messageId: cleanHeader(input.rfcMessageId),
        inReplyTo: input.inReplyToRfcMessageId ? cleanHeader(input.inReplyToRfcMessageId) : null,
        references,
        attachments: input.attachments,
      });
    } catch (error) {
      return {
        state: "REJECTED",
        error: error instanceof Error ? error.message : "The message attachments could not be prepared.",
      };
    }
    if (!sent.ok) {
      const authFailure = /authentication|app password/i.test(sent.error);
      return {
        state: authFailure ? "REJECTED" : "UNKNOWN",
        error: sent.error,
        ...(authFailure ? { needsReauth: true } : {}),
      };
    }
    const providerThreadId = input.providerThreadId || imapThreadExternalId({
      accountId: account.id,
      messageId: input.rfcMessageId,
      references: input.inReplyToRfcMessageId,
      subject: input.subject,
    });
    return {
      state: "SENT",
      provider: "GMAIL",
      providerMessageId: input.rfcMessageId,
      providerThreadId,
      sourceUrl: gmailMessageSearchUrl(account.email, input.rfcMessageId),
    };
  },

  async reconcile(input) {
    let account;
    try {
      account = await gmailAppPasswordAccount({
        officeId: input.officeId,
        accountId: input.accountId,
        expectedEmail: input.senderEmail,
        requireSendEnabled: false,
      });
    } catch (caught) {
      return { state: "UNKNOWN", error: caught instanceof Error ? caught.message : "The Gmail sender is unavailable." };
    }

    let credentials;
    try {
      credentials = readGmailAppPasswordAccount(account);
    } catch (caught) {
      return { state: "UNKNOWN", error: caught instanceof Error ? caught.message : "The Gmail credential is unavailable." };
    }
    const client = gmailImapClient(credentials);
    try {
      await client.connect();
      const mailboxes = await client.list();
      const sentMailbox = mailboxes.find((mailbox) => mailbox.specialUse?.toLowerCase() === "\\sent")
        ?? mailboxes.find((mailbox) => /(^|\/)sent( mail)?$/i.test(mailbox.path));
      if (!sentMailbox) return { state: "UNKNOWN", error: "Gmail Sent Mail was not found." };
      await client.mailboxOpen(sentMailbox.path, { readOnly: true });
      const matches = await client.search({ header: { "Message-ID": input.rfcMessageId } }, { uid: true });
      if (!matches || matches.length === 0) return { state: "NOT_FOUND" };
      return {
        state: "SENT",
        provider: "GMAIL",
        providerMessageId: input.rfcMessageId,
        providerThreadId: imapThreadExternalId({ accountId: account.id, messageId: input.rfcMessageId }),
        sourceUrl: gmailMessageSearchUrl(account.email, input.rfcMessageId),
      };
    } catch {
      return { state: "UNKNOWN", error: "Gmail reconciliation did not finish." };
    } finally {
      if (client.usable) await client.logout().catch(() => undefined);
      else client.close();
    }
  },
};

async function configuredSupplierEmailProvider(input: Pick<SupplierEmailSendInput, "officeId" | "accountId">) {
  const account = await prisma.emailAccount.findFirst({
    where: { id: input.accountId },
    select: { provider: true },
  });
  return account?.provider === GMAIL_APP_PASSWORD_PROVIDER
    ? gmailAppPasswordSupplierEmailProvider
    : oauthGmailSupplierEmailProvider;
}

export const gmailSupplierEmailProvider: SupplierEmailProvider = {
  async send(input) {
    return (await configuredSupplierEmailProvider(input)).send(input);
  },
  async reconcile(input) {
    return (await configuredSupplierEmailProvider(input)).reconcile(input);
  },
};
