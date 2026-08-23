"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireEmailAccountAdminSession } from "@/lib/email-account-access";
import { GMAIL_APP_PASSWORD_PROVIDER } from "@/lib/gmail-app-password";
import { sendNewEmailFromAccount, sendReplyToThread } from "@/lib/gmail-send";
import { syncEmailAccountInternal } from "@/lib/gmail-sync";
import { prisma } from "@/lib/prisma";

const TOKEN_PATTERN = /^[a-f0-9]{12}$/;
const TEST_WINDOW_MS = 30 * 60 * 1000;

type TestStage = "sent" | "delivery_waiting" | "reply_sent" | "reply_waiting" | "complete";

export type EmailRoundTripState = {
  token: string;
  senderId: string;
  senderEmail: string;
  recipientId: string;
  recipientEmail: string;
  stage: TestStage;
  message: string;
};

function validAccountId(value: string) {
  return typeof value === "string" && value.length > 0 && value.length <= 220;
}

async function roundTripAccounts(officeId: string, senderId: string, recipientId: string) {
  if (!validAccountId(senderId) || !validAccountId(recipientId) || senderId === recipientId) {
    return { error: "Choose two different connected email accounts." } as const;
  }

  const accounts = await prisma.emailAccount.findMany({
    where: {
      officeId,
      id: { in: [senderId, recipientId] },
      provider: { in: ["GMAIL", GMAIL_APP_PASSWORD_PROVIDER] },
      isActive: true,
      sendEnabled: true,
    },
    select: {
      id: true,
      email: true,
      provider: true,
      refreshToken: true,
      credentialSecret: true,
    },
  });
  const sender = accounts.find((account) => account.id === senderId);
  const recipient = accounts.find((account) => account.id === recipientId);
  const connected = (account: typeof sender) => Boolean(account && (
    (account.provider === "GMAIL" && account.refreshToken)
    || (account.provider === GMAIL_APP_PASSWORD_PROVIDER && account.credentialSecret)
  ));
  if (!connected(sender) || !connected(recipient)) {
    return { error: "Both accounts must be connected, active, and enabled for sending." } as const;
  }
  return { sender: sender!, recipient: recipient! } as const;
}

function testSubject(token: string) {
  return `Derya mailbox test ${token}`;
}

export async function startEmailRoundTripTest(senderId: string, recipientId: string) {
  const session = await requireEmailAccountAdminSession();
  const accounts = await roundTripAccounts(session.officeId, senderId, recipientId);
  if ("error" in accounts) return { ok: false as const, error: accounts.error };

  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const subject = testSubject(token);
  const sent = await sendNewEmailFromAccount({
    officeId: session.officeId,
    accountId: accounts.sender.id,
    to: accounts.recipient.email,
    subject,
    body: `Round-trip connection test from ${accounts.sender.email} to ${accounts.recipient.email}.`,
  });
  if ("error" in sent) return { ok: false as const, error: sent.error };

  revalidatePath("/dashboard/settings/connected-emails");
  return {
    ok: true as const,
    state: {
      token,
      senderId: accounts.sender.id,
      senderEmail: accounts.sender.email,
      recipientId: accounts.recipient.id,
      recipientEmail: accounts.recipient.email,
      stage: "sent" as const,
      message: `Sent from ${accounts.sender.email} to ${accounts.recipient.email}.`,
    },
  };
}

export async function advanceEmailRoundTripTest(input: EmailRoundTripState) {
  const session = await requireEmailAccountAdminSession();
  if (!TOKEN_PATTERN.test(input.token)) return { ok: false as const, error: "Invalid mailbox test." };
  const accounts = await roundTripAccounts(session.officeId, input.senderId, input.recipientId);
  if ("error" in accounts) return { ok: false as const, error: accounts.error };

  const subject = testSubject(input.token);
  const replySubject = `Re: ${subject}`;
  const cutoff = new Date(Date.now() - TEST_WINDOW_MS);

  if (input.stage === "sent" || input.stage === "delivery_waiting") {
    const sync = await syncEmailAccountInternal(accounts.recipient.id, session.officeId);
    if ("error" in sync) return { ok: false as const, error: sync.error };
    const received = await prisma.emailMessage.findFirst({
      where: {
        accountId: accounts.recipient.id,
        direction: "INBOUND",
        fromEmail: accounts.sender.email,
        subject,
        sentAt: { gte: cutoff },
      },
      select: { id: true, threadId: true },
    });
    if (!received) {
      return {
        ok: true as const,
        state: {
          ...input,
          stage: "delivery_waiting" as const,
          message: `${accounts.recipient.email} has not received the test yet. Check again in a few seconds.`,
        },
      };
    }

    const existingReply = await prisma.emailMessage.findFirst({
      where: {
        accountId: accounts.recipient.id,
        direction: "OUTBOUND",
        fromEmail: accounts.recipient.email,
        subject: replySubject,
        sentAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (!existingReply) {
      const reply = await sendReplyToThread({
        threadDbId: received.threadId,
        replyTo: accounts.sender.email,
        subject,
        body: `Reply connection test from ${accounts.recipient.email} to ${accounts.sender.email}.`,
      });
      if ("error" in reply) return { ok: false as const, error: reply.error };
    }

    revalidatePath("/dashboard/settings/connected-emails");
    return {
      ok: true as const,
      state: {
        ...input,
        stage: "reply_sent" as const,
        message: `${accounts.recipient.email} received the test and sent a reply to ${accounts.sender.email}.`,
      },
    };
  }

  if (input.stage === "reply_sent" || input.stage === "reply_waiting") {
    const sync = await syncEmailAccountInternal(accounts.sender.id, session.officeId);
    if ("error" in sync) return { ok: false as const, error: sync.error };
    const receivedReply = await prisma.emailMessage.findFirst({
      where: {
        accountId: accounts.sender.id,
        direction: "INBOUND",
        fromEmail: accounts.recipient.email,
        subject: replySubject,
        sentAt: { gte: cutoff },
      },
      select: { sentAt: true },
    });
    if (!receivedReply) {
      return {
        ok: true as const,
        state: {
          ...input,
          stage: "reply_waiting" as const,
          message: `${accounts.sender.email} has not received the reply yet. Check again in a few seconds.`,
        },
      };
    }

    revalidatePath("/dashboard/settings/connected-emails");
    return {
      ok: true as const,
      state: {
        ...input,
        stage: "complete" as const,
        message: `Round trip passed: ${accounts.sender.email} and ${accounts.recipient.email} both sent and received.`,
      },
    };
  }

  return { ok: true as const, state: input };
}
