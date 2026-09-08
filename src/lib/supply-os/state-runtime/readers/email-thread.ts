import "server-only";

import { prisma } from "@/lib/prisma";
import { hashSupplyStateValue } from "@/lib/supply-os/state-runtime/canonicalize";
import type { SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import {
  boundedText,
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  safeIso,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";
import {
  routedCompanyThreadListValue,
  workspaceIdentityValue,
  workspacePresentationValue,
} from "./selectors";

const UNROUTED_MAIL_THREAD_MARKER = "UNROUTED_SHARED_MAILBOX";

type EmailThreadReaderDependencies = {
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findThreads: typeof prisma.emailThread.findMany;
};

const defaultDependencies: EmailThreadReaderDependencies = {
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findThreads: (args) => prisma.emailThread.findMany(args),
};

async function companyContextForInput(
  input: SupplyStateReaderInput,
  dependencies: EmailThreadReaderDependencies,
) {
  // Request, supplier, and item packets require an exact operational link.
  // Their dedicated readers use the order/vendor ledger instead of ambient
  // company mail, so only company and company-owned workspace scopes enter here.
  if (input.scope.type === "company") return { companyId: input.scope.companyId, workspace: null };
  if (input.scope.type !== "workspace") return null;
  const workspace = await dependencies.findWorkspace({
    where: { id: input.scope.workspaceId, officeId: input.scope.officeId, status: "ACTIVE" },
    select: {
      id: true,
      companyId: true,
      externalKey: true,
      name: true,
      status: true,
      version: true,
      archivedAt: true,
    },
  });
  return workspace?.companyId ? { companyId: workspace.companyId, workspace } : null;
}

export async function readEmailThreadState(
  input: SupplyStateReaderInput,
  dependencies: EmailThreadReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  const result = emptySupplyStateReaderResult();
  // Procurement and supplier packets use the exact order/vendor communication
  // ledger readers. Broad company threads would mix unrelated suppliers into
  // those scopes. Item packets likewise have no exact mail linkage in V1.
  if (input.scope.type !== "company" && input.scope.type !== "workspace") return result;
  const companyContext = await companyContextForInput(input, dependencies);
  if (!companyContext) {
    if (input.scope.type === "workspace") {
      result.dependencies.push(makeSupplyStateDependency({
        key: `workspace.identity:${input.scope.workspaceId}`,
        source: "APP_DB",
        entityType: "SupplyWorkspace",
        entityRef: input.scope.workspaceId,
        value: null,
        policy: "STRICT",
        reason: "The routed-email workspace is missing or inactive.",
      }));
    }
    return result;
  }
  const { companyId, workspace } = companyContext;
  if (workspace) {
    result.dependencies.push(
      makeSupplyStateDependency({
        key: `workspace.identity:${workspace.id}`,
        source: "APP_DB",
        entityType: "SupplyWorkspace",
        entityRef: workspace.id,
        value: workspaceIdentityValue(workspace),
        policy: "STRICT",
        reason: "The routed-email workspace ownership or lifecycle changed.",
      }),
      makeSupplyStateDependency({
        key: `workspace.presentation:${workspace.id}`,
        source: "APP_DB",
        entityType: "SupplyWorkspace",
        entityRef: workspace.id,
        value: workspacePresentationValue(workspace),
        policy: "ADVISORY",
        reason: "The routed-email workspace presentation changed.",
      }),
    );
  }
  const threads = await dependencies.findThreads({
    where: {
      officeId: input.scope.officeId,
      companyId,
      hiddenAt: null,
      OR: [
        { autoLinkSkipReason: null },
        { autoLinkSkipReason: { not: UNROUTED_MAIL_THREAD_MARKER } },
      ],
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: 20,
    select: {
      id: true,
      companyId: true,
      subject: true,
      participants: true,
      externalThreadId: true,
      lastMessageAt: true,
      messageCount: true,
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: 10,
        select: {
          id: true,
          externalId: true,
          gmailMessageId: true,
          rfcMessageId: true,
          direction: true,
          fromEmail: true,
          fromName: true,
          toEmails: true,
          ccEmails: true,
          subject: true,
          bodyText: true,
          sentAt: true,
          classification: true,
        },
      },
    },
  });
  const messageEvidence: SupplyWorldEvidenceRef[] = threads.flatMap((thread) => thread.messages.map((message) => ({
    kind: "email_message" as const,
    id: message.id,
    providerMessageId: message.externalId ?? message.gmailMessageId,
  })));
  result.evidenceRefs.push(...messageEvidence);
  result.dependencies.push(makeSupplyStateDependency({
    key: `email.company_threads:${companyId}`,
    source: "EMAIL_LEDGER",
    entityType: "EmailThreadList",
    entityRef: companyId,
    value: routedCompanyThreadListValue(threads),
    policy: "ADVISORY",
    reason: "The bounded routed company email-thread list changed.",
    evidenceRefs: messageEvidence,
  }));
  for (const thread of threads) {
    const newest = thread.messages[0] ?? null;
    result.dependencies.push(makeSupplyStateDependency({
      key: `email.thread:${thread.id}`,
      source: "EMAIL_LEDGER",
      entityType: "EmailThread",
      entityRef: thread.id,
      value: {
        companyId: thread.companyId,
        messageCount: thread.messageCount,
        latestMessageId: newest?.id ?? null,
        latestDirection: newest?.direction ?? null,
        lastMessageAt: safeIso(thread.lastMessageAt),
      },
      version: newest?.id ?? safeIso(thread.lastMessageAt),
      policy: "ADVISORY",
      reason: "A routed company email thread received a new message or changed direction.",
      evidenceRefs: messageEvidence.filter((reference) => thread.messages.some((message) => message.id === reference.id)),
    }));
  }
  result.currentState.routedEmailThreads = threads.map((thread) => ({
    id: thread.id,
    companyId: thread.companyId,
    subject: boundedText(thread.subject, 500),
    participants: boundedText(thread.participants, 2_000),
    externalThreadId: thread.externalThreadId,
    lastMessageAt: safeIso(thread.lastMessageAt),
    messageCount: thread.messageCount,
    messages: thread.messages.slice().reverse().map((message) => ({
      id: message.id,
      providerMessageId: message.externalId ?? message.gmailMessageId,
      rfcMessageId: message.rfcMessageId,
      direction: message.direction,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: boundedText(message.toEmails, 2_000),
      ccEmails: boundedText(message.ccEmails, 2_000) || null,
      subject: boundedText(message.subject, 500) || null,
      bodyExcerpt: boundedText(message.bodyText, 1_000),
      bodyTruncated: Boolean(message.bodyText && message.bodyText.length > 1_000),
      sentAt: safeIso(message.sentAt),
      classification: message.classification,
    })),
  }));
  result.sourceCounts = {
    routedEmailThreads: threads.length,
    routedEmailMessages: threads.reduce((count, thread) => count + thread.messages.length, 0),
    unroutedEmailMessagesIncluded: 0,
  };
  return result;
}
