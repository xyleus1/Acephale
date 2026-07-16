"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  CARRIER_AUTHORITY_STATUS_VALUES,
  CARRIER_CHECKLIST_STATUS_VALUES,
  CARRIER_EQUIPMENT_TYPES,
  CARRIER_SECURITY_FEATURES,
  CARRIER_VETTING_CHECKLIST,
  CARRIER_VETTING_STATUS_VALUES,
  carrierVettingGate,
  checklistTemplateForCarrier,
  type VettingGateResult,
} from "@/lib/carrier-vetting";
import {
  toCarrierDetail,
  type CarrierChecklistRow,
  type CarrierDetail,
} from "@/lib/carrier-fields";

const EQUIPMENT_VALUES = CARRIER_EQUIPMENT_TYPES.map(([value]) => value) as string[];
const SECURITY_FEATURE_VALUES = CARRIER_SECURITY_FEATURES.map(([value]) => value) as string[];
const CHECKLIST_LABELS = new Map(CARRIER_VETTING_CHECKLIST.map((item) => [item.key, item.label]));

export type CarrierPatch = {
  // Sheet + detail text fields
  name?: string;
  legalName?: string;
  mcNumber?: string;
  dotNumber?: string;
  scac?: string;
  dispatchEmail?: string;
  dispatchPhone?: string;
  verifiedPhone?: string;
  emailDomain?: string;
  factoringCompany?: string;
  insuranceProducer?: string;
  coiUrl?: string;
  homeBase?: string;
  vettingNotes?: string;
  notes?: string;
  // Vocab fields
  vettingStatus?: string;
  authorityStatus?: string;
  // Money fields (free text from cells, "$250,000" tolerated)
  autoLiabilityLimit?: string;
  cargoLimit?: string;
  highValueApprovedLimit?: string;
  // Date fields ("YYYY-MM-DD" or ISO)
  authorityFirstActive?: string;
  autoInsuranceExpiry?: string;
  cargoInsuranceExpiry?: string;
  // Booleans
  emailDomainVerified?: boolean;
  identityVerified?: boolean;
  active?: boolean;
  airRide?: boolean;
  liftgate?: boolean;
  blanketWrap?: boolean;
  teamDrivers?: boolean;
  hazmatCertified?: boolean;
  lithiumCapable?: boolean;
  reeferCapable?: boolean;
  // Arrays
  equipmentTypes?: string[];
  securityFeatures?: string[];
  serviceStates?: string[];
};

export type CarrierActionResult = { detail: CarrierDetail; gate: VettingGateResult } | { error: string };

const DETAIL_INCLUDE = { checklist: true } as const;

function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function money(value: string | undefined): number | null | "invalid" {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : "invalid";
}

function dateValue(value: string | undefined): Date | null | "invalid" {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function vocab(value: string | undefined, allowed: string[]): string | null | "invalid" {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return allowed.includes(trimmed) ? trimmed : "invalid";
}

// Prisma-compatible shape for the writable carrier columns.
type CarrierData = Partial<{
  name: string;
  legalName: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
  scac: string | null;
  dispatchEmail: string | null;
  dispatchPhone: string | null;
  verifiedPhone: string | null;
  emailDomain: string | null;
  factoringCompany: string | null;
  insuranceProducer: string | null;
  coiUrl: string | null;
  homeBase: string | null;
  vettingNotes: string | null;
  notes: string | null;
  autoLiabilityLimit: number | null;
  cargoLimit: number | null;
  highValueApprovedLimit: number | null;
  authorityFirstActive: Date | null;
  autoInsuranceExpiry: Date | null;
  cargoInsuranceExpiry: Date | null;
  emailDomainVerified: boolean;
  active: boolean;
  airRide: boolean;
  liftgate: boolean;
  blanketWrap: boolean;
  teamDrivers: boolean;
  hazmatCertified: boolean;
  lithiumCapable: boolean;
  reeferCapable: boolean;
  vettingStatus: string;
  authorityStatus: string | null;
  equipmentTypes: string[];
  securityFeatures: string[];
  serviceStates: string[];
  identityVerifiedAt: Date | null;
  identityVerifiedBy: string | null;
  vettedAt: Date;
  vettedByUserId: string;
  nextReviewAt: Date | null;
}>;

const BOOLEAN_FIELDS = [
  "emailDomainVerified",
  "active",
  "airRide",
  "liftgate",
  "blanketWrap",
  "teamDrivers",
  "hazmatCertified",
  "lithiumCapable",
  "reeferCapable",
] as const;

const TEXT_FIELDS = [
  "legalName",
  "mcNumber",
  "dotNumber",
  "scac",
  "dispatchEmail",
  "dispatchPhone",
  "verifiedPhone",
  "emailDomain",
  "factoringCompany",
  "insuranceProducer",
  "coiUrl",
  "homeBase",
  "vettingNotes",
  "notes",
] as const;

const MONEY_FIELDS = ["autoLiabilityLimit", "cargoLimit", "highValueApprovedLimit"] as const;
const DATE_FIELDS = ["authorityFirstActive", "autoInsuranceExpiry", "cargoInsuranceExpiry"] as const;

function buildCarrierData(patch: CarrierPatch): CarrierData | { error: string } {
  const data: CarrierData = {};

  if (patch.name !== undefined) {
    const name = text(patch.name);
    if (!name) return { error: "Name is required." };
    data.name = name;
  }
  for (const field of TEXT_FIELDS) {
    if (patch[field] !== undefined) data[field] = text(patch[field]);
  }
  for (const field of MONEY_FIELDS) {
    if (patch[field] !== undefined) {
      const parsed = money(patch[field]);
      if (parsed === "invalid") return { error: "Amounts must be numbers (e.g. 250000)." };
      data[field] = parsed;
    }
  }
  for (const field of DATE_FIELDS) {
    if (patch[field] !== undefined) {
      const parsed = dateValue(patch[field]);
      if (parsed === "invalid") return { error: "Dates must look like 2026-08-01." };
      data[field] = parsed;
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    if (patch[field] !== undefined) data[field] = Boolean(patch[field]);
  }
  if (patch.vettingStatus !== undefined) {
    const status = vocab(patch.vettingStatus, CARRIER_VETTING_STATUS_VALUES);
    if (status === "invalid" || status === null) return { error: "Unknown vetting status." };
    data.vettingStatus = status;
  }
  if (patch.authorityStatus !== undefined) {
    const status = vocab(patch.authorityStatus, CARRIER_AUTHORITY_STATUS_VALUES);
    if (status === "invalid") return { error: "Unknown authority status." };
    data.authorityStatus = status;
  }
  if (patch.equipmentTypes !== undefined) {
    const values = patch.equipmentTypes.filter((v) => EQUIPMENT_VALUES.includes(v));
    if (values.length !== patch.equipmentTypes.length) return { error: "Unknown equipment type." };
    data.equipmentTypes = values;
  }
  if (patch.securityFeatures !== undefined) {
    const values = patch.securityFeatures.filter((v) => SECURITY_FEATURE_VALUES.includes(v));
    if (values.length !== patch.securityFeatures.length) return { error: "Unknown security feature." };
    data.securityFeatures = values;
  }
  if (patch.serviceStates !== undefined) {
    const values = patch.serviceStates.map((v) => v.trim().toUpperCase()).filter(Boolean);
    if (!values.every((v) => /^[A-Z]{2}$/.test(v))) return { error: "Service states must be 2-letter codes (CA, NV, …)." };
    data.serviceStates = values;
  }

  return data;
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

async function readDetail(officeId: string, carrierId: string) {
  const carrier = await prisma.carrier.findFirst({
    where: { id: carrierId, officeId },
    include: DETAIL_INCLUDE,
  });
  if (!carrier) return null;
  const detail = toCarrierDetail(carrier);
  const gate = carrierVettingGate(carrier, carrier.checklist);
  return { detail, gate };
}

function revalidateCarriers(carrierId?: string) {
  revalidatePath("/dashboard/carriers");
  if (carrierId) revalidatePath(`/dashboard/carriers/${carrierId}`);
}

// Ensure conditional checklist rows exist once a capability is claimed.
// Rows are never auto-deleted when a flag turns off — history stays visible.
async function ensureConditionalChecklist(officeId: string, carrierId: string, flags: { lithiumCapable: boolean; hazmatCertified: boolean }) {
  const template = checklistTemplateForCarrier(flags).filter((item) => item.appliesWhen);
  if (template.length === 0) return;
  await prisma.carrierChecklistItem.createMany({
    data: template.map((item) => ({ officeId, carrierId, key: item.key, label: item.label })),
    skipDuplicates: true,
  });
}

export async function createCarrierAction(draft: CarrierPatch): Promise<CarrierActionResult> {
  const session = await requireSession();
  const data = buildCarrierData(draft);
  if ("error" in data) return data;
  const name = data.name;
  if (!name) return { error: "Name is required." };

  const baseChecklist = checklistTemplateForCarrier({}).map((item) => ({
    officeId: session.officeId,
    key: item.key,
    label: item.label,
  }));

  try {
    const created = await prisma.carrier.create({
      data: {
        ...data,
        name,
        officeId: session.officeId,
        checklist: { create: baseChecklist },
      },
      select: { id: true },
    });
    const result = await readDetail(session.officeId, created.id);
    if (!result) return { error: "Carrier not found after create." };
    revalidateCarriers(created.id);
    return result;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") {
      return { error: "A carrier with that MC or DOT number is already on the bench." };
    }
    throw error;
  }
}

export async function updateCarrierAction(carrierId: string, patch: CarrierPatch): Promise<CarrierActionResult> {
  const session = await requireSession();
  const data = buildCarrierData(patch);
  if ("error" in data) return data;

  const current = await prisma.carrier.findFirst({
    where: { id: carrierId, officeId: session.officeId },
    include: DETAIL_INCLUDE,
  });
  if (!current) return { error: "Carrier not found." };

  // Identity verification is stamped server-side, never client-supplied.
  if (patch.identityVerified !== undefined) {
    data.identityVerifiedAt = patch.identityVerified ? new Date() : null;
    data.identityVerifiedBy = patch.identityVerified ? session.userId : null;
  }

  // Approval is gated on the checklist — deterministic, no override in the UI.
  if (data.vettingStatus === "approved" && current.vettingStatus !== "approved") {
    const flags = {
      lithiumCapable: patch.lithiumCapable ?? current.lithiumCapable,
      hazmatCertified: patch.hazmatCertified ?? current.hazmatCertified,
    };
    const gate = carrierVettingGate(flags, current.checklist);
    if (!gate.canApprove) {
      const blockers = [...gate.failed, ...gate.missing].map((key) => CHECKLIST_LABELS.get(key) ?? key);
      return { error: `Cannot approve yet — checklist blockers: ${blockers.join("; ")}` };
    }
    data.vettedAt = new Date();
    data.vettedByUserId = session.userId;
  }

  // nextReviewAt follows the nearest insurance expiry.
  if (patch.autoInsuranceExpiry !== undefined || patch.cargoInsuranceExpiry !== undefined) {
    const auto = patch.autoInsuranceExpiry !== undefined ? data.autoInsuranceExpiry ?? null : current.autoInsuranceExpiry;
    const cargo = patch.cargoInsuranceExpiry !== undefined ? data.cargoInsuranceExpiry ?? null : current.cargoInsuranceExpiry;
    data.nextReviewAt = earliest(auto, cargo);
  }

  try {
    await prisma.carrier.update({ where: { id: current.id }, data });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "P2002") {
      return { error: "A carrier with that MC or DOT number is already on the bench." };
    }
    throw error;
  }

  if (patch.lithiumCapable === true || patch.hazmatCertified === true) {
    await ensureConditionalChecklist(session.officeId, current.id, {
      lithiumCapable: patch.lithiumCapable ?? current.lithiumCapable,
      hazmatCertified: patch.hazmatCertified ?? current.hazmatCertified,
    });
  }

  const result = await readDetail(session.officeId, current.id);
  if (!result) return { error: "Carrier not found." };
  revalidateCarriers(current.id);
  return result;
}

export async function deleteCarrierAction(carrierId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const deleted = await prisma.carrier.deleteMany({ where: { id: carrierId, officeId: session.officeId } });
  if (deleted.count === 0) return { error: "Carrier not found." };
  revalidateCarriers();
  return { ok: true };
}

export type ChecklistPatch = {
  status?: string;
  note?: string;
  evidenceUrl?: string;
};

export type ChecklistActionResult = { item: CarrierChecklistRow; gate: VettingGateResult } | { error: string };

export async function updateChecklistItemAction(itemId: string, patch: ChecklistPatch): Promise<ChecklistActionResult> {
  const session = await requireSession();

  const data: Partial<{
    status: string;
    checkedAt: Date | null;
    checkedByUserId: string | null;
    note: string | null;
    evidenceUrl: string | null;
  }> = {};
  if (patch.status !== undefined) {
    const status = vocab(patch.status, CARRIER_CHECKLIST_STATUS_VALUES);
    if (status === "invalid" || status === null) return { error: "Unknown checklist status." };
    data.status = status;
    data.checkedAt = status === "pending" ? null : new Date();
    data.checkedByUserId = status === "pending" ? null : session.userId;
  }
  if (patch.note !== undefined) data.note = text(patch.note);
  if (patch.evidenceUrl !== undefined) data.evidenceUrl = text(patch.evidenceUrl);

  const updated = await prisma.carrierChecklistItem.updateMany({
    where: { id: itemId, officeId: session.officeId },
    data,
  });
  if (updated.count === 0) return { error: "Checklist item not found." };

  const item = await prisma.carrierChecklistItem.findFirst({
    where: { id: itemId, officeId: session.officeId },
    include: { carrier: { include: DETAIL_INCLUDE } },
  });
  if (!item) return { error: "Checklist item not found." };

  const gate = carrierVettingGate(item.carrier, item.carrier.checklist);
  revalidateCarriers(item.carrierId);
  return {
    item: {
      id: item.id,
      key: item.key,
      label: item.label,
      status: item.status,
      note: item.note,
      evidenceUrl: item.evidenceUrl,
      checkedAt: item.checkedAt ? item.checkedAt.toISOString() : null,
    },
    gate,
  };
}
