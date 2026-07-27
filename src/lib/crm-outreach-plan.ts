import "server-only";

import { prisma } from "@/lib/prisma";
import {
  OUTREACH_ELIGIBLE_CATEGORY_VALUES,
  toContactRow,
} from "@/lib/contact-fields";
import {
  OUTREACH_CHANNELS,
  compareOutreachCandidates,
  dateKeyToUtcDate,
  outreachCalendar,
  outreachDateKey,
  type OutreachPlanRow,
} from "@/lib/crm-outreach";

const OPEN_PLAN_STATUSES = ["WEEKLY", "TODAY"];
const ELIGIBLE_CONTACT_STATUSES = ["not_contacted", "queued"];
const LOOKBACK_DAYS = 10;
const MAX_CANDIDATES_PER_CHANNEL = 5000;

function isEligibleContactStatus(status: string | null): boolean {
  return status == null || ELIGIBLE_CONTACT_STATUSES.includes(status);
}

function isEligibleContactCategory(category: string | null): boolean {
  return OUTREACH_ELIGIBLE_CATEGORY_VALUES.some((candidate) => candidate === category);
}

function isKnownChannel(channel: string | null): channel is "bookface" | "linkedin" | "email" {
  return OUTREACH_CHANNELS.some((candidate) => candidate.key === channel);
}

function storedDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function ensureOutreachPlan(
  officeId: string,
  now: Date = new Date(),
): Promise<void> {
  const calendar = outreachCalendar(now);
  const weekStart = dateKeyToUtcDate(calendar.weekStartKey);
  const today = dateKeyToUtcDate(calendar.todayKey);

  // Keep open plan rows aligned with contact state and carry unfinished work
  // into the current week. Completed rows stay in their original week.
  const openItems = await prisma.outreachPlanItem.findMany({
    where: {
      officeId,
      contact: { company: { officeId } },
      OR: [
        { status: { in: OPEN_PLAN_STATUSES } },
        { status: "SKIPPED", weekStart },
      ],
    },
    select: {
      id: true,
      status: true,
      weekStart: true,
      channel: true,
      contact: {
        select: {
          status: true,
          category: true,
          outreachChannel: true,
        },
      },
    },
  });

  const maintenance = openItems.flatMap((item) => {
    const eligible =
      isEligibleContactStatus(item.contact.status) &&
      isEligibleContactCategory(item.contact.category);
    const channel = item.contact.outreachChannel;
    if (!eligible || !isKnownChannel(channel)) {
      if (item.status === "SKIPPED") return [];
      return [prisma.outreachPlanItem.updateMany({
        where: { id: item.id, officeId, status: { in: OPEN_PLAN_STATUSES } },
        data: { status: "SKIPPED", scheduledFor: null },
      })];
    }
    const needsWeekCarry = item.weekStart < weekStart;
    const needsChannelSync = item.channel !== channel;
    const needsReactivation = item.status === "SKIPPED";
    if (!needsWeekCarry && !needsChannelSync && !needsReactivation) return [];
    return [prisma.outreachPlanItem.updateMany({
      where: {
        id: item.id,
        officeId,
        status: { in: [...OPEN_PLAN_STATUSES, "SKIPPED"] },
      },
      data: {
        weekStart: needsWeekCarry ? weekStart : undefined,
        channel: needsChannelSync ? channel : undefined,
        status: needsReactivation ? "WEEKLY" : undefined,
        scheduledFor: needsReactivation ? null : undefined,
      },
    })];
  });

  if (maintenance.length > 0) {
    await prisma.$transaction(maintenance);
  }

  // Fill the weekly pool to seven days of channel capacity. The preferred
  // channel is explicit on Contact, so a person can occupy only one slot.
  for (const channel of OUTREACH_CHANNELS) {
    const weeklyTarget = channel.dailyTarget * 7;
    const existing = await prisma.outreachPlanItem.count({
      where: {
        officeId,
        weekStart,
        channel: channel.key,
        status: { not: "SKIPPED" },
        contact: { company: { officeId } },
      },
    });
    const deficit = Math.max(0, weeklyTarget - existing);
    if (deficit === 0) continue;

    const candidates = await prisma.contact.findMany({
      where: {
        company: { officeId },
        category: { in: [...OUTREACH_ELIGIBLE_CATEGORY_VALUES] },
        outreachChannel: channel.key,
        OR: [
          { status: null },
          { status: { in: ELIGIBLE_CONTACT_STATUSES } },
        ],
        outreachPlanItems: {
          none: {
            officeId,
            status: { in: OPEN_PLAN_STATUSES },
          },
        },
      },
      select: {
        id: true,
        importance: true,
        createdAt: true,
      },
      take: MAX_CANDIDATES_PER_CHANNEL,
    });
    const selected = candidates.sort(compareOutreachCandidates).slice(0, deficit);
    if (selected.length === 0) continue;

    await prisma.$transaction([
      prisma.outreachPlanItem.createMany({
        data: selected.map((contact) => ({
          officeId,
          contactId: contact.id,
          weekStart,
          channel: channel.key,
          status: "WEEKLY",
        })),
        skipDuplicates: true,
      }),
      prisma.contact.updateMany({
        where: {
          id: { in: selected.map((contact) => contact.id) },
          company: { officeId },
          OR: [{ status: null }, { status: "not_contacted" }],
        },
        data: { status: "queued" },
      }),
    ]);
  }

  // Promote only today's capacity. Overdue work and outreach completed today
  // both consume capacity, so refreshing the page cannot create an endless
  // queue after each completed row.
  const currentItems = await prisma.outreachPlanItem.findMany({
    where: {
      officeId,
      weekStart,
      status: { not: "SKIPPED" },
      contact: { company: { officeId } },
    },
    select: {
      id: true,
      channel: true,
      status: true,
      scheduledFor: true,
      reachedOutAt: true,
      updatedAt: true,
      contact: { select: { importance: true } },
    },
  });

  for (const channel of OUTREACH_CHANNELS) {
    const items = currentItems.filter((item) => item.channel === channel.key);
    const occupied = items.filter((item) => {
      if (
        item.status === "TODAY" &&
        item.scheduledFor &&
        storedDateKey(item.scheduledFor) <= calendar.todayKey
      ) {
        return true;
      }
      return (
        item.status === "REACHED_OUT" &&
        item.reachedOutAt != null &&
        outreachDateKey(item.reachedOutAt) === calendar.todayKey
      );
    }).length;
    const capacity = Math.max(0, channel.dailyTarget - occupied);
    if (capacity === 0) continue;

    const promote = items
      .filter(
        (item) =>
          item.status === "WEEKLY" &&
          (
            item.scheduledFor == null ||
            storedDateKey(item.scheduledFor) <= calendar.todayKey
          ),
      )
      .sort((left, right) =>
        compareOutreachCandidates(
          { id: left.id, importance: left.contact.importance, createdAt: left.updatedAt },
          { id: right.id, importance: right.contact.importance, createdAt: right.updatedAt },
        ))
      .slice(0, capacity);
    if (promote.length === 0) continue;

    await prisma.outreachPlanItem.updateMany({
      where: {
        officeId,
        id: { in: promote.map((item) => item.id) },
        status: "WEEKLY",
      },
      data: {
        status: "TODAY",
        scheduledFor: today,
      },
    });
  }
}

export async function loadOutreachPlanRows(
  officeId: string,
  now: Date = new Date(),
): Promise<OutreachPlanRow[]> {
  const calendar = outreachCalendar(now);
  const weekStart = dateKeyToUtcDate(calendar.weekStartKey);
  const today = dateKeyToUtcDate(calendar.todayKey);
  const lookback = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const items = await prisma.outreachPlanItem.findMany({
    where: {
      officeId,
      contact: { company: { officeId } },
      OR: [
        { weekStart, status: { not: "SKIPPED" } },
        { status: "TODAY", scheduledFor: { lte: today } },
        { reachedOutAt: { gte: lookback } },
      ],
    },
    select: {
      id: true,
      contactId: true,
      channel: true,
      status: true,
      weekStart: true,
      scheduledFor: true,
      reachedOutAt: true,
      createdAt: true,
      contact: {
        select: {
          id: true,
          fullName: true,
          companyId: true,
          status: true,
          importance: true,
          category: true,
          relationshipType: true,
          title: true,
          outreachChannel: true,
          email: true,
          linkedinUrl: true,
          bookfaceUrl: true,
          phone: true,
          location: true,
          notes: true,
          lastTouchAt: true,
          company: { select: { name: true } },
        },
      },
    },
    orderBy: [
      { scheduledFor: { sort: "asc", nulls: "last" } },
      { channel: "asc" },
      { createdAt: "asc" },
    ],
  });

  return items.map((item) => ({
    id: item.id,
    contactId: item.contactId,
    channel: item.channel,
    status: item.status,
    weekStartKey: storedDateKey(item.weekStart),
    scheduledForKey: item.scheduledFor ? storedDateKey(item.scheduledFor) : null,
    reachedOutAt: item.reachedOutAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    contact: toContactRow(item.contact),
  }));
}

export async function prepareOutreachWorkspace(
  officeId: string,
  now: Date = new Date(),
): Promise<OutreachPlanRow[]> {
  await ensureOutreachPlan(officeId, now);
  return loadOutreachPlanRows(officeId, now);
}
