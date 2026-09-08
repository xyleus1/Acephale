import { DEMO_EMAIL_THREAD_MARKER } from "@/lib/email-demo-markers";
import { UNROUTED_MAIL_THREAD_MARKER } from "@/lib/inbound-mail-routing";
import { prisma } from "@/lib/prisma";

export type RoutedMemoryCandidate = {
  sourceType?: string | null;
  canonicalType?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  companyId?: string | null;
  emailThreadId?: string | null;
};

export type RoutedMemoryDatabase = {
  emailMessage: {
    findMany(args: unknown): Promise<Array<{ id: string; threadId: string }>>;
  };
  emailThread: {
    findMany(args: unknown): Promise<Array<{ id: string; companyId: string | null }>>;
  };
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isEmailCandidate(candidate: RoutedMemoryCandidate) {
  const canonicalType = normalized(candidate.canonicalType);
  const entityType = normalized(candidate.entityType);
  const sourceType = normalized(candidate.sourceType);
  return Boolean(candidate.emailThreadId) ||
    canonicalType === "email_thread" || canonicalType === "email_message" ||
    entityType === "email_thread" || entityType === "email_message" ||
    sourceType === "gmail" || sourceType === "imap" || sourceType === "whatsapp";
}

function isEmailMessageCandidate(candidate: RoutedMemoryCandidate) {
  const canonicalType = normalized(candidate.canonicalType);
  const entityType = normalized(candidate.entityType);
  return canonicalType === "email_message" || entityType === "email_message";
}

function isEmailThreadCandidate(candidate: RoutedMemoryCandidate) {
  const canonicalType = normalized(candidate.canonicalType);
  const entityType = normalized(candidate.entityType);
  return canonicalType === "email_thread" || entityType === "email_thread";
}

/**
 * Rechecks current routed ownership before historical email evidence is exposed.
 * Knowledge rows are immutable history, while routing and visibility can change.
 */
export async function filterRoutedMemoryCandidates<T extends RoutedMemoryCandidate>(
  officeId: string,
  candidates: T[],
  database: RoutedMemoryDatabase = prisma as unknown as RoutedMemoryDatabase,
  expectedCompanyId?: string | null,
): Promise<T[]> {
  const emailCandidates = candidates.filter(isEmailCandidate);
  if (!emailCandidates.length) return candidates;

  const messageIds = [...new Set(emailCandidates.flatMap((candidate) => {
    return isEmailMessageCandidate(candidate) && candidate.entityId ? [candidate.entityId] : [];
  }))];
  const messages = messageIds.length
    ? await database.emailMessage.findMany({
        where: { id: { in: messageIds }, thread: { officeId } },
        select: { id: true, threadId: true },
      }).catch(() => [])
    : [];
  const messageThreads = new Map(messages.map((message) => [message.id, message.threadId]));
  const candidateThreadId = (candidate: RoutedMemoryCandidate) => {
    if (isEmailMessageCandidate(candidate)) {
      if (!candidate.entityId) return null;
      const currentThreadId = messageThreads.get(candidate.entityId) ?? null;
      if (!currentThreadId) return null;
      if (candidate.emailThreadId && candidate.emailThreadId !== currentThreadId) return null;
      return currentThreadId;
    }
    if (isEmailThreadCandidate(candidate)) {
      const currentThreadId = candidate.entityId ?? candidate.emailThreadId ?? null;
      if (candidate.entityId && candidate.emailThreadId && candidate.entityId !== candidate.emailThreadId) {
        return null;
      }
      return currentThreadId;
    }
    if (candidate.emailThreadId) return candidate.emailThreadId;
    return null;
  };
  const threadIds = [...new Set(emailCandidates
    .map(candidateThreadId)
    .filter((id): id is string => Boolean(id)))];
  const routedThreads = threadIds.length
    ? await database.emailThread.findMany({
        where: {
          id: { in: threadIds },
          officeId,
          companyId: { not: null },
          hiddenAt: null,
          OR: [
            { autoLinkSkipReason: null },
            {
              autoLinkSkipReason: {
                notIn: [UNROUTED_MAIL_THREAD_MARKER, DEMO_EMAIL_THREAD_MARKER],
              },
            },
          ],
        },
        select: { id: true, companyId: true },
      }).catch(() => [])
    : [];
  const routedThreadCompanies = new Map(routedThreads.map((thread) => [thread.id, thread.companyId]));

  return candidates.flatMap((candidate) => {
    if (!isEmailCandidate(candidate)) return [candidate];
    const threadId = candidateThreadId(candidate);
    if (!threadId) return [];
    const routedCompanyId = routedThreadCompanies.get(threadId);
    if (!routedCompanyId) return [];
    const requiredCompanyId = expectedCompanyId ?? candidate.companyId ?? null;
    if (requiredCompanyId && routedCompanyId !== requiredCompanyId) return [];
    return [{ ...candidate, emailThreadId: threadId } as T];
  });
}
