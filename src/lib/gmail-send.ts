"use server";

import { revalidatePath } from "next/cache";
import { stripEmDashes } from "./no-em-dash";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { getValidAccessToken } from "./gmail-oauth";
import { logEmailTouch } from "./crm/email-touch";
import {
  GMAIL_APP_PASSWORD_PROVIDER,
  sendGmailAppPasswordMail,
} from "./gmail-app-password";
import { imapMessageExternalId, imapThreadExternalId } from "./imap-identifiers";

function encodeGmailRaw(raw: string) {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendNewEmailFromAccount(args: {
  officeId: string;
  accountId: string;
  to: string;
  subject: string;
  body: string;
  inquiryId?: string | null;
  jobId?: string | null;
}): Promise<{ ok: true; messageId: string; threadId: string; localThreadId: string } | { error: string; needsReauth?: boolean }> {
  const account = await prisma.emailAccount.findFirst({
    where: { id: args.accountId, officeId: args.officeId, isActive: true, sendEnabled: true },
  });
  if (!account) return { error: "Sender account not found, inactive, or disabled for sending." };

  const toAddress = cleanHeader(args.to);
  const subject = stripEmDashes(cleanHeader(args.subject || "(no subject)"));
  const body = stripEmDashes(args.body);
  if (!toAddress) return { error: "Recipient is required." };
  if (!body.trim()) return { error: "Email body is required." };

  if (account.provider === GMAIL_APP_PASSWORD_PROVIDER) {
    const sent = await sendGmailAppPasswordMail({
      account,
      to: toAddress,
      subject,
      text: body,
    });
    if (!sent.ok) return { error: sent.error };

    const now = new Date();
    const externalThreadId = imapThreadExternalId({
      accountId: account.id,
      messageId: sent.messageId,
      subject,
    });
    const localThread = await prisma.emailThread.create({
      data: {
        officeId: args.officeId,
        inquiryId: args.inquiryId ?? null,
        jobId: args.jobId ?? null,
        subject,
        participants: JSON.stringify([account.email, toAddress]),
        externalThreadId,
        lastMessageAt: now,
        messageCount: 1,
      },
    });
    const outboundMessage = await prisma.emailMessage.create({
      data: {
        threadId: localThread.id,
        accountId: account.id,
        externalId: imapMessageExternalId(account.id, sent.messageId, Buffer.from(sent.messageId)),
        rfcMessageId: sent.messageId || null,
        direction: "OUTBOUND",
        fromEmail: account.email,
        fromName: account.displayName,
        toEmails: JSON.stringify([toAddress]),
        subject,
        bodyText: body,
        sentAt: now,
      },
    });
    await logEmailTouch({
      officeId: args.officeId,
      threadId: localThread.id,
      messageId: outboundMessage.id,
      direction: "OUTBOUND",
      fromEmail: account.email,
      toEmails: [toAddress],
      subject,
      snippet: body,
      sentAt: now,
    });

    revalidatePath("/dashboard/inbox");
    if (args.inquiryId) revalidatePath(`/dashboard/rfq/${args.inquiryId}`);
    if (args.jobId) revalidatePath(`/dashboard/jobs/${args.jobId}`);
    return {
      ok: true,
      messageId: sent.messageId,
      threadId: externalThreadId,
      localThreadId: localThread.id,
    };
  }

  if (account.provider !== "GMAIL") return { error: "This email provider cannot send." };

  let token: string;
  try {
    token = await getValidAccessToken(account.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "token error" };
  }

  const headers = [
    `From: ${cleanHeader(account.email)}`,
    `To: ${toAddress}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  const encoded = encodeGmailRaw(headers.join("\r\n") + "\r\n\r\n" + body);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 || /insufficient.*scope|insufficient_scope|permission/i.test(body)) {
      return {
        error: "Gmail send scope not granted. Reconnect this inbox in Email Settings to allow sending.",
        needsReauth: true,
      };
    }
    return { error: `Gmail send failed: ${res.status} ${body.slice(0, 200)}` };
  }

  const sent: { id: string; threadId: string } = await res.json();
  const now = new Date();
  const localThread = await prisma.emailThread.create({
    data: {
      officeId: args.officeId,
      inquiryId: args.inquiryId ?? null,
      jobId: args.jobId ?? null,
      subject,
      participants: JSON.stringify([account.email, toAddress]),
      externalThreadId: sent.threadId,
      lastMessageAt: now,
      messageCount: 1,
    },
  });
  const outboundMessage = await prisma.emailMessage.create({
    data: {
      threadId: localThread.id,
      accountId: account.id,
      gmailMessageId: sent.id,
      externalId: sent.id,
      direction: "OUTBOUND",
      fromEmail: account.email,
      fromName: null,
      toEmails: JSON.stringify([toAddress]),
      subject,
      bodyText: body,
      sentAt: now,
    },
  });
  // CRM touch: log the outbound email on the counterparty's timeline. Never throws.
  await logEmailTouch({
    officeId: args.officeId,
    threadId: localThread.id,
    messageId: outboundMessage.id,
    direction: "OUTBOUND",
    fromEmail: account.email,
    toEmails: [toAddress],
    subject,
    snippet: body,
    sentAt: now,
  });

  revalidatePath("/dashboard/inbox");
  if (args.inquiryId) revalidatePath(`/dashboard/rfq/${args.inquiryId}`);
  if (args.jobId) revalidatePath(`/dashboard/jobs/${args.jobId}`);
  return { ok: true, messageId: sent.id, threadId: sent.threadId, localThreadId: localThread.id };
}

// Send a reply on an existing thread. The reply is threaded properly via
// In-Reply-To/References + the Gmail threadId so it lands inside the original
// conversation in both Gmail and our inbox view.
//
// Scope required on the account: https://www.googleapis.com/auth/gmail.send.
// If the user authorized the inbox before that scope was added, the send call
// returns 403 - the UI catches this and prompts them to reconnect.
export async function sendReplyToThread(args: {
  threadDbId: string;
  body: string;
  replyTo?: string;        // optional override; defaults to the most recent inbound message's fromEmail
  subject?: string;        // optional override; defaults to "Re: <thread.subject>"
}): Promise<{ ok: true; messageId: string } | { error: string; needsReauth?: boolean }> {
  const session = await requireSession();
  const thread = await prisma.emailThread.findFirst({
    where: { id: args.threadDbId, officeId: session.officeId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
    },
  });
  if (!thread) return { error: "Thread not found" };

  // Pick the account: the EmailAccount of any message on this thread.
  const acct = thread.messages.find((m) => m.accountId)?.accountId;
  if (!acct) return { error: "No account associated with this thread" };

  const account = await prisma.emailAccount.findFirst({
    where: { id: acct, officeId: session.officeId, isActive: true, sendEnabled: true },
  });
  if (!account) return { error: "Email account not found, inactive, or disabled for sending" };

  // Build To: address. Default to the latest INBOUND sender.
  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "INBOUND");
  const toAddress = cleanHeader(args.replyTo ?? lastInbound?.fromEmail ?? thread.messages[0]?.fromEmail ?? "");
  if (!toAddress) return { error: "Could not determine recipient" };

  const baseSubject = args.subject ?? thread.subject ?? "(no subject)";
  const subject = stripEmDashes(cleanHeader(/^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`));
  const body = stripEmDashes(args.body);
  if (!body.trim()) return { error: "Email body is required" };

  // Build References / In-Reply-To from the most recent message that has a Message-ID.
  const refs = thread.messages
    .map((message) => message.rfcMessageId || (message.externalId?.startsWith("<") ? message.externalId : null))
    .filter((messageId): messageId is string => Boolean(messageId))
    .slice(-10);
  const inReplyTo = refs[refs.length - 1] ?? null;
  let sentMessageId: string;
  let externalId: string;
  let gmailMessageId: string | null = null;
  let rfcMessageId: string | null = null;

  if (account.provider === GMAIL_APP_PASSWORD_PROVIDER) {
    const sent = await sendGmailAppPasswordMail({
      account,
      to: toAddress,
      subject,
      text: body,
      inReplyTo,
      references: refs,
    });
    if (!sent.ok) return { error: sent.error };
    sentMessageId = sent.messageId;
    externalId = imapMessageExternalId(account.id, sent.messageId, Buffer.from(sent.messageId));
    rfcMessageId = sent.messageId || null;
  } else if (account.provider === "GMAIL") {
    if (!thread.externalThreadId) return { error: "Thread is not linked to a Gmail thread" };
    let token: string;
    try {
      token = await getValidAccessToken(account.id);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "token error" };
    }

    const headers: string[] = [
      `From: ${account.email}`,
      `To: ${toAddress}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset="UTF-8"`,
    ];
    if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
    if (refs.length) headers.push(`References: ${refs.join(" ")}`);

    const raw = headers.join("\r\n") + "\r\n\r\n" + body;
    const encoded = encodeGmailRaw(raw);
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded, threadId: thread.externalThreadId }),
    });
    if (!res.ok) {
      const responseBody = await res.text();
      if (res.status === 403 || /insufficient.*scope|insufficient_scope|permission/i.test(responseBody)) {
        return {
          error: "Gmail send scope not granted. Reconnect this inbox in Email Settings to allow sending.",
          needsReauth: true,
        };
      }
      return { error: `Gmail send failed: ${res.status} ${responseBody.slice(0, 200)}` };
    }
    const sent: { id: string; threadId: string } = await res.json();
    sentMessageId = sent.id;
    externalId = sent.id;
    gmailMessageId = sent.id;
  } else {
    return { error: "This email provider cannot send" };
  }

  // Persist locally as an OUTBOUND EmailMessage so the thread reflects it
  // immediately (without waiting for the next sync).
  const outboundMessage = await prisma.emailMessage.create({
    data: {
      threadId: thread.id,
      accountId: account.id,
      gmailMessageId,
      externalId,
      rfcMessageId,
      direction: "OUTBOUND",
      fromEmail: account.email,
      fromName: account.displayName,
      toEmails: JSON.stringify([toAddress]),
      subject,
      bodyText: body,
      sentAt: new Date(),
    },
  });
  await prisma.emailThread.updateMany({
    where: { id: thread.id, officeId: session.officeId },
    data: { lastMessageAt: new Date(), messageCount: { increment: 1 } },
  });
  // CRM touch: log the outbound reply on the counterparty's timeline. Never throws.
  await logEmailTouch({
    officeId: session.officeId,
    threadId: thread.id,
    messageId: outboundMessage.id,
    direction: "OUTBOUND",
    fromEmail: account.email,
    toEmails: [toAddress],
    subject,
    snippet: body,
    sentAt: outboundMessage.sentAt,
  });

  revalidatePath("/dashboard/inbox");
  if (thread.inquiryId) revalidatePath(`/dashboard/rfq/${thread.inquiryId}`);
  if (thread.jobId) revalidatePath(`/dashboard/jobs/${thread.jobId}`);
  return { ok: true, messageId: sentMessageId };
}
