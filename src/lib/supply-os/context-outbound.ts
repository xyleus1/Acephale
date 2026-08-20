import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { stripEmDashes } from "@/lib/no-em-dash";
import { cleanContextBody, cleanContextText } from "./context-contract";
import { assembleSupplyContext, emitContextMemory } from "./context-persistence";
import { gmailSupplierEmailProvider, type SupplierEmailProvider } from "./supplier-email-provider";
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
    where: { id: args.draftId, officeId: args.context.officeId, state: { in: ["DRAFT", "PENDING_REVIEW"] } },
  });
  if (!draft) throw new SupplyPersistenceError("Reviewable supplier draft not found.", "not_found");
  await requireSupplyWorkspace(args.context, draft.workspaceId, "edit");
  return prisma.supplyContextOutboundDraft.update({
    where: { id: draft.id },
    data: { state: decision, reviewedByUserId: args.context.userId, reviewedAt: new Date() },
  });
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
  const now = new Date();
  let localThreadId = linkedThread?.id ?? null;
  if (!localThreadId) {
    const thread = await prisma.emailThread.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        subject: draft.subject,
        participants: JSON.stringify([sender.email, draft.recipient]),
        externalThreadId: receipt.providerThreadId,
        lastMessageAt: now,
        messageCount: 0,
      },
    });
    localThreadId = thread.id;
    await prisma.supplyContextSourceLink.create({
      data: {
        officeId: args.context.officeId,
        workspaceId: draft.workspaceId,
        nodeId: draft.nodeId,
        sourceType: "GMAIL_THREAD",
        sourceId: thread.id,
        label: draft.subject,
        visibility: "INTERNAL",
        linkedByUserId: args.context.userId,
      },
    });
  }
  await prisma.$transaction([
    prisma.emailMessage.upsert({
      where: { externalId: receipt.providerMessageId },
      update: {},
      create: {
        threadId: localThreadId,
        accountId: sender.id,
        externalId: receipt.providerMessageId,
        gmailMessageId: receipt.providerMessageId,
        direction: "OUTBOUND",
        fromEmail: sender.email,
        toEmails: JSON.stringify([draft.recipient]),
        subject: draft.subject,
        bodyText: draft.body,
        sentAt: now,
      },
    }),
    prisma.emailThread.update({ where: { id: localThreadId }, data: { externalThreadId: receipt.providerThreadId, lastMessageAt: now, messageCount: { increment: 1 } } }),
  ]);
  const sent = await prisma.supplyContextOutboundDraft.update({
    where: { id: draft.id },
    data: {
      state: "SENT",
      linkedThreadId: localThreadId,
      sentAt: now,
      providerMessageId: receipt.providerMessageId,
      providerThreadId: receipt.providerThreadId,
      sendError: null,
    },
  });
  await emitContextMemory({
    officeId: args.context.officeId,
    companyId: workspace.companyId,
    nodeId: draft.nodeId,
    recordId: draft.id,
    kind: "send",
    title: draft.subject,
    text: draft.body,
    visibility: "INTERNAL",
    actorType: "user",
    actorId: args.context.userId,
    payload: { workspaceId: draft.workspaceId, nodeId: draft.nodeId, draftId: draft.id, state: "SENT", providerMessageId: receipt.providerMessageId, providerThreadId: receipt.providerThreadId, contextHash: draft.contextHash },
  });
  return sent;
}
