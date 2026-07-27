// Pure regression coverage for outreach quotas, calendar boundaries, ranking,
// and progress reporting.
// Run: npx tsx scripts/crm-outreach.test.ts

import {
  OUTREACH_CHANNELS,
  addDaysToDateKey,
  buildOutreachReport,
  compareOutreachCandidates,
  outreachCalendar,
} from "../src/lib/crm-outreach";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

check(
  "daily channel targets are 20, 30, and 30",
  JSON.stringify(OUTREACH_CHANNELS.map((channel) => channel.dailyTarget)) ===
    JSON.stringify([20, 30, 30]),
);
check(
  "weekly pool is seven times daily capacity",
  OUTREACH_CHANNELS.reduce((sum, channel) => sum + channel.dailyTarget * 7, 0) === 560,
);
check("date keys cross month boundaries", addDaysToDateKey("2026-07-31", 1) === "2026-08-01");

const sundayLate = outreachCalendar(new Date("2026-07-27T06:30:00.000Z"));
check("Los Angeles late Sunday stays Sunday", sundayLate.todayKey === "2026-07-26");
check("Sunday belongs to the previous Monday week", sundayLate.weekStartKey === "2026-07-20");

const mondayMorning = outreachCalendar(new Date("2026-07-27T16:00:00.000Z"));
check("Monday starts a new outreach week", mondayMorning.weekStartKey === "2026-07-27");

const ranked = [
  { id: "medium-old", importance: "medium", createdAt: "2026-01-01T00:00:00Z" },
  { id: "critical-new", importance: "critical", createdAt: "2026-06-01T00:00:00Z" },
  { id: "critical-old", importance: "critical", createdAt: "2026-02-01T00:00:00Z" },
].sort(compareOutreachCandidates);
check(
  "importance wins before age",
  ranked.map((candidate) => candidate.id).join(",") ===
    "critical-old,critical-new,medium-old",
);

const now = new Date("2026-07-29T18:00:00.000Z");
const report = buildOutreachReport(
  [
    {
      channel: "bookface",
      status: "REACHED_OUT",
      weekStartKey: "2026-07-27",
      scheduledForKey: "2026-07-29",
      reachedOutAt: "2026-07-29T17:00:00.000Z",
    },
    {
      channel: "bookface",
      status: "TODAY",
      weekStartKey: "2026-07-27",
      scheduledForKey: "2026-07-29",
      reachedOutAt: null,
    },
    {
      channel: "linkedin",
      status: "REACHED_OUT",
      weekStartKey: "2026-07-27",
      scheduledForKey: "2026-07-28",
      reachedOutAt: "2026-07-28T18:00:00.000Z",
    },
    {
      channel: "email",
      status: "REACHED_OUT",
      weekStartKey: "2026-07-27",
      scheduledForKey: "2026-07-27",
      reachedOutAt: "2026-07-27T18:00:00.000Z",
    },
  ],
  now,
);

check("report counts today's completed outreach", report.today.reached === 1);
check("report keeps the total daily target at 80", report.today.target === 80);
check("report counts yesterday independently", report.yesterday.reached === 1);
check("report counts this week's completed outreach", report.week.reached === 3);
check("report counts the open daily queue", report.dueNow === 1);
check("report counts current weekly pool membership", report.weeklyPlanned === 4);
check("report exposes the weekly pool shortfall", report.weeklyGap === 556);

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("crm-outreach.test.ts passed");
