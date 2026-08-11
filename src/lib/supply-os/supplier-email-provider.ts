import "server-only";

import { stripEmDashes } from "@/lib/no-em-dash";
import { prisma } from "@/lib/prisma";

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
  token: (accountId: string) => Promise<string>;
  request: typeof fetch;
};

function encodeGmailRaw(raw: string) {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function cleanHeader(value: string) {
  return stripEmDashes(value).replace(/[\r\n]+/g, " ").trim();
}

async function gmailAccount(officeId: string, accountId: string, expectedEmail: string) {
  const account = await prisma.emailAccount.findFirst({
    where: { id: accountId, officeId, provider: "GMAIL", isActive: true },
    select: { id: true, email: true },
  });
  if (!account) throw new Error("The selected Gmail sender is missing or inactive.");
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

export function createGmailSupplierEmailProvider(
  dependencies: Partial<GmailSupplierEmailProviderDependencies> = {},
): SupplierEmailProvider {
  const accountFor = dependencies.account ?? gmailAccount;
  const tokenFor = dependencies.token ?? gmailToken;
  const request = dependencies.request ?? fetch;
  return {
  async send(input) {
    let account: GmailAccountIdentity;
    let token: string;
    try {
      account = await accountFor(input.officeId, input.accountId, input.senderEmail);
      token = await tokenFor(account.id);
    } catch (error) {
      return { state: "REJECTED", error: error instanceof Error ? error.message : "The Gmail sender is unavailable.", needsReauth: true };
    }

    const headers = [
      `From: ${cleanHeader(account.email)}`,
      `To: ${cleanHeader(input.recipient)}`,
      `Subject: ${cleanHeader(input.subject)}`,
      `Message-ID: ${cleanHeader(input.rfcMessageId)}`,
      ...(input.inReplyToRfcMessageId ? [
        `In-Reply-To: ${cleanHeader(input.inReplyToRfcMessageId)}`,
        `References: ${cleanHeader(input.inReplyToRfcMessageId)}`,
      ] : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=\"UTF-8\"",
    ];
    const raw = encodeGmailRaw(`${headers.join("\r\n")}\r\n\r\n${stripEmDashes(input.body)}`);
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
      account = await accountFor(input.officeId, input.accountId, input.senderEmail);
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

export const gmailSupplierEmailProvider = createGmailSupplierEmailProvider();
