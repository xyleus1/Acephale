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
