import "server-only";

import { createHash } from "node:crypto";
import type { EmailAccount, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  GMAIL_APP_PASSWORD_PROVIDER,
  sendGmailAppPasswordMail,
} from "@/lib/gmail-app-password";
import { DEMO_EMAIL_CLASSIFICATION, DEMO_EMAIL_THREAD_MARKER } from "@/lib/email-demo-markers";
import { imapMessageExternalId, imapThreadExternalId } from "@/lib/imap-identifiers";

const DEMO_COMPANY_NAME = "HypnoDreamz Email Capability Demo";
const DEMO_WORKSPACE_KEY = "demo:hypnodreamz:email-capability";
const DEMO_TASK_TYPE = "DEMO_PROCUREMENT_EMAIL_CONVERSATION";
const DEMO_CAPABILITY_KEY = "demo.connected_email.round_trip";
const DELIVERY_ATTEMPTS = 10;
const DELIVERY_WAIT_MS = 2_500;

type DemoAccount = Pick<
  EmailAccount,
  "id" | "officeId" | "email" | "displayName" | "provider" | "credentialSecret"
>;

type DemoConversationKind = "MAILBOX_PAIR" | "PROCUREMENT_DEMO";

type DemoConversationResult = {
  kind: DemoConversationKind;
  label: string;
  status: "PASSED" | "FAILED";
  sender: string;
  recipient: string;
  subject: string;
  sentBody: string;
  replyBody: string;
  sentReceivedAt: string | null;
  replyReceivedAt: string | null;
  threadIds: string[];
  error: string | null;
};

type DemoPayload = {
  accountIds: string[];
  runKey: string;
  approvalContext: {
    actor: string;
    runId: string;
    runAttempt: string;
    ref: string;
    sha: string;
  };
};

type DemoExecutionContext = {
  officeId: string;
  workspaceId: string;
  taskId: string;
  runKey: string;
  conversationIndex: number;
};

export type DemoEmailCapabilityDependencies = {
  db: typeof prisma;
  sendMail: typeof sendGmailAppPasswordMail;
  syncAccount: (input: {
    accountId: string;
    officeId: string;
    query: string;
    threadFetchLimit?: number;
    skipClassification?: boolean;
    demoObservation?: boolean;
  }) => Promise<{ error: string } | { ok: true; processed: number; created: number; threadsTouched: number; autoInquiries: number; autoLinked: number }>;
  wait: (ms: number) => Promise<unknown>;
  deployedCommitSha: () => string | null;
};

const defaultDependencies: DemoEmailCapabilityDependencies = {
  db: prisma,
  sendMail: sendGmailAppPasswordMail,
  syncAccount: async (input) => {
    const { syncEmailAccountWindowInternal } = await import("@/lib/gmail-sync");
    return syncEmailAccountWindowInternal(input);
  },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  deployedCommitSha: () => process.env.VERCEL_GIT_COMMIT_SHA?.toLowerCase() ?? null,
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function cleanRunKey(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9-]{12,120}$/i.test(value)) {
    throw new Error("The demo email run key is invalid.");
  }
  return value;
}

function cleanApprovalValue(value: unknown, name: string, pattern: RegExp) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`The demo approval ${name} is invalid.`);
  }
  return value;
}

function parsePayload(payload: Prisma.JsonValue): DemoPayload {
  const source = record(payload);
  const accountIds = Array.from(new Set(stringArray(source.accountIds)));
  if (accountIds.length !== 6) {
    throw new Error("The demo requires exactly six distinct connected email accounts.");
  }
  const approval = record(source.approvalContext);
  return {
    accountIds,
    runKey: cleanRunKey(source.runKey),
    approvalContext: {
      actor: cleanApprovalValue(approval.actor, "actor", /^[A-Za-z0-9-]{1,100}$/),
      runId: cleanApprovalValue(approval.runId, "run ID", /^\d{1,30}$/),
      runAttempt: cleanApprovalValue(approval.runAttempt, "run attempt", /^\d{1,10}$/),
      ref: cleanApprovalValue(approval.ref, "ref", /^refs\/heads\/main$/),
      sha: cleanApprovalValue(approval.sha, "commit SHA", /^[a-f0-9]{40}$/),
    },
  };
}

function displayName(account: DemoAccount) {
  return account.displayName?.trim() || account.email;
}

function deliveryAttemptKey(value: string | null) {
  return value?.replace(/:(PLANNED|ACKNOWLEDGED|UNCERTAIN)$/, "") ?? null;
}

function deliveryMessageId(input: {
  runKey: string;
  conversationIndex: number;
  stage: "INITIAL" | "REPLY";
  sender: string;
  recipient: string;
}) {
  return `<derya-demo-${digest(input).slice(0, 32)}@app.derya.ai>`;
}

async function recordDeliveryEvent(input: {
  execution: DemoExecutionContext;
  stage: "INITIAL" | "REPLY";
  status: "PLANNED" | "ACKNOWLEDGED" | "UNCERTAIN";
  senderAccountId: string;
  receiverAccountId: string;
  sender: string;
  recipient: string;
  subject: string;
  intendedMessageId: string;
  providerMessageId?: string | null;
  error?: string | null;
}, dependencies: DemoEmailCapabilityDependencies) {
  const stageOffset = input.stage === "INITIAL" ? 0 : 2;
  const statusOffset = input.status === "PLANNED" ? 0 : 1;
  const sequence = 10 + input.execution.conversationIndex * 10 + stageOffset + statusOffset;
  const payload = {
    stage: input.stage,
    senderAccountId: input.senderAccountId,
    receiverAccountId: input.receiverAccountId,
    sender: input.sender,
    recipient: input.recipient,
    subject: input.subject,
    intendedMessageId: input.intendedMessageId,
    providerMessageId: input.providerMessageId ?? null,
    error: input.error ?? null,
  };
  await dependencies.db.supplyExecutionEvent.create({
    data: {
      officeId: input.execution.officeId,
      workspaceId: input.execution.workspaceId,
      executionTaskId: input.execution.taskId,
      actorUserId: null,
      sequence,
      eventType: `DEMO_EMAIL_DELIVERY_${input.status}`,
      status: input.status,
      message: `${input.stage.toLowerCase()} demo email delivery ${input.status.toLowerCase()}.`,
      payload: json(payload),
      payloadHash: digest(payload),
      idempotencyKey: `${input.execution.runKey}:delivery:${input.execution.conversationIndex}:${input.stage}:${input.status}`,
    },
  });
}

async function sendInitialMessage(input: {
  officeId: string;
  companyId: string;
  sender: DemoAccount;
  recipient: DemoAccount;
  subject: string;
  body: string;
  execution: DemoExecutionContext;
}, dependencies: DemoEmailCapabilityDependencies) {
  const intendedMessageId = deliveryMessageId({
    runKey: input.execution.runKey,
    conversationIndex: input.execution.conversationIndex,
    stage: "INITIAL",
    sender: input.sender.email,
    recipient: input.recipient.email,
  });
  await recordDeliveryEvent({
    execution: input.execution,
    stage: "INITIAL",
    status: "PLANNED",
    senderAccountId: input.sender.id,
    receiverAccountId: input.recipient.id,
    sender: input.sender.email,
    recipient: input.recipient.email,
    subject: input.subject,
    intendedMessageId,
  }, dependencies);
  const sent = await dependencies.sendMail({
    account: input.sender,
    to: input.recipient.email,
    subject: input.subject,
    text: input.body,
    messageId: intendedMessageId,
  });
  if (!sent.ok) {
    await recordDeliveryEvent({
      execution: input.execution,
      stage: "INITIAL",
      status: "UNCERTAIN",
      senderAccountId: input.sender.id,
      receiverAccountId: input.recipient.id,
      sender: input.sender.email,
      recipient: input.recipient.email,
      subject: input.subject,
      intendedMessageId,
      error: sent.error,
    }, dependencies);
    throw new Error(sent.error);
  }
  if (!sent.messageId) {
    await recordDeliveryEvent({
      execution: input.execution,
      stage: "INITIAL",
      status: "UNCERTAIN",
      senderAccountId: input.sender.id,
      receiverAccountId: input.recipient.id,
      sender: input.sender.email,
      recipient: input.recipient.email,
      subject: input.subject,
      intendedMessageId,
      error: "SMTP did not return a message ID.",
    }, dependencies);
    throw new Error("SMTP did not return a message ID.");
  }
  await recordDeliveryEvent({
    execution: input.execution,
    stage: "INITIAL",
    status: "ACKNOWLEDGED",
    senderAccountId: input.sender.id,
    receiverAccountId: input.recipient.id,
    sender: input.sender.email,
    recipient: input.recipient.email,
    subject: input.subject,
    intendedMessageId,
    providerMessageId: sent.messageId,
  }, dependencies);

  const sentAt = new Date();
  const externalThreadId = imapThreadExternalId({
    accountId: input.sender.id,
    messageId: sent.messageId,
    subject: input.subject,
  });
  const thread = await dependencies.db.emailThread.create({
    data: {
      officeId: input.officeId,
      companyId: input.companyId,
      subject: input.subject,
      participants: JSON.stringify([input.sender.email, input.recipient.email]),
      externalThreadId,
      lastMessageAt: sentAt,
      messageCount: 1,
      hiddenAt: sentAt,
      autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER,
    },
  });
  await dependencies.db.emailMessage.create({
    data: {
      threadId: thread.id,
      accountId: input.sender.id,
      externalId: imapMessageExternalId(input.sender.id, sent.messageId, Buffer.from(sent.messageId)),
      rfcMessageId: sent.messageId,
      direction: "OUTBOUND",
      fromEmail: input.sender.email,
      fromName: input.sender.displayName,
      toEmails: JSON.stringify([input.recipient.email]),
      subject: input.subject,
      bodyText: input.body,
      classification: DEMO_EMAIL_CLASSIFICATION,
      classificationReason: "Protected test-only connected email capability message.",
      classificationAt: sentAt,
      sentAt,
    },
  });
  return { messageId: sent.messageId, threadId: thread.id };
}

async function waitForInbound(input: {
  officeId: string;
  account: DemoAccount;
  fromEmail: string;
  subject: string;
  relatedToMessageId: string;
  sentAfter: Date;
}, dependencies: DemoEmailCapabilityDependencies) {
  for (let attempt = 0; attempt < DELIVERY_ATTEMPTS; attempt++) {
    if (attempt > 0) await dependencies.wait(DELIVERY_WAIT_MS);
    const sync = await dependencies.syncAccount({
      accountId: input.account.id,
      officeId: input.officeId,
      query: `rfc822msgid:${input.relatedToMessageId}`,
      threadFetchLimit: 50,
      skipClassification: true,
      demoObservation: true,
    });
    if ("error" in sync) throw new Error(sync.error);

    const message = await dependencies.db.emailMessage.findFirst({
      where: {
        accountId: input.account.id,
        direction: "INBOUND",
        classification: DEMO_EMAIL_CLASSIFICATION,
        fromEmail: input.fromEmail.toLowerCase(),
        subject: input.subject,
        sentAt: { gte: new Date(input.sentAfter.getTime() - 60_000) },
      },
      select: { id: true, threadId: true, sentAt: true, rfcMessageId: true },
      orderBy: { sentAt: "desc" },
    });
    if (message) return message;
  }
  throw new Error(`Delivery was not visible in ${input.account.email} after ${DELIVERY_ATTEMPTS} checks.`);
}

async function sendReply(input: {
  officeId: string;
  companyId: string;
  account: DemoAccount;
  threadId: string;
  to: string;
  toAccountId: string;
  subject: string;
  body: string;
  execution: DemoExecutionContext;
}, dependencies: DemoEmailCapabilityDependencies) {
  const thread = await dependencies.db.emailThread.findFirst({
    where: { id: input.threadId, officeId: input.officeId },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });
  if (!thread) throw new Error("The received demo email thread was not found.");
  if (!thread.messages.some((message) => message.accountId === input.account.id)) {
    throw new Error("The reply account does not own the received demo email thread.");
  }

  const references = thread.messages
    .map((message) => message.rfcMessageId)
    .filter((messageId): messageId is string => Boolean(messageId))
    .slice(-10);
  const intendedMessageId = deliveryMessageId({
    runKey: input.execution.runKey,
    conversationIndex: input.execution.conversationIndex,
    stage: "REPLY",
    sender: input.account.email,
    recipient: input.to,
  });
  await recordDeliveryEvent({
    execution: input.execution,
    stage: "REPLY",
    status: "PLANNED",
    senderAccountId: input.account.id,
    receiverAccountId: input.toAccountId,
    sender: input.account.email,
    recipient: input.to,
    subject: input.subject,
    intendedMessageId,
  }, dependencies);
  const sent = await dependencies.sendMail({
    account: input.account,
    to: input.to,
    subject: input.subject,
    text: input.body,
    messageId: intendedMessageId,
    inReplyTo: references.at(-1) ?? null,
    references,
  });
  if (!sent.ok) {
    await recordDeliveryEvent({
      execution: input.execution,
      stage: "REPLY",
      status: "UNCERTAIN",
      senderAccountId: input.account.id,
      receiverAccountId: input.toAccountId,
      sender: input.account.email,
      recipient: input.to,
      subject: input.subject,
      intendedMessageId,
      error: sent.error,
    }, dependencies);
    throw new Error(sent.error);
  }
  if (!sent.messageId) {
    await recordDeliveryEvent({
      execution: input.execution,
      stage: "REPLY",
      status: "UNCERTAIN",
      senderAccountId: input.account.id,
      receiverAccountId: input.toAccountId,
      sender: input.account.email,
      recipient: input.to,
      subject: input.subject,
      intendedMessageId,
      error: "SMTP did not return a reply message ID.",
    }, dependencies);
    throw new Error("SMTP did not return a reply message ID.");
  }
  await recordDeliveryEvent({
    execution: input.execution,
    stage: "REPLY",
    status: "ACKNOWLEDGED",
    senderAccountId: input.account.id,
    receiverAccountId: input.toAccountId,
    sender: input.account.email,
    recipient: input.to,
    subject: input.subject,
    intendedMessageId,
    providerMessageId: sent.messageId,
  }, dependencies);

  const sentAt = new Date();
  await dependencies.db.emailThread.updateMany({
    where: { id: thread.id, officeId: input.officeId },
    data: {
      companyId: input.companyId,
      lastMessageAt: sentAt,
      messageCount: { increment: 1 },
      hiddenAt: sentAt,
      autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER,
    },
  });
  await dependencies.db.emailMessage.create({
    data: {
      threadId: thread.id,
      accountId: input.account.id,
      externalId: imapMessageExternalId(input.account.id, sent.messageId, Buffer.from(sent.messageId)),
      rfcMessageId: sent.messageId,
      direction: "OUTBOUND",
      fromEmail: input.account.email,
      fromName: input.account.displayName,
      toEmails: JSON.stringify([input.to]),
      subject: input.subject,
      bodyText: input.body,
      classification: DEMO_EMAIL_CLASSIFICATION,
      classificationReason: "Protected test-only connected email capability reply.",
      classificationAt: sentAt,
      sentAt,
    },
  });
  return { messageId: sent.messageId, sentAt };
}

async function runConversation(input: {
  kind: DemoConversationKind;
  label: string;
  officeId: string;
  companyId: string;
  sender: DemoAccount;
  recipient: DemoAccount;
  subject: string;
  sentBody: string;
  replyBody: string;
  execution: DemoExecutionContext;
}, dependencies: DemoEmailCapabilityDependencies): Promise<DemoConversationResult> {
  const result: DemoConversationResult = {
    kind: input.kind,
    label: input.label,
    status: "FAILED",
    sender: input.sender.email,
    recipient: input.recipient.email,
    subject: input.subject,
    sentBody: input.sentBody,
    replyBody: input.replyBody,
    sentReceivedAt: null,
    replyReceivedAt: null,
    threadIds: [],
    error: null,
  };
  const startedAt = new Date();

  try {
    const sent = await sendInitialMessage({
      officeId: input.officeId,
      companyId: input.companyId,
      sender: input.sender,
      recipient: input.recipient,
      subject: input.subject,
      body: input.sentBody,
      execution: input.execution,
    }, dependencies);
    result.threadIds.push(sent.threadId);
    const received = await waitForInbound({
      officeId: input.officeId,
      account: input.recipient,
      fromEmail: input.sender.email,
      subject: input.subject,
      relatedToMessageId: sent.messageId,
      sentAfter: startedAt,
    }, dependencies);
    result.sentReceivedAt = received.sentAt.toISOString();
    result.threadIds.push(received.threadId);
    await dependencies.db.emailThread.updateMany({
      where: { id: received.threadId, officeId: input.officeId },
      data: {
        companyId: input.companyId,
        hiddenAt: new Date(),
        autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER,
      },
    });

    const replySubject = `Re: ${input.subject}`;
    const reply = await sendReply({
      officeId: input.officeId,
      companyId: input.companyId,
      account: input.recipient,
      threadId: received.threadId,
      to: input.sender.email,
      toAccountId: input.sender.id,
      subject: replySubject,
      body: input.replyBody,
      execution: input.execution,
    }, dependencies);
    const receivedReply = await waitForInbound({
      officeId: input.officeId,
      account: input.sender,
      fromEmail: input.recipient.email,
      subject: replySubject,
      relatedToMessageId: reply.messageId,
      sentAfter: startedAt,
    }, dependencies);
    result.replyReceivedAt = receivedReply.sentAt.toISOString();
    result.threadIds.push(receivedReply.threadId);
    await dependencies.db.emailThread.updateMany({
      where: { id: { in: result.threadIds }, officeId: input.officeId },
      data: {
        companyId: input.companyId,
        hiddenAt: new Date(),
        autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER,
      },
    });
    result.threadIds = Array.from(new Set(result.threadIds));
    result.status = "PASSED";
  } catch (caught) {
    result.error = caught instanceof Error ? caught.message : "The demo conversation failed.";
  }

  return result;
}

export async function runDemoEmailCapabilityJob(input: {
  backgroundJobId: string;
  officeId: string;
  payload: Prisma.JsonValue;
}, dependencies: DemoEmailCapabilityDependencies = defaultDependencies) {
  const payload = parsePayload(input.payload);
  const deployedCommitSha = dependencies.deployedCommitSha();
  if (!deployedCommitSha || deployedCommitSha !== payload.approvalContext.sha) {
    throw new Error("The deployed application commit does not match the approved workflow commit.");
  }
  const accounts = await dependencies.db.emailAccount.findMany({
    where: {
      officeId: input.officeId,
      id: { in: payload.accountIds },
      provider: GMAIL_APP_PASSWORD_PROVIDER,
      credentialSecret: { not: null },
      isActive: true,
      sendEnabled: true,
    },
    select: {
      id: true,
      officeId: true,
      email: true,
      displayName: true,
      provider: true,
      credentialSecret: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { email: "asc" }],
  });
  if (accounts.length !== 6) {
    throw new Error("All six demo accounts must be connected, active, and enabled for sending.");
  }
  const priorDeliveryEvents = await dependencies.db.supplyExecutionEvent.findMany({
    where: {
      officeId: input.officeId,
      eventType: {
        in: [
          "DEMO_EMAIL_DELIVERY_PLANNED",
          "DEMO_EMAIL_DELIVERY_ACKNOWLEDGED",
          "DEMO_EMAIL_DELIVERY_UNCERTAIN",
        ],
      },
    },
    select: { eventType: true, status: true, idempotencyKey: true },
  });
  const terminalAttempts = new Set(priorDeliveryEvents
    .filter((event) => event.status === "ACKNOWLEDGED" || event.status === "UNCERTAIN")
    .map((event) => deliveryAttemptKey(event.idempotencyKey))
    .filter((key): key is string => Boolean(key)));
  const unresolvedDelivery = priorDeliveryEvents.some((event) => {
    if (event.status === "UNCERTAIN") return true;
    if (event.status !== "PLANNED") return false;
    const key = deliveryAttemptKey(event.idempotencyKey);
    return !key || !terminalAttempts.has(key);
  });
  if (unresolvedDelivery) {
    throw new Error("A prior demo email delivery is uncertain and must be reconciled before another send.");
  }
  const company = await dependencies.db.company.upsert({
    where: { officeId_name: { officeId: input.officeId, name: DEMO_COMPANY_NAME } },
    create: {
      officeId: input.officeId,
      name: DEMO_COMPANY_NAME,
      crmCategory: "test",
      crmStage: "demo",
      crmSource: "manual_demo",
      crmTags: json(["demo", "email-capability", "hypnodreamz"]),
      crmNotes: "Test-only company for connected mailbox and procurement conversation verification. No real supplier, quote, shipment, or order.",
    },
    update: {
      crmCategory: "test",
      crmStage: "demo",
      crmSource: "manual_demo",
      crmTags: json(["demo", "email-capability", "hypnodreamz"]),
      crmNotes: "Test-only company for connected mailbox and procurement conversation verification. No real supplier, quote, shipment, or order.",
    },
    select: { id: true, name: true },
  });
  const workspace = await dependencies.db.supplyWorkspace.upsert({
    where: { officeId_externalKey: { officeId: input.officeId, externalKey: DEMO_WORKSPACE_KEY } },
    create: {
      officeId: input.officeId,
      companyId: company.id,
      createdByUserId: null,
      externalKey: DEMO_WORKSPACE_KEY,
      name: DEMO_COMPANY_NAME,
    },
    update: { companyId: company.id, status: "ACTIVE", archivedAt: null },
    select: { id: true, name: true },
  });

  const taskInput = {
    testOnly: true,
    runKey: payload.runKey,
    accountIds: accounts.map((account) => account.id),
    requestedConversationCount: 4,
    approvalBasis: "Explicit operator approval through the protected production demo workflow.",
    approvalContext: payload.approvalContext,
    restrictions: ["No real supplier", "No purchase", "No shipment", "No spend"],
  };
  const task = await dependencies.db.supplyExecutionTask.upsert({
    where: { workspaceId_taskKey: { workspaceId: workspace.id, taskKey: payload.runKey } },
    create: {
      officeId: input.officeId,
      workspaceId: workspace.id,
      createdByUserId: null,
      taskKey: payload.runKey,
      taskType: DEMO_TASK_TYPE,
      capabilityKey: DEMO_CAPABILITY_KEY,
      status: "RUNNING",
      requiresApproval: false,
      input: json(taskInput),
      inputHash: digest(taskInput),
      externalSystem: "GMAIL_APP_PASSWORD",
      idempotencyKey: payload.runKey,
      startedAt: new Date(),
    },
    update: {},
    select: { id: true, status: true },
  });
  if (task.status !== "RUNNING") {
    throw new Error("This demo procurement run has already been executed.");
  }
  await dependencies.db.supplyExecutionEvent.create({
    data: {
      officeId: input.officeId,
      workspaceId: workspace.id,
      executionTaskId: task.id,
      actorUserId: null,
      sequence: 1,
      eventType: "DEMO_EMAIL_RUN_STARTED",
      status: "RUNNING",
      message: "Started the approved test-only connected email capability run.",
      payload: json({
        runKey: payload.runKey,
        accountCount: accounts.length,
        approvalContext: payload.approvalContext,
      }),
      payloadHash: digest({
        runKey: payload.runKey,
        accountCount: accounts.length,
        approvalContext: payload.approvalContext,
      }),
      idempotencyKey: `${payload.runKey}:started`,
    },
  });

  const selectedDefault = await dependencies.db.emailAccount.findFirst({
    where: { officeId: input.officeId, isDefaultSender: true, isActive: true, sendEnabled: true },
    select: { id: true, email: true },
  });
  const token = digest(payload.runKey).slice(0, 10);
  const pairPlans = [0, 1, 2].map((pairIndex) => {
    const sender = accounts[pairIndex * 2];
    const recipient = accounts[pairIndex * 2 + 1];
    return {
      kind: "MAILBOX_PAIR",
      label: `Mailbox pair ${pairIndex + 1}`,
      officeId: input.officeId,
      companyId: company.id,
      sender,
      recipient,
      subject: `Derya mailbox demo ${pairIndex + 1} ${token}`,
      sentBody: `This is an automated Derya mailbox capability test from ${sender.email} to ${recipient.email}. Test pair ${pairIndex + 1} of 3. No action is required.`,
      replyBody: `Reply received for Derya mailbox capability test pair ${pairIndex + 1} of 3 from ${recipient.email} to ${sender.email}.`,
      execution: {
        officeId: input.officeId,
        workspaceId: workspace.id,
        taskId: task.id,
        runKey: payload.runKey,
        conversationIndex: pairIndex,
      },
    } as const;
  });
  const procurementSender = accounts[0];
  const procurementRecipient = accounts[1];
  const procurementPlan = {
    kind: "PROCUREMENT_DEMO",
    label: "HypnoDreamz demo RFQ",
    officeId: input.officeId,
    companyId: company.id,
    sender: procurementSender,
    recipient: procurementRecipient,
    subject: `[DEMO RFQ] HypnoDreamz sample packaging ${token}`,
    sentBody: `Hello ${displayName(procurementRecipient)},\n\nThis is a test RFQ from the Derya demo procurement workspace.\n\nPlease confirm whether you can supply 100 custom sample boxes, your demo unit price, and a demo lead time. This is a system test only. Do not fulfill or ship anything.\n\nRegards,\n${displayName(procurementSender)}`,
    replyBody: `Hello ${displayName(procurementSender)},\n\nFor this demo only, we can offer 100 sample boxes at USD 2.40 per unit with a 14-day demo lead time. This is not a real commercial offer and no order has been placed.\n\nRegards,\n${displayName(procurementRecipient)}`,
    execution: {
      officeId: input.officeId,
      workspaceId: workspace.id,
      taskId: task.id,
      runKey: payload.runKey,
      conversationIndex: 3,
    },
  } as const;
  const plannedConversations = [...pairPlans, procurementPlan].map((plan) => ({
    kind: plan.kind,
    label: plan.label,
    sender: plan.sender.email,
    recipient: plan.recipient.email,
    subject: plan.subject,
    sentBody: plan.sentBody,
    replyBody: plan.replyBody,
  }));
  await dependencies.db.supplyExecutionEvent.create({
    data: {
      officeId: input.officeId,
      workspaceId: workspace.id,
      executionTaskId: task.id,
      actorUserId: null,
      sequence: 2,
      eventType: "DEMO_EMAIL_PLAN_APPROVED",
      status: "APPROVED",
      message: "Recorded the exact test-only email plan before external delivery.",
      payload: json({
        runKey: payload.runKey,
        approvalContext: payload.approvalContext,
        conversations: plannedConversations,
      }),
      payloadHash: digest({
        runKey: payload.runKey,
        approvalContext: payload.approvalContext,
        conversations: plannedConversations,
      }),
      idempotencyKey: `${payload.runKey}:plan`,
    },
  });

  const pairResults = await Promise.all(pairPlans.map((plan) => runConversation(plan, dependencies)));
  const procurementResult = await runConversation(procurementPlan, dependencies);
  const conversations = [...pairResults, procurementResult];
  const passed = conversations.filter((conversation) => conversation.status === "PASSED").length;
  const result = {
    testOnly: true,
    runKey: payload.runKey,
    company: { id: company.id, name: company.name },
    workspace: { id: workspace.id, name: workspace.name },
    executionTaskId: task.id,
    defaultSender: selectedDefault?.email ?? null,
    accountCount: accounts.length,
    passed,
    failed: conversations.length - passed,
    conversations,
    purchaseCreated: false,
    spendAuthorized: false,
    completedAt: new Date().toISOString(),
  };

  for (const [index, conversation] of conversations.entries()) {
    await dependencies.db.supplyExecutionEvent.create({
      data: {
        officeId: input.officeId,
        workspaceId: workspace.id,
        executionTaskId: task.id,
        actorUserId: null,
        sequence: index + 50,
        eventType: conversation.kind === "PROCUREMENT_DEMO"
          ? "DEMO_PROCUREMENT_CONVERSATION_COMPLETED"
          : "DEMO_MAILBOX_PAIR_COMPLETED",
        status: conversation.status,
        message: `${conversation.label}: ${conversation.status.toLowerCase()}.`,
        payload: json(conversation),
        payloadHash: digest(conversation),
        idempotencyKey: `${payload.runKey}:conversation:${index + 1}`,
      },
    });
  }

  const succeeded = passed === conversations.length;
  await dependencies.db.supplyExecutionTask.updateMany({
    where: { id: task.id, officeId: input.officeId, workspaceId: workspace.id },
    data: {
      status: succeeded ? "SUCCEEDED" : "FAILED",
      result: json(result),
      resultHash: digest(result),
      error: succeeded ? undefined : json({ failedConversations: result.failed }),
      completedAt: succeeded ? new Date() : null,
      failedAt: succeeded ? null : new Date(),
    },
  });
  await dependencies.db.supplyExecutionEvent.create({
    data: {
      officeId: input.officeId,
      workspaceId: workspace.id,
      executionTaskId: task.id,
      actorUserId: null,
      sequence: 60,
      eventType: succeeded ? "DEMO_EMAIL_RUN_SUCCEEDED" : "DEMO_EMAIL_RUN_FAILED",
      status: succeeded ? "SUCCEEDED" : "FAILED",
      message: succeeded
        ? "All connected email round trips passed."
        : `${result.failed} connected email conversation tests failed.`,
      payload: json({ passed: result.passed, failed: result.failed }),
      payloadHash: digest({ passed: result.passed, failed: result.failed }),
      idempotencyKey: `${payload.runKey}:completed`,
    },
  });
  await dependencies.db.backgroundJob.updateMany({
    where: { id: input.backgroundJobId, officeId: input.officeId },
    data: {
      payload: json({
        accountIds: payload.accountIds,
        runKey: payload.runKey,
        result,
      }),
    },
  });

  if (!succeeded) {
    throw new Error(`${result.failed} of ${conversations.length} demo email conversations failed.`);
  }
}
