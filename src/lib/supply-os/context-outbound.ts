import "server-only";

import { randomUUID } from "node:crypto";
import type { SupplyContextOutboundDraft } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { stripEmDashes } from "@/lib/no-em-dash";
import { cleanContextBody, cleanContextText } from "./context-contract";
import { assembleSupplyContext, emitContextMemory } from "./context-persistence";
import {
  gmailSupplierEmailProvider,
  type SupplierEmailProvider,
  type SupplierEmailSent,
} from "./supplier-email-provider";
import { requireSupplyWorkspace, SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { supplyContextEnabled } from "./context-feature";

function email(value: unknown) {
  const normalized = cleanContextText(value, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new SupplyPersistenceError("Enter one valid supplier email address.", "invalid_input");
  }
  return normalized;
}

async function reviewer(context: SupplyAccessContext) {
  if (!supplyContextEnabled(context.officeId)) throw new SupplyPersistenceError("Context is not enabled for this office.", "forbidden");
  const user = await prisma.user.findFirst({
    where: { id: context.userId, officeId: context.officeId, isActive: true },
    select: { id: true, role: true },
  });
  if (!user || !["ADMIN", "MANAGER"].includes(user.role)) {
    throw new SupplyPersistenceError("A manager or admin must review supplier drafts.", "forbidden");
  }
  return user;
}

export async function createSupplyContextOutboundDraft(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  nodeId: string;
  senderAccountId: unknown;
  recipient: unknown;
  subject: unknown;
  body: unknown;
  linkedThreadId?: unknown;
  citationIds?: unknown;
}) {
  const workspace = await requireSupplyWorkspace(args.context, args.workspaceId, "edit");
  const assembled = await assembleSupplyContext({ context: args.context, workspaceId: args.workspaceId, nodeId: args.nodeId });
  if (assembled.selectedNodeId !== args.nodeId) throw new SupplyPersistenceError("Context scope not found.", "not_found");
  if (assembled.blocked) {
    throw new SupplyPersistenceError("Confirmed context facts conflict. Review them before drafting an external message.", "conflict");
  }
  const senderAccountId = cleanContextText(args.senderAccountId, 220);
  const sender = await prisma.emailAccount.findFirst({
    where: { id: senderAccountId, officeId: args.context.officeId, provider: "GMAIL", isActive: true },
    select: { id: true, email: true },
  });
  if (!sender) throw new SupplyPersistenceError("Select an active Gmail sender.", "invalid_input");
  const recipient = email(args.recipient);
  const subject = stripEmDashes(cleanContextText(args.subject, 180));
  const body = stripEmDashes(cleanContextBody(args.body, 20_000));
  if (!subject || !body) throw new SupplyPersistenceError("Supplier email subject and body are required.", "invalid_input");
  const linkedThreadId = cleanContextText(args.linkedThreadId, 220) || null;
  if (linkedThreadId) {
    const linked = await prisma.emailThread.findFirst({ where: { id: linkedThreadId, officeId: args.context.officeId, companyId: workspace.companyId }, select: { id: true } });
    if (!linked) throw new SupplyPersistenceError("Linked Gmail thread not found in this office.", "not_found");
    const contextLink = await prisma.supplyContextSourceLink.findFirst({
      where: { officeId: args.context.officeId, workspaceId: args.workspaceId, nodeId: { in: assembled.chain.map((node) => node.id) }, sourceType: "GMAIL_THREAD", sourceId: linkedThreadId },
    });
    if (!contextLink) throw new SupplyPersistenceError("Link the Gmail thread to this context before replying.", "invalid_input");
  }
  const requestedCitations = Array.isArray(args.citationIds) ? args.citationIds.filter((value): value is string => typeof value === "string") : [];
  const allowed = new Map(assembled.citations.map((citation) => [citation.id, citation]));
  const citations = requestedCitations.map((id) => allowed.get(id)).filter(Boolean);
  if (!citations.length) {
    throw new SupplyPersistenceError("Select at least one context source for the supplier draft.", "invalid_input");
  }
  const draft = await prisma.supplyContextOutboundDraft.create({
    data: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      nodeId: args.nodeId,
      senderAccountId: sender.id,
      recipient,
      subject,
      body,
      linkedThreadId,
      contextVersion: assembled.contextVersion,
      contextHash: assembled.contextHash,
      sourceSnapshot: JSON.parse(JSON.stringify({ snapshot: assembled.snapshot, citations })),
      state: "DRAFT",
      idempotencyKey: `context-draft:${randomUUID()}`,
      createdByUserId: args.context.userId,
    },
  });
  await emitContextMemory({
    officeId: args.context.officeId,
    companyId: workspace.companyId,
    nodeId: args.nodeId,
    recordId: draft.id,
    kind: "draft",
    title: draft.subject,
    text: draft.body,
    visibility: "INTERNAL",
    actorType: "user",
    actorId: args.context.userId,
    payload: { workspaceId: args.workspaceId, nodeId: args.nodeId, draftId: draft.id, contextHash: draft.contextHash, state: draft.state, citations },
  });
  return draft;
}

export async function reviewSupplyContextOutboundDraft(args: {
  context: SupplyAccessContext;
  draftId: string;
  decision: unknown;
}) {
  await reviewer(args.context);
  const decision = cleanContextText(args.decision, 20).toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    throw new SupplyPersistenceError("Draft decision must be APPROVED or REJECTED.", "invalid_input");
  }
  const draft = await prisma.supplyContextOutboundDraft.findFirst({
    where: { id: args.draftId, officeId: args.context.officeId, state: { in: ["DRAFT", "PENDING_REVIEW", "FAILED"] } },
  });
  if (!draft) throw new SupplyPersistenceError("Reviewable supplier draft not found.", "not_found");
  await requireSupplyWorkspace(args.context, draft.workspaceId, "edit");
  return prisma.supplyContextOutboundDraft.update({
    where: { id: draft.id },
    data: { state: decision, reviewedByUserId: args.context.userId, reviewedAt: new Date() },
  });
}

async function completeSupplyContextOutboundDelivery(args: {
  context: SupplyAccessContext;
  draft: SupplyContextOutboundDraft;
  receipt: SupplierEmailSent;
}) {
  const workspace = await requireSupplyWorkspace(args.context, args.draft.workspaceId, "edit");
  if (!args.draft.senderAccountId) {
    throw new SupplyPersistenceError("The approved Gmail sender is missing.", "conflict");
  }
  const sender = await prisma.emailAccount.findFirst({
    where: { id: args.draft.senderAccountId, officeId: args.context.officeId, provider: "GMAIL", isActive: true },
    select: { id: true, email: true },
  });
  if (!sender) throw new SupplyPersistenceError("The approved Gmail sender is unavailable.", "conflict");
  const linkedThread = args.draft.linkedThreadId ? await prisma.emailThread.findFirst({
    where: { id: args.draft.linkedThreadId, officeId: args.context.officeId, companyId: workspace.companyId },
    select: { id: true },
  }) : null;
  const now = new Date();
  let localThreadId = linkedThread?.id ?? null;
  if (!localThreadId) {
    const thread = await prisma.emailThread.findFirst({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        externalThreadId: args.receipt.providerThreadId,
      },
      select: { id: true },
    }) ?? await prisma.emailThread.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        subject: args.draft.subject,
        participants: JSON.stringify([sender.email, args.draft.recipient]),
        externalThreadId: args.receipt.providerThreadId,
        lastMessageAt: now,
        messageCount: 0,
      },
    });
    localThreadId = thread.id;
    const existingLink = await prisma.supplyContextSourceLink.findFirst({
      where: {
        officeId: args.context.officeId,
        workspaceId: args.draft.workspaceId,
        nodeId: args.draft.nodeId,
        sourceType: "GMAIL_THREAD",
        sourceId: thread.id,
      },
    });
    if (!existingLink) {
      await prisma.supplyContextSourceLink.create({
        data: {
          officeId: args.context.officeId,
          workspaceId: args.draft.workspaceId,
          nodeId: args.draft.nodeId,
          sourceType: "GMAIL_THREAD",
          sourceId: thread.id,
          label: args.draft.subject,
          visibility: "INTERNAL",
          linkedByUserId: args.context.userId,
        },
      });
    }
  }
  const existingMessage = await prisma.emailMessage.findUnique({
    where: { externalId: args.receipt.providerMessageId },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.emailMessage.upsert({
      where: { externalId: args.receipt.providerMessageId },
      update: {},
      create: {
        threadId: localThreadId,
        accountId: sender.id,
        externalId: args.receipt.providerMessageId,
        gmailMessageId: args.receipt.providerMessageId,
        direction: "OUTBOUND",
        fromEmail: sender.email,
        toEmails: JSON.stringify([args.draft.recipient]),
        subject: args.draft.subject,
        bodyText: args.draft.body,
        sentAt: now,
      },
    }),
    prisma.emailThread.update({
      where: { id: localThreadId },
      data: {
        externalThreadId: args.receipt.providerThreadId,
        lastMessageAt: now,
        ...(existingMessage ? {} : { messageCount: { increment: 1 } }),
      },
    }),
  ]);
  const sent = await prisma.supplyContextOutboundDraft.update({
    where: { id: args.draft.id, officeId: args.context.officeId },
    data: {
      state: "SENT",
      linkedThreadId: localThreadId,
      sentAt: now,
      providerMessageId: args.receipt.providerMessageId,
      providerThreadId: args.receipt.providerThreadId,
      sendError: null,
    },
  });
  await emitContextMemory({
    officeId: args.context.officeId,
    companyId: workspace.companyId,
    nodeId: args.draft.nodeId,
    recordId: args.draft.id,
    kind: "send",
    title: args.draft.subject,
    text: args.draft.body,
    visibility: "INTERNAL",
    actorType: "user",
    actorId: args.context.userId,
    payload: {
      workspaceId: args.draft.workspaceId,
      nodeId: args.draft.nodeId,
      draftId: args.draft.id,
      state: "SENT",
      providerMessageId: args.receipt.providerMessageId,
      providerThreadId: args.receipt.providerThreadId,
      contextHash: args.draft.contextHash,
    },
  });
  return sent;
}

export async function sendSupplyContextOutboundDraft(args: {
  context: SupplyAccessContext;
  draftId: string;
  provider?: SupplierEmailProvider;
}) {
  await reviewer(args.context);
  const draft = await prisma.supplyContextOutboundDraft.findFirst({
    where: { id: args.draftId, officeId: args.context.officeId },
  });
  if (!draft) throw new SupplyPersistenceError("Supplier draft not found.", "not_found");
  const workspace = await requireSupplyWorkspace(args.context, draft.workspaceId, "edit");
  if (draft.state === "SENT") return draft;
  if (draft.state !== "APPROVED") {
    throw new SupplyPersistenceError("Approve the supplier draft before sending it.", "conflict");
  }
  if (!draft.senderAccountId) throw new SupplyPersistenceError("The approved Gmail sender is missing.", "conflict");
  const sender = await prisma.emailAccount.findFirst({
    where: { id: draft.senderAccountId, officeId: args.context.officeId, provider: "GMAIL", isActive: true },
    select: { id: true, email: true },
  });
  if (!sender) throw new SupplyPersistenceError("The approved Gmail sender is unavailable.", "conflict");
  const linkedThread = draft.linkedThreadId ? await prisma.emailThread.findFirst({
    where: { id: draft.linkedThreadId, officeId: args.context.officeId, companyId: workspace.companyId },
    select: { id: true, externalThreadId: true, messages: { orderBy: { sentAt: "desc" }, take: 1, select: { externalId: true } } },
  }) : null;
  const claimed = await prisma.supplyContextOutboundDraft.updateMany({
    where: { id: draft.id, officeId: args.context.officeId, state: "APPROVED" },
    data: { state: "SENDING", sendError: null },
  });
  if (claimed.count !== 1) throw new SupplyPersistenceError("Supplier draft send changed concurrently.", "conflict");
  const rfcMessageId = `<context-${draft.id}@usederya.com>`;
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.send({
    officeId: args.context.officeId,
    accountId: sender.id,
    senderEmail: sender.email,
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
    rfcMessageId,
    providerThreadId: linkedThread?.externalThreadId ?? null,
    inReplyToRfcMessageId: linkedThread?.messages[0]?.externalId ?? null,
  });
  if (receipt.state !== "SENT") {
    return prisma.supplyContextOutboundDraft.update({
      where: { id: draft.id },
      data: {
        state: receipt.state === "UNKNOWN" ? "DELIVERY_UNKNOWN" : "FAILED",
        sendError: receipt.error,
      },
    });
  }
  return completeSupplyContextOutboundDelivery({ context: args.context, draft, receipt });
}

export async function reconcileSupplyContextOutboundDraft(args: {
  context: SupplyAccessContext;
  draftId: string;
  provider?: SupplierEmailProvider;
}) {
  await reviewer(args.context);
  const draft = await prisma.supplyContextOutboundDraft.findFirst({
    where: { id: args.draftId, officeId: args.context.officeId },
  });
  if (!draft) throw new SupplyPersistenceError("Supplier draft not found.", "not_found");
  if (draft.state === "SENT") return draft;
  if (!["SENDING", "DELIVERY_UNKNOWN"].includes(draft.state)) {
    throw new SupplyPersistenceError("This supplier draft does not need delivery reconciliation.", "conflict");
  }
  if (draft.state === "SENDING" && draft.updatedAt.getTime() > Date.now() - 30_000) {
    throw new SupplyPersistenceError("The Gmail send is still active. Reconcile after 30 seconds.", "conflict");
  }
  await requireSupplyWorkspace(args.context, draft.workspaceId, "edit");
  if (!draft.senderAccountId) throw new SupplyPersistenceError("The approved Gmail sender is missing.", "conflict");
  const sender = await prisma.emailAccount.findFirst({
    where: { id: draft.senderAccountId, officeId: args.context.officeId, provider: "GMAIL", isActive: true },
    select: { id: true, email: true },
  });
  if (!sender) throw new SupplyPersistenceError("The approved Gmail sender is unavailable.", "conflict");
  const claimed = await prisma.supplyContextOutboundDraft.updateMany({
    where: {
      id: draft.id,
      officeId: args.context.officeId,
      state: draft.state,
      updatedAt: draft.updatedAt,
    },
    data: { state: "SENDING" },
  });
  if (claimed.count !== 1) {
    throw new SupplyPersistenceError("Supplier draft reconciliation changed concurrently.", "conflict");
  }
  const provider = args.provider ?? gmailSupplierEmailProvider;
  const receipt = await provider.reconcile({
    officeId: args.context.officeId,
    accountId: sender.id,
    senderEmail: sender.email,
    rfcMessageId: `<context-${draft.id}@usederya.com>`,
  });
  if (receipt.state === "SENT") {
    return completeSupplyContextOutboundDelivery({ context: args.context, draft, receipt });
  }
  return prisma.supplyContextOutboundDraft.update({
    where: { id: draft.id },
    data: receipt.state === "NOT_FOUND"
      ? {
        state: "FAILED",
        sendError: "Gmail did not find the stable message ID. Review the draft before retrying.",
      }
      : {
        state: "DELIVERY_UNKNOWN",
        sendError: receipt.error ?? "Gmail reconciliation did not return a definitive result.",
      },
  });
}
