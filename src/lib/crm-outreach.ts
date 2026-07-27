import {
  contactImportanceRank,
  type ContactRow,
  type OutreachChannel,
} from "./contact-fields";

export const CRM_OUTREACH_TIME_ZONE = "America/Los_Angeles";
export const OUTREACH_WEEK_DAYS = 7;

export const OUTREACH_CHANNELS: ReadonlyArray<{
  key: OutreachChannel;
  label: string;
  dailyTarget: number;
}> = [
  { key: "bookface", label: "Bookface", dailyTarget: 20 },
  { key: "linkedin", label: "LinkedIn", dailyTarget: 30 },
  { key: "email", label: "Email", dailyTarget: 30 },
];

export type OutreachPlanStatus = "WEEKLY" | "TODAY" | "REACHED_OUT" | "SKIPPED";

export type OutreachPlanMetricRow = {
  channel: string;
  status: string;
  weekStartKey: string;
  scheduledForKey: string | null;
  reachedOutAt: string | null;
};

export type OutreachPlanRow = OutreachPlanMetricRow & {
  id: string;
  contactId: string;
  createdAt: string;
  contact: ContactRow;
};

export type OutreachPeriodProgress = {
  reached: number;
  target: number;
  remaining: number;
  percent: number;
};

export type OutreachChannelReport = {
  key: OutreachChannel;
  label: string;
  dailyTarget: number;
  weeklyTarget: number;
  dueNow: number;
  weeklyPlanned: number;
  weeklyGap: number;
  today: OutreachPeriodProgress;
  yesterday: OutreachPeriodProgress;
  week: OutreachPeriodProgress;
};

export type OutreachReport = {
  todayKey: string;
  yesterdayKey: string;
  weekStartKey: string;
  channels: OutreachChannelReport[];
  today: OutreachPeriodProgress;
  yesterday: OutreachPeriodProgress;
  week: OutreachPeriodProgress;
  dueNow: number;
  weeklyPlanned: number;
  weeklyTarget: number;
  weeklyGap: number;
};

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
}

export function outreachDateKey(
  date: Date,
  timeZone = CRM_OUTREACH_TIME_ZONE,
): string {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dateKeyToUtcDate(dateKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid outreach date key: ${dateKey}`);
  }
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function outreachWeekStartKey(dateKey: string): string {
  const date = dateKeyToUtcDate(dateKey);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addDaysToDateKey(dateKey, -daysSinceMonday);
}

export function outreachCalendar(
  now: Date = new Date(),
  timeZone = CRM_OUTREACH_TIME_ZONE,
) {
  const todayKey = outreachDateKey(now, timeZone);
  return {
    todayKey,
    yesterdayKey: addDaysToDateKey(todayKey, -1),
    weekStartKey: outreachWeekStartKey(todayKey),
  };
}

export function formatOutreachDateKey(
  dateKey: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })
    .format(dateKeyToUtcDate(dateKey));
}

function progress(reached: number, target: number): OutreachPeriodProgress {
  return {
    reached,
    target,
    remaining: Math.max(0, target - reached),
    percent: target === 0 ? 100 : Math.min(100, Math.round((reached / target) * 100)),
  };
}

function totalProgress(
  reports: OutreachChannelReport[],
  period: "today" | "yesterday" | "week",
): OutreachPeriodProgress {
  return progress(
    reports.reduce((sum, report) => sum + report[period].reached, 0),
    reports.reduce((sum, report) => sum + report[period].target, 0),
  );
}

export function buildOutreachReport(
  items: OutreachPlanMetricRow[],
  now: Date = new Date(),
  timeZone = CRM_OUTREACH_TIME_ZONE,
): OutreachReport {
  const calendar = outreachCalendar(now, timeZone);
  const reachedKey = (item: OutreachPlanMetricRow) =>
    item.reachedOutAt ? outreachDateKey(new Date(item.reachedOutAt), timeZone) : null;

  const channels = OUTREACH_CHANNELS.map((channel): OutreachChannelReport => {
    const channelItems = items.filter((item) => item.channel === channel.key);
    const weeklyTarget = channel.dailyTarget * OUTREACH_WEEK_DAYS;
    const weeklyPlanned = channelItems.filter(
      (item) => item.weekStartKey === calendar.weekStartKey && item.status !== "SKIPPED",
    ).length;
    const reachedToday = channelItems.filter(
      (item) => reachedKey(item) === calendar.todayKey,
    ).length;
    const reachedYesterday = channelItems.filter(
      (item) => reachedKey(item) === calendar.yesterdayKey,
    ).length;
    const reachedThisWeek = channelItems.filter((item) => {
      const key = reachedKey(item);
      return key != null && key >= calendar.weekStartKey && key <= calendar.todayKey;
    }).length;
    const dueNow = channelItems.filter(
      (item) =>
        item.status === "TODAY" &&
        item.scheduledForKey != null &&
        item.scheduledForKey <= calendar.todayKey,
    ).length;

    return {
      key: channel.key,
      label: channel.label,
      dailyTarget: channel.dailyTarget,
      weeklyTarget,
      dueNow,
      weeklyPlanned,
      weeklyGap: Math.max(0, weeklyTarget - weeklyPlanned),
      today: progress(reachedToday, channel.dailyTarget),
      yesterday: progress(reachedYesterday, channel.dailyTarget),
      week: progress(reachedThisWeek, weeklyTarget),
    };
  });

  const weeklyPlanned = channels.reduce((sum, channel) => sum + channel.weeklyPlanned, 0);
  const weeklyTarget = channels.reduce((sum, channel) => sum + channel.weeklyTarget, 0);

  return {
    ...calendar,
    channels,
    today: totalProgress(channels, "today"),
    yesterday: totalProgress(channels, "yesterday"),
    week: totalProgress(channels, "week"),
    dueNow: channels.reduce((sum, channel) => sum + channel.dueNow, 0),
    weeklyPlanned,
    weeklyTarget,
    weeklyGap: Math.max(0, weeklyTarget - weeklyPlanned),
  };
}

export type OutreachCandidatePriority = {
  id: string;
  importance: string | null;
  createdAt: Date | string;
};

export function compareOutreachCandidates(
  left: OutreachCandidatePriority,
  right: OutreachCandidatePriority,
): number {
  const importance = contactImportanceRank(left.importance) - contactImportanceRank(right.importance);
  if (importance !== 0) return importance;
  const created = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (created !== 0) return created;
  return left.id.localeCompare(right.id);
}
