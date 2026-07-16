"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { prisma } from "./prisma";
import { createProposedJobForInquiry } from "./job-actions";
import { resolveCompanyIdByName } from "./company-resolve";
import { qualifyRfq } from "./rfq-qualification";
import { recordTargetPriceHistory } from "./target-price-history";
import { recordMemoryEvent } from "./memory/record-event";
import { ensureLoadSecurityChecklist } from "./load-security";
import { deriveSecurityTier } from "./security-sop";
import {
  RFQ_LOAD_FIELD_LABELS,
  type RfqLoadDraftRecord,
  type RfqLoadFieldKey,
  type RfqLoadFieldSource,
  type RfqLoadReviewValues,
  mergeRfqLoadDraftValues,
} from "./rfq-load-draft-core";

type DraftCompany = { id: string; name: string };
type DraftPriorLoad = {
  id: string;
  reference: string;
  companyName: string | null;
  route: string;
  mode: string | null;
  commodity: string | null;
  updatedAt: string;
  score: number;
};

export type RfqLoadDraft = {
  inquiryId: string;
  subject: string;
  existingJobId: string | null;
  existingJobStatus: string | null;
  values: RfqLoadReviewValues;
  sources: Record<RfqLoadFieldKey, RfqLoadFieldSource>;
  carriedFromPrior: RfqLoadFieldKey[];
  fieldLabels: typeof RFQ_LOAD_FIELD_LABELS;
  companies: DraftCompany[];
  priorLoads: DraftPriorLoad[];
  selectedPriorLoadId: string | null;
  missing: string[];
  warning: string | null;
};

type RfqLoadReviewInput = Partial<Record<keyof RfqLoadReviewValues, string | number | null | undefined>>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function nullableText(value: unknown): string | null {
  const v = text(value);
  return v ? v : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const v = text(value);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function same(a: string | null | undefined, b: string | null | undefined) {
  const na = norm(a);
  const nb = norm(b);
  return !!na && !!nb && na === nb;
}

function tokenOverlap(a: string | null | undefined, b: string | null | undefined) {
  const ta = new Set(norm(a).split(/[^a-z0-9]+/).filter((x) => x.length >= 4));
  const tb = norm(b).split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
  return tb.some((x) => ta.has(x));
}

function inquiryRecord(inquiry: any): RfqLoadDraftRecord {
  return {
    id: inquiry.id,
    reference: inquiry.subject,
    title: inquiry.subject,
    type: inquiry.type,
    origin: inquiry.origin,
    destination: inquiry.destination,
    mode: inquiry.mode,
    incoterms: inquiry.incoterms,
    commodity: inquiry.commodity,
    weight: inquiry.weight,
    volume: inquiry.volume,
    packages: inquiry.packages,
    dimensions: inquiry.dimensions,
    containerCount: inquiry.containerCount,
    containerType: inquiry.containerType,
    stackable: inquiry.stackable,
    topLoad: inquiry.topLoad,
    dangerousGoods: inquiry.dangerousGoods,
    customsBy: inquiry.customsBy,
    equipmentType: inquiry.equipmentType,
    commodityCategory: inquiry.commodityCategory,
    declaredValue: inquiry.declaredValue,
    declaredValueCurrency: inquiry.declaredValueCurrency,
    securityTier: inquiry.securityTier,
    trackingType: inquiry.trackingType,
    teamDriversRequired: inquiry.teamDriversRequired,
    targetPrice: inquiry.targetPrice,
    targetCurrency: inquiry.targetCurrency,
    targetPriceStatus: inquiry.targetPriceStatus,
    targetPriceSource: inquiry.targetPriceSource,
    notes: inquiry.notes,
    currency: inquiry.targetCurrency,
  };
}

function jobRecord(job: any): RfqLoadDraftRecord {
  if (!job) return {};
  return {
    id: job.id,
    reference: job.reference,
    updatedAt: job.updatedAt,
    title: job.title,
    cadence: job.cadence,
    type: job.type,
    origin: job.origin,
    destination: job.destination,
    mode: job.mode,
    incoterms: job.incoterms,
    commodity: job.commodity,
    quantity: job.quantity,
    quantityUnit: job.quantityUnit,
    weight: job.weight,
    volume: job.volume,
    packages: job.packages,
    dimensions: job.dimensions,
    containerCount: job.containerCount,
    containerType: job.containerType,
    stackable: job.stackable,
    topLoad: job.topLoad,
    dangerousGoods: job.dangerousGoods,
    customsBy: job.customsBy,
    equipmentType: job.equipmentType,
    commodityCategory: job.commodityCategory,
    declaredValue: job.declaredValue,
    declaredValueCurrency: job.declaredValueCurrency,
    securityTier: job.securityTier,
    trackingType: job.trackingType,
    teamDriversRequired: job.teamDriversRequired,
    targetPrice: job.targetPrice,
    targetCurrency: job.targetCurrency,
    targetPriceStatus: job.targetPriceStatus,
    targetPriceSource: job.targetPriceSource,
    currency: job.currency,
    notes: job.notes,
  };
}

function priorScore(inquiry: any, companyId: string | null, job: any) {
  let score = 0;
  if (companyId && job.companyId === companyId) score += 30;
  if (same(inquiry.origin, job.origin)) score += 12;
  if (same(inquiry.destination, job.destination)) score += 12;
  if (same(inquiry.mode, job.mode)) score += 9;
  if (tokenOverlap(inquiry.commodity, job.commodity)) score += 7;
  if (job.status === "DELIVERED") score += 2;
  if (job.status === "CANCELLED") score -= 20;
  return score;
}

function normalizeReviewValues(input: RfqLoadReviewInput): RfqLoadReviewValues {
  const mode = text(input.mode);
  const isFcl = mode === "SEA-FCL";
  const targetPrice = num(input.targetPrice);
  const declaredValue = num(input.declaredValue);
  const commodityCategory = text(input.commodityCategory);
  // Operator choice wins; otherwise write the deterministic suggestion so the
  // tier (and its SOP checklist) is never silently absent on a valuable load.
  const securityTier =
    text(input.securityTier) || (deriveSecurityTier({ declaredValue, commodityCategory }) ?? "");
  return {
    companyId: nullableText(input.companyId),
    companyName: text(input.companyName),
    title: text(input.title),
    cadence: text(input.cadence),
    type: text(input.type) || "FORWARDING",
    origin: text(input.origin),
    destination: text(input.destination),
    mode,
    incoterms: text(input.incoterms),
    commodity: text(input.commodity),
    quantity: num(input.quantity),
    quantityUnit: text(input.quantityUnit).toUpperCase(),
    weight: num(input.weight),
    volume: isFcl ? null : num(input.volume),
    packages: num(input.packages),
    dimensions: isFcl ? "" : text(input.dimensions),
    containerCount: isFcl ? num(input.containerCount) : null,
    containerType: isFcl ? text(input.containerType) : "",
    stackable: isFcl ? "" : (text(input.stackable) || "UNKNOWN"),
    topLoad: isFcl ? "" : (text(input.topLoad) || "UNKNOWN"),
    dangerousGoods: text(input.dangerousGoods) || "UNKNOWN",
    customsBy: text(input.customsBy) || "UNKNOWN",
    equipmentType: text(input.equipmentType).toUpperCase(),
    commodityCategory,
    declaredValue,
    declaredValueCurrency: text(input.declaredValueCurrency).toUpperCase() || "USD",
    securityTier,
    trackingType: text(input.trackingType),
    teamDriversRequired: text(input.teamDriversRequired).toUpperCase() || "UNKNOWN",
    targetPrice,
    targetCurrency: text(input.targetCurrency) || text(input.currency) || "USD",
    targetPriceStatus: targetPrice != null ? "PROVIDED" : (text(input.targetPriceStatus) || "UNKNOWN"),
    targetPriceSource: text(input.targetPriceSource),
    currency: text(input.currency) || text(input.targetCurrency) || "USD",
    notes: text(input.notes),
  };
}

async function resolveDraftCompany(args: {
  officeId: string;
  inquiry: any;
}): Promise<{ companyId: string | null; companyName: string | null }> {
  if (args.inquiry.company) {
    return { companyId: args.inquiry.company.id, companyName: args.inquiry.company.name };
  }

  const fromEmail = text(args.inquiry.fromEmail).toLowerCase();
  if (fromEmail) {
    const contact = await prisma.contact.findFirst({
      where: {
        email: { equals: fromEmail, mode: "insensitive" },
        company: { officeId: args.officeId },
      },
      select: { company: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
    });
    if (contact?.company) {
      return { companyId: contact.company.id, companyName: contact.company.name };
    }
  }

  const fromCompany = text(args.inquiry.fromCompany);
  if (fromCompany) {
    const company = await prisma.company.findFirst({
      where: { officeId: args.officeId, name: { equals: fromCompany, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (company) return { companyId: company.id, companyName: company.name };
    return { companyId: null, companyName: fromCompany };
  }

  return { companyId: null, companyName: null };
}

async function loadRfqDraftData(inquiryId: string, officeId: string) {
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId },
    include: {
      company: { select: { id: true, name: true } },
      job: true,
      _count: { select: { emailThreads: true } },
    },
  });
  if (!inquiry) return null;

  const company = await resolveDraftCompany({ officeId, inquiry });
  const fromEmail = text(inquiry.fromEmail).toLowerCase();
  const fromCompany = text(inquiry.fromCompany);
  const priorWhere: any = {
    officeId,
    id: { not: inquiry.job?.id ?? "__none__" },
    status: { not: "PROPOSED" },
  };
  const ors = [];
  if (company.companyId) ors.push({ companyId: company.companyId });
  if (fromEmail) ors.push({ inquiry: { fromEmail: { equals: fromEmail, mode: "insensitive" } } });
  if (fromCompany) ors.push({ inquiry: { fromCompany: { equals: fromCompany, mode: "insensitive" } } });
  if (ors.length) priorWhere.OR = ors;
  else priorWhere.id = "__none__";

  const [companies, priorJobs] = await Promise.all([
    prisma.company.findMany({
      where: { officeId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 250,
    }),
    prisma.job.findMany({
      where: priorWhere,
      include: {
        company: { select: { name: true } },
        inquiry: { select: { fromEmail: true, fromCompany: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);

  const scored = priorJobs
    .map((job) => ({ job, score: priorScore(inquiry, company.companyId, job) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.job.updatedAt.getTime() - a.job.updatedAt.getTime());
  const selectedPrior = scored[0]?.job ?? null;

  const merged = mergeRfqLoadDraftValues({
    rfq: inquiryRecord(inquiry),
    proposedLoad: inquiry.job?.status === "PROPOSED" ? jobRecord(inquiry.job) : null,
    priorLoad: selectedPrior ? jobRecord(selectedPrior) : null,
    companyId: company.companyId,
    companyName: company.companyName,
  });
  const qualification = qualifyRfq(merged.values);
  const missing = [
    ...qualification.missing,
    ...(qualification.targetPriceQuestion ? ["target price or no-target confirmation"] : []),
  ];

  return {
    inquiry,
    company,
    companies,
    priorJobs: scored,
    selectedPrior,
    merged,
    missing,
  };
}

export async function getRfqLoadDraft(inquiryId: string): Promise<RfqLoadDraft | { error: string }> {
  const session = await requireSession();
  const data = await loadRfqDraftData(inquiryId, session.officeId);
  if (!data) return { error: "RFQ not found" };
  const { inquiry, companies, priorJobs, selectedPrior, merged, missing } = data;

  return {
    inquiryId: inquiry.id,
    subject: inquiry.subject,
    existingJobId: inquiry.job?.id ?? null,
    existingJobStatus: inquiry.job?.status ?? null,
    values: merged.values,
    sources: merged.sources,
    carriedFromPrior: merged.carriedFromPrior,
    fieldLabels: RFQ_LOAD_FIELD_LABELS,
    companies,
    selectedPriorLoadId: selectedPrior?.id ?? null,
    priorLoads: priorJobs.slice(0, 5).map(({ job, score }) => ({
      id: job.id,
      reference: job.reference,
      companyName: job.company?.name ?? null,
      route: `${job.origin ?? "?"} -> ${job.destination ?? "?"}`,
      mode: job.mode,
      commodity: job.commodity,
      updatedAt: job.updatedAt.toISOString(),
      score,
    })),
    missing,
    warning: merged.carriedFromPrior.length
      ? "Some blank RFQ fields were carried from prior customer loads. Review them before creating the load."
      : null,
  };
}

export async function createLoadFromRfqReview(
  inquiryId: string,
  input: RfqLoadReviewInput,
): Promise<{ ok: true; jobId: string; reference: string; missing: string[] } | { error: string }> {
  const session = await requireSession();
  const data = await loadRfqDraftData(inquiryId, session.officeId);
  if (!data) return { error: "RFQ not found" };
  const { inquiry, merged } = data;
  if (inquiry.job && inquiry.job.status !== "PROPOSED") {
    return { error: `RFQ is already linked to ${inquiry.job.reference}` };
  }

  const mergedInput: RfqLoadReviewInput = { ...merged.values, ...input };
  if (
    Object.prototype.hasOwnProperty.call(input, "companyName")
    && norm(text(input.companyName)) !== norm(merged.values.companyName)
  ) {
    mergedInput.companyId = null;
  }
  const values = normalizeReviewValues(mergedInput);
  const explicitCompanyId = values.companyId
    ? await prisma.company.findFirst({
      where: { id: values.companyId, officeId: session.officeId },
      select: { id: true },
    })
    : null;
  const companyId = explicitCompanyId?.id
    ?? (values.companyName ? await resolveCompanyIdByName(session.officeId, values.companyName) : inquiry.companyId);

  const qualification = qualifyRfq(values);
  // Only auto-flip the legacy parse-maturity pair; never demote an
  // operator-set status (canonical BOOKED/PRICING/… or a custom one).
  const nextInquiryStatus = ["INGESTED", "PARSED"].includes(inquiry.status)
    ? qualification.isMature ? "PARSED" : "INGESTED"
    : inquiry.status;

  let jobId = inquiry.job?.id ?? null;
  if (!jobId) {
    jobId = await createProposedJobForInquiry(inquiryId);
    if (!jobId) return { error: "Couldn't create proposed load" };
  }

  const updatedJob = await prisma.job.update({
    where: { id: jobId, officeId: session.officeId },
    data: {
      companyId: companyId ?? null,
      title: values.title || inquiry.subject,
      cadence: values.cadence || null,
      status: "INQUIRY",
      type: values.type || inquiry.type || "FORWARDING",
      origin: values.origin || null,
      destination: values.destination || null,
      mode: values.mode || null,
      incoterms: values.incoterms || null,
      commodity: values.commodity || null,
      quantity: values.quantity,
      quantityUnit: values.quantityUnit || null,
      weight: values.weight,
      volume: values.volume,
      packages: values.packages,
      dimensions: values.dimensions || null,
      containerCount: values.containerCount,
      containerType: values.containerType || null,
      stackable: values.stackable || null,
      topLoad: values.topLoad || null,
      dangerousGoods: values.dangerousGoods || "UNKNOWN",
      customsBy: values.customsBy || "UNKNOWN",
      equipmentType: values.equipmentType || null,
      commodityCategory: values.commodityCategory || null,
      declaredValue: values.declaredValue,
      declaredValueCurrency: values.declaredValue != null ? values.declaredValueCurrency || "USD" : null,
      securityTier: values.securityTier || null,
      trackingType: values.trackingType || null,
      teamDriversRequired: values.teamDriversRequired || "UNKNOWN",
      targetPrice: values.targetPrice,
      targetCurrency: values.targetCurrency || "USD",
      targetPriceStatus: values.targetPriceStatus || "UNKNOWN",
      targetPriceSource: values.targetPriceSource || null,
      currency: values.currency || values.targetCurrency || "USD",
      notes: values.notes || null,
      assignedToUserId: session.userId,
    },
    select: { id: true, reference: true, updatedAt: true },
  });

  // Seed the SOP checklist for tiered loads — additive, never destructive.
  await ensureLoadSecurityChecklist(session.officeId, updatedJob.id, values.securityTier).catch(() => null);

  const updatedInquiry = await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data: {
      companyId: companyId ?? null,
      type: values.type || inquiry.type || "FORWARDING",
      origin: values.origin || null,
      destination: values.destination || null,
      mode: values.mode || null,
      incoterms: values.incoterms || null,
      commodity: values.commodity || null,
      weight: values.weight,
      volume: values.volume,
      packages: values.packages,
      dimensions: values.dimensions || null,
      containerCount: values.containerCount,
      containerType: values.containerType || null,
      stackable: values.stackable || null,
      topLoad: values.topLoad || null,
      dangerousGoods: values.dangerousGoods || "UNKNOWN",
      customsBy: values.customsBy || "UNKNOWN",
      equipmentType: values.equipmentType || null,
      commodityCategory: values.commodityCategory || null,
      declaredValue: values.declaredValue,
      declaredValueCurrency: values.declaredValue != null ? values.declaredValueCurrency || "USD" : null,
      securityTier: values.securityTier || null,
      trackingType: values.trackingType || null,
      teamDriversRequired: values.teamDriversRequired || "UNKNOWN",
      targetPrice: values.targetPrice,
      targetCurrency: values.targetCurrency || "USD",
      targetPriceStatus: values.targetPriceStatus || "UNKNOWN",
      targetPriceSource: values.targetPriceSource || null,
      notes: values.notes || inquiry.notes,
      status: nextInquiryStatus,
    },
  });

  await prisma.emailThread.updateMany({
    where: { inquiryId, officeId: session.officeId },
    data: { jobId: updatedJob.id },
  });

  if (values.targetPrice != null || values.targetPriceStatus === "NO_TARGET") {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      inquiryId,
      jobId: updatedJob.id,
      createdByUserId: session.userId,
      amount: values.targetPrice,
      currency: values.targetCurrency,
      status: values.targetPriceStatus,
      source: values.targetPriceSource,
      note: "Confirmed during RFQ-to-load review.",
    });
  }

  const carriedFields = merged.carriedFromPrior.filter((field) => {
    const key = field as keyof RfqLoadReviewValues;
    return String((values[key] ?? "") || "") === String((merged.values[key] ?? "") || "");
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "INQUIRY",
    sourceExternalId: `inquiry:${inquiryId}`,
    eventType: "inquiry.reviewed_load_created",
    entityType: "job",
    entityId: updatedJob.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: updatedJob.updatedAt,
    payloadVersion: 1,
    payload: {
      inquiryId,
      jobId: updatedJob.id,
      status: "INQUIRY",
      inquiryStatus: updatedInquiry.status,
      missing: [
        ...qualification.missing,
        ...(qualification.targetPriceQuestion ? ["target price or no-target confirmation"] : []),
      ],
      carriedFromPriorFields: carriedFields,
      sourceByField: merged.sources,
    },
    provenance: {
      source: "inquiry",
      operation: "reviewed_rfq_to_load",
      path: "src/lib/rfq-load-review.ts",
      function: "createLoadFromRfqReview",
      sourceRecordId: inquiryId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `inquiry:${inquiryId}:reviewed_load:${updatedJob.id}:${updatedJob.updatedAt.toISOString()}`,
  }).catch(() => null);

  const missing = [
    ...qualification.missing,
    ...(qualification.targetPriceQuestion ? ["target price or no-target confirmation"] : []),
  ];

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/jobs");
  revalidatePath(`/dashboard/jobs/${updatedJob.id}`);
  revalidatePath(`/dashboard/rfq/${inquiryId}`);

  return { ok: true, jobId: updatedJob.id, reference: updatedJob.reference, missing };
}
