export const GMAIL_RECENT_SYNC_DAYS = 14;
export const GMAIL_BACKFILL_MONTHS = 60;
export const GMAIL_BACKFILL_THREADS_PER_WINDOW = 250;

export type GmailBackfillWindow = {
  label: string;
  after: string;
  before: string;
  query: string;
};

function utcMonthStart(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex, 1));
}

function addUtcMonths(date: Date, months: number): Date {
  return utcMonthStart(date.getUTCFullYear(), date.getUTCMonth() + months);
}

export function formatGmailQueryDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function withCommonGmailExclusions(query: string): string {
  return `${query} -in:spam -in:trash`;
}

export function buildRecentGmailSyncQuery(days: number = GMAIL_RECENT_SYNC_DAYS): string {
  return withCommonGmailExclusions(`newer_than:${days}d`);
}

export function buildGmailDateWindowQuery(input: { after: string; before: string }): string {
  return withCommonGmailExclusions(`after:${input.after} before:${input.before}`);
}

export function buildGmailBackfillWindows(input: {
  monthsBack?: number;
  now?: Date;
} = {}): GmailBackfillWindow[] {
  const monthsBack = Math.max(1, Math.floor(input.monthsBack ?? GMAIL_BACKFILL_MONTHS));
  const now = input.now ?? new Date();
  const currentMonthStart = utcMonthStart(now.getUTCFullYear(), now.getUTCMonth());
  const windows: GmailBackfillWindow[] = [];

  for (let offset = 0; offset < monthsBack; offset++) {
    const start = addUtcMonths(currentMonthStart, -offset);
    const end = addUtcMonths(start, 1);
    const after = formatGmailQueryDate(start);
    const before = formatGmailQueryDate(end);
    const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
    windows.push({
      label,
      after,
      before,
      query: buildGmailDateWindowQuery({ after, before }),
    });
  }

  return windows;
}
