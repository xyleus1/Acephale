"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { resolveCompanyIdByName } from "@/lib/company-resolve";
import {
  CONTACT_STATUS_VALUES,
  CONTACT_TYPE_VALUES,
  RELATIONSHIP_LEVEL_VALUES,
  toContactRow,
  type ContactRow,
} from "@/lib/contact-fields";

const ROW_SELECT = {
  id: true,
  fullName: true,
  companyId: true,
  category: true,
  status: true,
  relationshipStrength: true,
  email: true,
  phone: true,
  location: true,
  notes: true,
  lastTouchAt: true,
  company: { select: { name: true } },
} as const;

export type ContactPatch = {
  name?: string;
  companyName?: string;
  type?: string;
  status?: string;
  relationship?: string;
  email?: string;
  phone?: string;
  location?: string;
  notes?: string;
};

type ActionResult = { row: ContactRow } | { error: string };

// Prisma-compatible shape for the writable columns of the sheet.
type ContactData = {
  fullName?: string;
  category?: string | null;
  status?: string | null;
  relationshipStrength?: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  notes?: string | null;
  companyId?: string;
};

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function enumValue(value: string | undefined, allowed: string[]): string | null | "invalid" {
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
  if (patch.type !== undefined) {
    const type = enumValue(patch.type, CONTACT_TYPE_VALUES);
    if (type === "invalid") return { error: "Unknown type." };
    data.category = type;
  }
  if (patch.status !== undefined) {
    const status = enumValue(patch.status, CONTACT_STATUS_VALUES);
    if (status === "invalid") return { error: "Unknown status." };
    data.status = status;
  }
  if (patch.relationship !== undefined) {
    const relationship = enumValue(patch.relationship, RELATIONSHIP_LEVEL_VALUES);
    if (relationship === "invalid" || relationship === null) return { error: "Unknown relationship." };
    data.relationshipStrength = relationship;
  }
  if (patch.email !== undefined) data.email = text(patch.email);
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
    data: { ...data, fullName: name, companyId },
    select: ROW_SELECT,
  });
  revalidatePath("/dashboard/crm");
  return { row: toContactRow(contact) };
}

export async function updateContactAction(contactId: string, patch: ContactPatch): Promise<ActionResult> {
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

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, company: { officeId: session.officeId } },
    select: ROW_SELECT,
  });
  if (!contact) return { error: "Contact not found." };
  revalidatePath("/dashboard/crm");
  return { row: toContactRow(contact) };
}

export async function deleteContactAction(contactId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const deleted = await prisma.contact.deleteMany({
    where: { id: contactId, company: { officeId: session.officeId } },
  });
  if (deleted.count === 0) return { error: "Contact not found." };
  revalidatePath("/dashboard/crm");
  return { ok: true };
}
