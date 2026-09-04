export const DEFAULT_EMAIL_DAILY_SEND_LIMIT = 30;
export const MAX_EMAIL_DAILY_SEND_LIMIT = 30;

export type EmailSenderPoolCandidate = {
  id: string;
  email: string;
  dailySendLimit: number;
  sentToday: number;
  reservedToday: number;
};

export function utcDayBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

// A send pinned to one mailbox (a follow up has to leave from the mailbox that
// owns the supplier's thread) must not report the whole pool as empty when that
// single mailbox is the thing that cannot send, since resuming that mailbox and
// connecting a new one are different actions.
export function pinnedSenderUnavailableReason(account: {
  isActive: boolean;
  sendEnabled: boolean;
  sendPausedAt: Date | null;
  sendPausedReason: string | null;
} | null): string {
  if (!account) return "The mailbox this thread was sent from no longer exists.";
  if (account.sendPausedAt) {
    return account.sendPausedReason?.trim()
      ? `The mailbox this thread was sent from is paused by sender protection: ${account.sendPausedReason.trim()}`
      : "The mailbox this thread was sent from is paused by sender protection.";
  }
  if (!account.sendEnabled) return "Sending is turned off for the mailbox this thread was sent from.";
  if (!account.isActive) return "The mailbox this thread was sent from is disabled.";
  return "The mailbox this thread was sent from is no longer connected.";
}

export function validEmailDailySendLimit(value: unknown): value is number {
  return Number.isInteger(value)
    && Number(value) >= 1
    && Number(value) <= MAX_EMAIL_DAILY_SEND_LIMIT;
}

export function rankEmailSenderPoolCandidates<T extends EmailSenderPoolCandidate>(candidates: T[]) {
  return [...candidates].sort((left, right) => {
    const leftUsed = left.sentToday + left.reservedToday;
    const rightUsed = right.sentToday + right.reservedToday;
    const utilizationComparison = (leftUsed * right.dailySendLimit) - (rightUsed * left.dailySendLimit);
    if (utilizationComparison !== 0) return utilizationComparison;
    if (leftUsed !== rightUsed) return leftUsed - rightUsed;
    const emailComparison = left.email.localeCompare(right.email);
    return emailComparison !== 0 ? emailComparison : left.id.localeCompare(right.id);
  });
}

export function selectEmailSenderPoolCandidate<T extends EmailSenderPoolCandidate>(candidates: T[]) {
  return rankEmailSenderPoolCandidates(candidates)
    .find((candidate) => candidate.sentToday + candidate.reservedToday < candidate.dailySendLimit) ?? null;
}
