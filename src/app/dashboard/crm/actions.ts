"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { resolveCompanyIdByName } from "@/lib/company-resolve";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import { loadHardwareVcOutreachCampaign } from "@/lib/load-hardware-vc-outreach";
import {
  CONTACT_CATEGORY_VALUES,
  CONTACT_CONTEXT_VALUES,
  CONTACT_IMPORTANCE_VALUES,
  CONTACT_STATUS_VALUES,
  OUTREACH_ELIGIBLE_CATEGORY_VALUES,
  OUTREACH_CHANNEL_VALUES,
  toContactRow,
  type ContactRow,
} from "@/lib/contact-fields";
import {
  OUTREACH_CHANNELS,
  addDaysToDateKey,
  dateKeyToUtcDate,
  outreachCalendar,
} from "@/lib/crm-outreach";

const ROW_SELECT = {
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
} as const;

export type ContactPatch = {
  name?: string;
  companyName?: string;
  status?: string;
  importance?: string;
  category?: string;
  context?: string;
  title?: string;
  outreachChannel?: string;
  email?: string;
  linkedinUrl?: string;
  bookfaceUrl?: string;
  phone?: string;
  location?: string;
  notes?: string;
};

type ActionResult = { row: ContactRow } | { error: string };
type OutreachActionResult =
  | {
      ok: true;
      planItemId: string;
      reachedOutAt?: string;
      scheduledForKey?: string;
    }
  | { error: string };

export type HardwareVcCampaignActionResult =
  | {
      ok: true;
      createdContacts: number;
      reusedContacts: number;
      queued: {
        bookface: number;
        linkedin: number;
        email: number;
      };
    }
  | { error: string };

type ContactData = {
  fullName?: string;
  status?: string | null;
  importance?: string;
  category?: string | null;
  relationshipType?: string;
  title?: string | null;
  outreachChannel?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  bookfaceUrl?: string | null;
  phone?: string | null;
  location?: string | null;
  notes?: string | null;
  companyId?: string;
};

function revalidateCrmWorkspaces() {
  revalidatePath("/dashboard/crm");
  revalidatePath("/dashboard/outreach");
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function enumValue(
  value: string | undefined,
  allowed: readonly string[],
): string | null | "invalid" {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return allowed.includes(trimmed) ? trimmed : "invalid";
}

function buildData(patch: ContactPatch): ContactData | { error: string } {
  const data: ContactData = {};
  if (patch.name !== undefined) {
    const name = text(patch.name);
    if (!name) return { error: "Name is required." };
    data.fullName = name;
  }
  if (patch.status !== undefined) {
    const status = enumValue(patch.status, CONTACT_STATUS_VALUES);
    if (status === "invalid") return { error: "Unknown status." };
    data.status = status;
  }
  if (patch.importance !== undefined) {
    const importance = enumValue(patch.importance, CONTACT_IMPORTANCE_VALUES);
    if (importance === "invalid" || importance === null) {
      return { error: "Unknown importance." };
    }
    data.importance = importance;
  }
  if (patch.category !== undefined) {
    const category = enumValue(patch.category, CONTACT_CATEGORY_VALUES);
    if (category === "invalid") return { error: "Unknown category." };
    data.category = category;
  }
  if (patch.context !== undefined) {
    const context = enumValue(patch.context, CONTACT_CONTEXT_VALUES);
    if (context === "invalid" || context === null) {
      return { error: "Unknown relationship context." };
    }
    data.relationshipType = context;
  }
  if (patch.outreachChannel !== undefined) {
    const channel = enumValue(patch.outreachChannel, OUTREACH_CHANNEL_VALUES);
    if (channel === "invalid") return { error: "Unknown outreach channel." };
    data.outreachChannel = channel;
  }
  if (patch.title !== undefined) data.title = text(patch.title);
  if (patch.email !== undefined) data.email = text(patch.email);
  if (patch.linkedinUrl !== undefined) data.linkedinUrl = text(patch.linkedinUrl);
  if (patch.bookfaceUrl !== undefined) data.bookfaceUrl = text(patch.bookfaceUrl);
  if (patch.phone !== undefined) data.phone = text(patch.phone);
  if (patch.location !== undefined) data.location = text(patch.location);
  if (patch.notes !== undefined) data.notes = text(patch.notes);
  return data;
}

export async function createContactAction(patch: ContactPatch): Promise<ActionResult> {
  const session = await requireSession();
  const name = text(patch.name);
  if (!name) return { error: "Name is required." };
  const companyName = text(patch.companyName);
  if (!companyName) return { error: "Company is required." };

  const data = buildData(patch);
  if ("error" in data) return data;
  const companyId = await resolveCompanyIdByName(session.officeId, companyName);
  if (!companyId) return { error: "Company is required." };

  const contact = await prisma.contact.create({
    data: {
      ...data,
      fullName: name,
      companyId,
      status: data.status ?? "not_contacted",
      importance: data.importance ?? "medium",
      category: data.category ?? "startup",
    },
    select: ROW_SELECT,
  });
  revalidateCrmWorkspaces();
  return { row: toContactRow(contact) };
}

export async function updateContactAction(
  contactId: string,
  patch: ContactPatch,
): Promise<ActionResult> {
  const session = await requireSession();
  const data = buildData(patch);
  if ("error" in data) return data;

  if (patch.companyName !== undefined) {
    const companyName = text(patch.companyName);
    if (!companyName) return { error: "Company is required." };
    const companyId = await resolveCompanyIdByName(session.officeId, companyName);
    if (!companyId) return { error: "Company is required." };
    data.companyId = companyId;
  }

  const updated = await prisma.contact.updateMany({
    where: { id: contactId, company: { officeId: session.officeId } },
    data,
  });
  if (updated.count === 0) return { error: "Contact not found." };

  if (patch.outreachChannel !== undefined) {
    const nextChannel = data.outreachChannel;
    await prisma.outreachPlanItem.updateMany({
      where: {
        officeId: session.officeId,
        contactId,
        status: { in: ["WEEKLY", "TODAY"] },
      },
      data: nextChannel
        ? { channel: nextChannel }
        : { status: "SKIPPED", scheduledFor: null },
    });
  }
  if (
    patch.status !== undefined &&
    typeof data.status === "string" &&
    !["not_contacted", "queued"].includes(data.status)
  ) {
    await prisma.outreachPlanItem.updateMany({
      where: {
        officeId: session.officeId,
        contactId,
        status: { in: ["WEEKLY", "TODAY"] },
      },
      data: { status: "SKIPPED", scheduledFor: null },
    });
  }
  if (
    patch.category !== undefined &&
    !OUTREACH_ELIGIBLE_CATEGORY_VALUES.some((category) => category === data.category)
  ) {
    await prisma.outreachPlanItem.updateMany({
      where: {
        officeId: session.officeId,
        contactId,
        status: { in: ["WEEKLY", "TODAY"] },
      },
      data: { status: "SKIPPED", scheduledFor: null },
    });
  }

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, company: { officeId: session.officeId } },
    select: ROW_SELECT,
  });
  if (!contact) return { error: "Contact not found." };
  revalidateCrmWorkspaces();
  return { row: toContactRow(contact) };
}

export async function deleteContactAction(
  contactId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const deleted = await prisma.contact.deleteMany({
    where: { id: contactId, company: { officeId: session.officeId } },
  });
  if (deleted.count === 0) return { error: "Contact not found." };
  revalidateCrmWorkspaces();
  return { ok: true };
}

export async function loadHardwareVcOutreachAction(): Promise<HardwareVcCampaignActionResult> {
  const session = await requireSession();
  if (!["ADMIN", "MANAGER"].includes(session.role)) {
    return { error: "Only an admin or manager can load a full outreach campaign." };
  }

  try {
    const result = await loadHardwareVcOutreachCampaign(session.officeId);
    revalidateCrmWorkspaces();
    return { ok: true, ...result };
  } catch (error) {
    console.error("[crm-outreach] hardware VC campaign load failed:", error);
    return {
      error: error instanceof Error
        ? error.message
        : "Could not load the hardware VC campaign.",
    };
  }
}

export async function markOutreachReachedAction(
  planItemId: string,
): Promise<OutreachActionResult> {
  const session = await requireSession();
  const reachedOutAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.outreachPlanItem.findFirst({
      where: {
        id: planItemId,
        officeId: session.officeId,
        status: "TODAY",
        contact: { company: { officeId: session.officeId } },
      },
      select: {
        id: true,
        channel: true,
        contactId: true,
        contact: {
          select: {
            fullName: true,
            companyId: true,
            company: { select: { name: true } },
          },
        },
      },
    });
    if (!item) return { error: "This outreach item is no longer in today's queue." } as const;
    const channel = OUTREACH_CHANNELS.find((candidate) => candidate.key === item.channel);
    if (!channel) return { error: "This outreach item has an unknown channel." } as const;

    const claimed = await tx.outreachPlanItem.updateMany({
      where: {
        id: item.id,
        officeId: session.officeId,
        status: "TODAY",
      },
      data: {
        status: "REACHED_OUT",
        reachedOutAt,
      },
    });
    if (claimed.count === 0) {
      return { error: "This outreach item was already updated." } as const;
    }

    const activity = await tx.activity.create({
      data: {
        officeId: session.officeId,
        companyId: item.contact.companyId,
        contactId: item.contactId,
        type: item.channel === "email" ? "EMAIL" : "NOTE",
        occurredAt: reachedOutAt,
        subject: `${channel.label} outreach`,
        body: `Outbound ${channel.label} outreach marked complete in CRM.`,
        source: "crm_outreach",
        sourceRefs: {
          outreachPlanItemId: item.id,
          channel: item.channel,
          direction: "OUTBOUND",
        },
        provenance: {
          source: "crm",
          operation: "mark_outreach_reached",
        },
        createdByUserId: session.userId,
      },
      select: { id: true },
    });

    await tx.contact.updateMany({
      where: {
        id: item.contactId,
        company: { officeId: session.officeId },
      },
      data: {
        status: "reached_out",
        lastTouchAt: reachedOutAt,
      },
    });
    await tx.company.updateMany({
      where: {
        id: item.contact.companyId,
        officeId: session.officeId,
        OR: [{ lastTouchAt: null }, { lastTouchAt: { lt: reachedOutAt } }],
      },
      data: { lastTouchAt: reachedOutAt },
    });

    return {
      ok: true,
      activityId: activity.id,
      channel: item.channel,
      contactId: item.contactId,
      contactName: item.contact.fullName,
      companyName: item.contact.company.name,
    } as const;
  });

  if ("error" in result && typeof result.error === "string") {
    return { error: result.error };
  }

  try {
    await recordMemoryEvent({
      officeId: session.officeId,
      sourceType: "CRM",
      sourceExternalId: `crm:outreach:${planItemId}`,
      sourceLabel: "CRM outreach",
      eventType: "crm.outreach.reached",
      entityType: "contact",
      entityId: result.contactId,
      actorType: "user",
      actorId: session.userId,
      occurredAt: reachedOutAt,
      payload: {
        planItemId,
        activityId: result.activityId,
        channel: result.channel,
        contactName: result.contactName,
        companyName: result.companyName,
      },
      provenance: {
        source: "crm",
        operation: "mark_outreach_reached",
        path: "src/app/dashboard/crm/actions.ts",
        function: "markOutreachReachedAction",
        sourceRecordId: planItemId,
        actorType: "user",
        actorId: session.userId,
      },
      idempotencyKey: `crm:outreach:${planItemId}:reached`,
    });
  } catch (error) {
    console.warn("[crm-outreach] memory event failed:", error);
  }

  revalidateCrmWorkspaces();
  revalidatePath("/dashboard/activity");
  return {
    ok: true,
    planItemId,
    reachedOutAt: reachedOutAt.toISOString(),
  };
}

export async function deferOutreachAction(
  planItemId: string,
): Promise<OutreachActionResult> {
  const session = await requireSession();
  const tomorrowKey = addDaysToDateKey(outreachCalendar().todayKey, 1);
  const deferred = await prisma.outreachPlanItem.updateMany({
    where: {
      id: planItemId,
      officeId: session.officeId,
      status: "TODAY",
      contact: { company: { officeId: session.officeId } },
    },
    data: {
      status: "WEEKLY",
      scheduledFor: dateKeyToUtcDate(tomorrowKey),
    },
  });
  if (deferred.count === 0) {
    return { error: "This outreach item is no longer in today's queue." };
  }
  revalidateCrmWorkspaces();
  return { ok: true, planItemId, scheduledForKey: tomorrowKey };
}
