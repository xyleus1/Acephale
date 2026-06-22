"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { parsePipeLines } from "@/lib/quote-lines";
import { resolveCompanyIdByName } from "@/lib/company-resolve";
import { recordTargetPriceHistory, targetPriceChanged } from "@/lib/target-price-history";
import { applyPendingJobAgentProposal, discardPendingAgentProposal } from "@/lib/agent-proposals";
import { storeJobDocumentFile } from "@/lib/document-storage";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { applyCustomerQuoteDraftToJob, buildCustomerQuoteDraftForJob } from "@/lib/customer-quote-drafts";
import { createForwarderRequestDrafts } from "@/lib/forwarder-drafts";
import { assessJobStrategy, loadJobStrategyInput } from "@/lib/commercial-strategy-persistence";
import { buildMissingInfoDraft } from "@/lib/missing-info-draft";
import { buildNegotiationPlanDraft } from "@/lib/negotiation-plan-draft";
import { simulatePricingScenario } from "@/lib/pricing-scenario";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { draftFreshnessKey } from "@/lib/draft-freshness";
import { recordMemoryEvent } from "@/lib/memory/record-event";

async function recordJobDraftEvent(args: {
  officeId: string;
  userId?: string | null;
  jobId: string;
  inquiryId?: string | null;
  type: "missing_info_draft.created" | "missing_info_draft.blocked" | "forwarder_drafts.created" | "forwarder_drafts.blocked" | "customer_quote_draft.created" | "customer_quote_draft.blocked" | "negotiation_plan_draft.created" | "negotiation_plan_draft.blocked";
  payload: Record<string, unknown>;
}) {
  const event = await prisma.event.create({
    data: {
      officeId: args.officeId,
      type: args.type,
      entityType: "job",
      entityId: args.jobId,
      payload: {
        userId: args.userId ?? null,
        jobId: args.jobId,
        inquiryId: args.inquiryId ?? null,
        notSent: true,
        ...args.payload,
      },
    },
    select: { id: true },
  }).catch(() => null);
  await recordMemoryEvent({
    officeId: args.officeId,
    sourceType: "JOB",
    sourceExternalId: `job:${args.jobId}`,
    eventType: args.type,
    entityType: "job",
    entityId: args.jobId,
    actorType: args.userId ? "user" : "system",
    actorId: args.userId ?? null,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      eventId: event?.id ?? null,
      userId: args.userId ?? null,
      jobId: args.jobId,
      inquiryId: args.inquiryId ?? null,
      ...args.payload,
    },
    provenance: {
      source: "job",
      operation: args.type,
      path: "src/app/dashboard/jobs/[jobId]/actions.ts",
      function: "recordJobDraftEvent",
      sourceRecordId: args.jobId,
      actorType: args.userId ? "user" : "system",
      actorId: args.userId ?? null,
    },
    idempotencyKey: `job:${args.jobId}:${args.type}:${event?.id ?? Date.now()}`,
  }).catch(() => null);
  return event;
}

// ── Job status ────────────────────────────────────────────────────────────────

export async function updateJobStatus(jobId: string, status: string) {
  const session = await requireSession();
  const before = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { status: true },
  });
  const updated = await prisma.job.update({
    where: { id: jobId, officeId: session.officeId },
    data: { status: status as never },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "JOB",
    sourceExternalId: `job:${jobId}`,
    eventType: "job.status_updated",
    entityType: "job",
    entityId: jobId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: updated.updatedAt,
    payloadVersion: 1,
    payload: { jobId, fromStatus: before?.status ?? null, toStatus: status },
    provenance: {
      source: "job",
      operation: "status_update",
      path: "src/app/dashboard/jobs/[jobId]/actions.ts",
      function: "updateJobStatus",
      sourceRecordId: jobId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `job:${jobId}:status:${before?.status ?? "unknown"}:${status}:${updated.updatedAt.toISOString()}`,
  }).catch(() => null);
  if (before && before.status !== status) {
    await enqueueBackgroundJob({
      officeId: session.officeId,
      type: "CUSTOMER_STATUS_NOTIFY",
      payload: { jobId, fromStatus: before.status, toStatus: status },
      dedupeKey: `customer-status:${jobId}:${before.status}:${status}`,
    }).catch(() => null);
  }
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard");
}

// Update all editable fields on a job in one go.
export async function updateJobAllFields(jobId: string, formData: FormData) {
  const session = await requireSession();
  const get = (k: string) => {
    const v = formData.get(k);
    return v == null ? "" : String(v);
  };
  const num = (k: string) => {
    const v = get(k);
    return v ? Number(v) : null;
  };
  const dt = (k: string) => {
    const v = get(k);
    return v ? new Date(v) : null;
  };

  const status = get("status");
  const companyName = get("companyName").trim();
  const companyId = companyName
    ? await resolveCompanyIdByName(session.officeId, companyName)
    : (get("companyId") || null);
  const mode = get("mode") || null;
  const isFcl = mode === "SEA-FCL";
  const existing = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: {
      notes: true,
      quoteLines: true,
      inquiryId: true,
      targetPrice: true,
      targetCurrency: true,
      targetPriceStatus: true,
      targetPriceSource: true,
    },
  });
  if (!existing) return;

  // Notes: only touch when the form includes the field. Fold any legacy
  // pipe-delimited quote lines out of notes into quoteLines before overwriting.
  let notesData: { notes?: string | null; quoteLines?: string | null } = {};
  if (formData.has("notes")) {
    const legacyLines = parsePipeLines(existing?.notes);
    notesData = {
      notes: get("notes").trim() || null,
      ...(existing?.quoteLines == null && legacyLines.length > 0
        ? { quoteLines: legacyLines.map((l) => `${l.desc}|${l.amount}|${l.cur}`).join("\n") }
        : {}),
    };
  }

  const data = {
      ...(status ? { status: status as never } : {}),
      companyId,
      ...(formData.has("title") ? { title: get("title").trim() || null } : {}),
      ...(formData.has("cadence") ? { cadence: get("cadence") || null } : {}),
      ...(formData.has("quantity") ? { quantity: num("quantity") } : {}),
      ...(formData.has("quantityUnit") ? { quantityUnit: get("quantityUnit").trim().toUpperCase() || null } : {}),
      origin: get("origin") || null,
      destination: get("destination") || null,
      mode,
      incoterms: get("incoterms") || null,
      commodity: get("commodity") || null,
      weight: num("weight"),
      volume: isFcl ? null : num("volume"),
      dimensions: isFcl ? null : (get("dimensions") || null),
      stackable: isFcl ? null : (get("stackable") || "UNKNOWN"),
      topLoad: isFcl ? null : (get("topLoad") || null),
      dangerousGoods: get("dangerousGoods") || "UNKNOWN",
      customsBy: get("customsBy") || "UNKNOWN",
      containerCount: isFcl ? num("containerCount") : null,
      containerType: isFcl ? (get("containerType") || null) : null,
      packages: num("packages") as number | null,
      targetPrice: num("targetPrice"),
      targetCurrency: get("targetCurrency") || get("currency") || "USD",
      targetPriceStatus: num("targetPrice") != null ? "PROVIDED" : (get("targetPriceStatus") || "UNKNOWN"),
      targetPriceSource: get("targetPriceSource").trim() || null,
      etd: dt("etd"),
      eta: dt("eta"),
      revenue: num("revenue"),
      cost: num("cost"),
      currency: get("currency") || "USD",
      ...notesData,
    };

  await prisma.job.update({
    where: { id: jobId, officeId: session.officeId },
    data,
  });
  if (targetPriceChanged(existing, data)) {
    await recordTargetPriceHistory({
      officeId: session.officeId,
      jobId,
      inquiryId: existing.inquiryId,
      createdByUserId: session.userId,
      amount: data.targetPrice,
      currency: data.targetCurrency,
      status: data.targetPriceStatus,
      source: data.targetPriceSource,
      note: "Manual job field update.",
    });
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
}

// Update just the personal note. Migrates any legacy pipe-delimited quote
// lines out of notes into quoteLines first so they aren't lost on overwrite.
export async function updateJobNote(jobId: string, note: string) {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { notes: true, quoteLines: true },
  });
  if (!job) return;
  const legacyLines = parsePipeLines(job.notes);
  const quoteLines = job.quoteLines ?? (legacyLines.length > 0
    ? legacyLines.map((l) => `${l.desc}|${l.amount}|${l.cur}`).join("\n")
    : null);
  await prisma.job.update({
    where: { id: jobId },
    data: { notes: note.trim() || null, quoteLines },
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard");
}

export async function updateJobField(jobId: string, data: {
  notes?: string;
  revenue?: number;
  cost?: number;
  currency?: string;
  etd?: string;
  eta?: string;
  incoterms?: string;
  commodity?: string;
  weight?: number;
  volume?: number;
  packages?: number;
}) {
  const session = await requireSession();
  await prisma.job.update({
    where: { id: jobId, officeId: session.officeId },
    data: {
      ...data,
      etd: data.etd ? new Date(data.etd) : undefined,
      eta: data.eta ? new Date(data.eta) : undefined,
      revenue: data.revenue ?? undefined,
      cost: data.cost ?? undefined,
    },
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

// ── Documents ─────────────────────────────────────────────────────────────────

const DEFAULT_DOCS = [
  { name: "Booking Confirmation", docType: "BOOKING" },
  { name: "Commercial Invoice",   docType: "INVOICE" },
  { name: "Packing List",         docType: "PACKING_LIST" },
  { name: "Bill of Lading",       docType: "BL" },
  { name: "Certificate of Origin",docType: "COO" },
  { name: "Customs Declaration",  docType: "CUSTOMS" },
];

export async function initJobDocuments(jobId: string, officeId: string) {
  const existing = await prisma.jobDocument.count({ where: { jobId } });
  if (existing > 0) return;
  await prisma.jobDocument.createMany({
    data: DEFAULT_DOCS.map((d) => ({ jobId, officeId, ...d })),
  });
}

export async function updateDocStatus(docId: string, status: string) {
  const session = await requireSession();
  const doc = await prisma.jobDocument.findFirst({
    where: { id: docId, officeId: session.officeId },
  });
  if (!doc) return;
  await prisma.jobDocument.updateMany({
    where: { id: docId, officeId: session.officeId },
    data: { status, url: status === "UPLOADED" ? (doc.url ?? "#placeholder") : doc.url },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "DOCUMENT",
    sourceExternalId: `job_document:${docId}`,
    eventType: "job_document.status_updated",
    entityType: "job_document",
    entityId: docId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: { documentId: docId, jobId: doc.jobId, status, previousStatus: doc.status, docType: doc.docType, name: doc.name },
    provenance: {
      source: "document",
      operation: "status_update",
      path: "src/app/dashboard/jobs/[jobId]/actions.ts",
      function: "updateDocStatus",
      sourceRecordId: docId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `job_document:${docId}:status:${status}:${Date.now()}`,
  }).catch(() => null);
  // On approve, run AI analysis (best-effort; don't block UI on failure).
  if (status === "APPROVED" && doc.url && !doc.url.includes("placeholder")) {
    await enqueueBackgroundJob({
      officeId: session.officeId,
      type: "ANALYZE_JOB_DOCUMENT",
      payload: { documentId: docId },
      dedupeKey: `analyze-document:${docId}`,
    }).catch(() => null);
  }
  revalidatePath(`/dashboard/jobs/${doc.jobId}`);
}

export async function uploadJobDocument(docId: string, formData: FormData) {
  const session = await requireSession();
  const doc = await prisma.jobDocument.findFirst({
    where: { id: docId, officeId: session.officeId },
    select: { id: true, jobId: true, officeId: true, name: true },
  });
  if (!doc) return;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) return;

  const stored = await storeJobDocumentFile({
    officeId: doc.officeId,
    jobId: doc.jobId,
    preferredName: file.name || doc.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type || null,
  });

  await prisma.jobDocument.update({
    where: { id: doc.id },
    data: {
      url: stored.url,
      status: "UPLOADED",
      uploadedByUserId: session.userId,
      aiSummary: null,
      aiFlags: null,
      aiKeyFields: null,
      aiAnalyzedAt: null,
    },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "DOCUMENT",
    sourceExternalId: `job_document:${doc.id}`,
    eventType: "job_document.uploaded",
    entityType: "job_document",
    entityId: doc.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      documentId: doc.id,
      jobId: doc.jobId,
      fileName: file.name,
      contentType: file.type || null,
      size: file.size,
      storageUrl: stored.url,
    },
    provenance: {
      source: "document",
      operation: "upload",
      path: "src/app/dashboard/jobs/[jobId]/actions.ts",
      function: "uploadJobDocument",
      sourceRecordId: doc.id,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `job_document:${doc.id}:uploaded:${Date.now()}`,
  }).catch(() => null);

  revalidatePath(`/dashboard/jobs/${doc.jobId}`);
  revalidatePath("/dashboard");
}

export async function addDocument(jobId: string, formData: FormData) {
  const session = await requireSession();
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId: session.officeId } });
  if (!job) return;
  const created = await prisma.jobDocument.create({
    data: {
      jobId,
      officeId: session.officeId,
      name:    String(formData.get("name") ?? ""),
      docType: String(formData.get("docType") ?? "OTHER"),
      status:  "PENDING",
      uploadedByUserId: session.userId,
    },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "DOCUMENT",
    sourceExternalId: `job_document:${created.id}`,
    eventType: "job_document.created",
    entityType: "job_document",
    entityId: created.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: created.createdAt,
    payloadVersion: 1,
    payload: { documentId: created.id, jobId, name: created.name, docType: created.docType, status: created.status },
    provenance: {
      source: "document",
      operation: "create",
      path: "src/app/dashboard/jobs/[jobId]/actions.ts",
      function: "addDocument",
      sourceRecordId: created.id,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `job_document:${created.id}:created`,
  }).catch(() => null);
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

// ── Milestones ────────────────────────────────────────────────────────────────

const DEFAULT_MILESTONES = [
  "BOOKING", "CARGO_READY", "DELIVERY",
];

export async function initJobMilestones(jobId: string) {
  const existing = await prisma.jobMilestone.count({ where: { jobId } });
  if (existing > 0) return;
  await prisma.jobMilestone.createMany({
    data: DEFAULT_MILESTONES.map((type) => ({ jobId, type })),
  });
}

export async function updateMilestonePlanned(milestoneId: string, plannedAt: string) {
  const session = await requireSession();
  const ms = await prisma.jobMilestone.findFirst({
    where: { id: milestoneId },
    include: { job: { select: { officeId: true } } },
  });
  if (!ms || ms.job.officeId !== session.officeId) return;
  const updated = await prisma.jobMilestone.update({
    where: { id: milestoneId },
    data: { plannedAt: plannedAt ? new Date(plannedAt) : null },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "JOB",
    sourceExternalId: `job:${ms.jobId}`,
    eventType: "job_milestone.planned_updated",
    entityType: "job",
    entityId: ms.jobId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: updated.updatedAt,
    payloadVersion: 1,
    payload: { milestoneId, jobId: ms.jobId, type: ms.type, plannedAt: updated.plannedAt },
    provenance: {
      source: "job",
      operation: "milestone_planned_update",
      path: "src/app/dashboard/jobs/[jobId]/actions.ts",
      function: "updateMilestonePlanned",
      sourceRecordId: milestoneId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `job:${ms.jobId}:milestone:${milestoneId}:planned:${updated.updatedAt.toISOString()}`,
  }).catch(() => null);
  revalidatePath(`/dashboard/jobs/${ms.jobId}`);
}

export async function markMilestoneActual(milestoneId: string) {
  const session = await requireSession();
  const ms = await prisma.jobMilestone.findFirst({
    where: { id: milestoneId },
    include: { job: { select: { officeId: true } } },
  });
  if (!ms || ms.job.officeId !== session.officeId) return;
  const updated = await prisma.jobMilestone.update({
    where: { id: milestoneId },
    data: { actualAt: new Date() },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "JOB",
    sourceExternalId: `job:${ms.jobId}`,
    eventType: "job_milestone.actual_marked",
    entityType: "job",
    entityId: ms.jobId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: updated.updatedAt,
    payloadVersion: 1,
    payload: { milestoneId, jobId: ms.jobId, type: ms.type, actualAt: updated.actualAt },
    provenance: {
      source: "job",
      operation: "milestone_actual_mark",
      path: "src/app/dashboard/jobs/[jobId]/actions.ts",
      function: "markMilestoneActual",
      sourceRecordId: milestoneId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `job:${ms.jobId}:milestone:${milestoneId}:actual:${updated.updatedAt.toISOString()}`,
  }).catch(() => null);
  await enqueueBackgroundJob({
    officeId: session.officeId,
    type: "CUSTOMER_MILESTONE_NOTIFY",
    payload: { jobId: ms.jobId, milestoneType: ms.type, isActual: true },
    dedupeKey: `customer-milestone:${ms.jobId}:${ms.type}`,
  }).catch(() => null);
  revalidatePath(`/dashboard/jobs/${ms.jobId}`);
}

// ── Carrier quotes (procurement) ──────────────────────────────────────────────

export async function addCarrierQuote(inquiryId: string, formData: FormData) {
  const session = await requireSession();
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: { job: { select: { id: true } } },
  });
  if (!inquiry) return;

  await prisma.carrierQuote.create({
    data: {
      inquiryId,
      carrier:     String(formData.get("carrier") ?? ""),
      quoteType:   "EMAIL",
      rateName:    String(formData.get("rateName") ?? ""),
      total20:     formData.get("total20")  ? Number(formData.get("total20"))  : null,
      total40:     formData.get("total40")  ? Number(formData.get("total40"))  : null,
      total40HC:   formData.get("total40HC")? Number(formData.get("total40HC")): null,
      transitDays: formData.get("transit")  ? Number(formData.get("transit"))  : null,
      service:     String(formData.get("service") ?? ""),
      validity:    String(formData.get("validity") ?? ""),
      status:      "RECEIVED",
    },
  });

  if (inquiry.job?.id) revalidatePath(`/dashboard/jobs/${inquiry.job.id}`);
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
}

export async function selectCarrierQuote(jobId: string, quoteId: string) {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    include: { inquiry: { include: { carrierQuotes: true } } },
  });
  if (!job) return;

  const quote = job.inquiry?.carrierQuotes.find((q) => q.id === quoteId);
  if (!quote) return;

  const cost = quote.total40HC ?? quote.total40 ?? quote.total20 ?? null;
  await prisma.job.update({
    where: { id: jobId },
    data: { cost, status: "BOOKED" },
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

// ── Quote lines (sellside) ────────────────────────────────────────────────────

export async function addQuoteLine(jobId: string, formData: FormData) {
  const session = await requireSession();
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId: session.officeId } });
  if (!job) return;

  // Quote lines live in quoteLines; fold in any legacy lines still sitting in notes.
  const legacy = job.quoteLines == null
    ? parsePipeLines(job.notes).map((l) => `${l.desc}|${l.amount}|${l.cur}`)
    : [];
  const existing = [job.quoteLines ?? "", ...legacy].filter(Boolean).join("\n");
  const line = `${formData.get("description")}|${formData.get("amount")}|${formData.get("currency") ?? "USD"}`;
  const lines = existing ? existing + "\n" + line : line;

  await prisma.job.update({ where: { id: jobId }, data: { quoteLines: lines } });
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

export async function draftCustomerQuoteForJob(jobId: string) {
  const session = await requireSession();
  const loaded = await buildCustomerQuoteDraftForJob(session.officeId, jobId);
  if (!loaded) return { ok: false as const, error: "Job or strategy assessment not found." };
  const { draft } = loaded;
  const freshnessScope = "customer_quote" as const;
  const freshnessKey = draftFreshnessKey({
    ...loaded.job,
    subject: loaded.job.title ?? loaded.job.inquiry?.subject ?? loaded.job.reference,
    carrierQuotes: loaded.job.inquiry?.carrierQuotes ?? [],
  }, freshnessScope);
  const auditEvent = await recordJobDraftEvent({
    officeId: session.officeId,
    userId: session.userId,
    jobId,
    inquiryId: loaded.job.inquiryId,
    type: draft.status === "READY" ? "customer_quote_draft.created" : "customer_quote_draft.blocked",
    payload: {
      status: draft.status,
      decision: draft.status,
      assessmentId: loaded.assessmentId,
      freshnessScope,
      freshnessKey,
      subject: draft.subject,
      to: loaded.to,
      blockers: draft.blockers,
      lineItems: draft.status === "READY" ? draft.lineItems : [],
      safety: "Customer quote draft only; no customer email was sent and no Quote outcome row was created.",
    },
  });
  return {
    ok: true as const,
    assessmentId: loaded.assessmentId,
    auditEventId: auditEvent?.id ?? null,
    to: loaded.to,
    reviewUrl: loaded.reviewUrl,
    status: draft.status,
    blockers: draft.blockers,
    subject: draft.subject,
    body: draft.body,
    lineItems: draft.lineItems,
    assumptions: draft.customerFacingAssumptions,
    internalGuardrails: draft.internalGuardrails,
    safety: "Draft only. No customer email was sent, no Quote outcome row was created, and Job.quoteLines were not changed.",
  };
}

export async function applyCustomerQuoteDraftAction(jobId: string) {
  const session = await requireSession();
  const result = await applyCustomerQuoteDraftToJob({
    officeId: session.officeId,
    userId: session.userId,
    jobId,
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard");
  return result;
}

export async function simulatePricingScenarioForJob(jobId: string, input: {
  targetPrice?: number | null;
  targetCurrency?: string | null;
  noTarget?: boolean;
  buyCost?: number | null;
  assumeLiveBuyCost?: boolean;
  replaceExistingQuotes?: boolean;
  transitDays?: number | null;
  targetMarginPct?: number | null;
  minMarginPct?: number | null;
}) {
  const session = await requireSession();
  const strategyInput = await loadJobStrategyInput(session.officeId, jobId);
  if (!strategyInput) return { ok: false as const, error: "Job strategy input not found." };

  const result = simulatePricingScenario(strategyInput, {
    targetPrice: input.targetPrice,
    targetCurrency: input.targetCurrency,
    noTarget: input.noTarget,
    buyCost: input.buyCost,
    assumeLiveBuyCost: input.assumeLiveBuyCost,
    replaceExistingQuotes: input.replaceExistingQuotes,
    transitDays: input.transitDays,
    targetMarginPct: input.targetMarginPct,
    minMarginPct: input.minMarginPct,
  });

  return { ok: true as const, result };
}

export async function draftNegotiationPlanForJob(jobId: string) {
  const session = await requireSession();
  const loaded = await assessJobStrategy(session.officeId, jobId);
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: {
      id: true,
      reference: true,
      title: true,
      company: { select: { name: true } },
      origin: true,
      destination: true,
      mode: true,
      inquiryId: true,
      inquiry: {
        select: {
          subject: true,
          carrierQuotes: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!loaded || !job) {
    await recordJobDraftEvent({
      officeId: session.officeId,
      userId: session.userId,
      jobId,
      type: "negotiation_plan_draft.blocked",
      payload: {
        status: "BLOCKED",
        decision: "BLOCKED",
        error: "Job or strategy assessment not found.",
      },
    });
    return { ok: false as const, error: "Job or strategy assessment not found." };
  }

  const draft = buildNegotiationPlanDraft({
    reference: job.reference,
    subject: job.title ?? job.inquiry?.subject ?? job.reference,
    customerName: job.company?.name ?? null,
    origin: job.origin,
    destination: job.destination,
    mode: job.mode,
  }, loaded.strategy);
  const freshnessScope = "pricing" as const;
  const freshnessKey = draftFreshnessKey({
    ...job,
    subject: job.title ?? job.inquiry?.subject ?? job.reference,
    carrierQuotes: job.inquiry?.carrierQuotes ?? [],
  }, freshnessScope);
  const auditEvent = await recordJobDraftEvent({
    officeId: session.officeId,
    userId: session.userId,
    jobId,
    inquiryId: job.inquiryId,
    type: "negotiation_plan_draft.created",
    payload: {
      status: draft.status,
      decision: draft.status,
      assessmentId: loaded.assessmentId,
      freshnessScope,
      freshnessKey,
      subject: draft.subject,
      posture: draft.posture,
      quoteGate: draft.guardrails.quoteGate.status,
      approvalRequired: draft.guardrails.approvalRequired,
      decisionReasons: draft.decisionReasons.map((reason) => ({
        key: reason.key,
        tone: reason.tone,
        summary: reason.summary,
      })),
      topRisks: draft.topRisks.map((risk) => ({
        category: risk.category,
        level: risk.level,
        reason: risk.reason,
      })),
      safety: "Negotiation plan draft only; no customer or forwarder message was sent.",
    },
  });

  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard");

  return {
    ok: true as const,
    assessmentId: loaded.assessmentId,
    auditEventId: auditEvent?.id ?? null,
    draft,
    safety: "Draft only. No customer email, forwarder email, Quote row, or Job.quoteLines change was made.",
  };
}

export async function createForwarderDraftsForJobAction(jobId: string) {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { inquiryId: true },
  });
  if (!job?.inquiryId) {
    await recordJobDraftEvent({
      officeId: session.officeId,
      userId: session.userId,
      jobId,
      type: "forwarder_drafts.blocked",
      payload: {
        status: "BLOCKED",
        decision: "BLOCKED",
        error: "This job is not linked to an RFQ/inquiry.",
      },
    });
    return { ok: false as const, error: "This job is not linked to an RFQ/inquiry." };
  }

  const result = await createForwarderRequestDrafts({
    officeId: session.officeId,
    userId: session.userId,
    inquiryId: job.inquiryId,
    recordBlockedNote: false,
  });

  revalidatePath(`/dashboard/jobs/${jobId}`);
  revalidatePath(`/dashboard/rfq/${job.inquiryId}`);
  revalidatePath(`/dashboard/pricing?inquiry=${job.inquiryId}`);
  revalidatePath("/dashboard/pricing");

  if (result.status === "NOT_FOUND") {
    await recordJobDraftEvent({
      officeId: session.officeId,
      userId: session.userId,
      jobId,
      inquiryId: job.inquiryId,
      type: "forwarder_drafts.blocked",
      payload: {
        status: "NOT_FOUND",
        decision: "BLOCKED",
        error: "Linked RFQ/inquiry was not found.",
      },
    });
    return { ok: false as const, error: "Linked RFQ/inquiry was not found." };
  }

  const freshnessScope = "rfq" as const;
  const auditEvent = await recordJobDraftEvent({
    officeId: session.officeId,
    userId: session.userId,
    jobId,
    inquiryId: job.inquiryId,
    type: result.status === "READY" ? "forwarder_drafts.created" : "forwarder_drafts.blocked",
    payload: {
      status: result.status,
      decision: result.status,
      freshnessScope,
      freshnessKey: draftFreshnessKey(result.inquiry, freshnessScope),
      missing: result.missing,
      blockedReasons: result.blockedReasons,
      eligibleForwarders: result.eligibleForwarders,
      createdDrafts: result.createdDrafts,
      existingDrafts: result.existingDrafts,
      skippedForwarders: result.skippedForwarders,
      reviewUrl: `/dashboard/pricing?inquiry=${job.inquiryId}`,
      safety: "Reviewed forwarder drafts only; no forwarder email was sent.",
    },
  });

  return {
    ok: true as const,
    status: result.status,
    missing: result.missing,
    blockedReasons: result.blockedReasons,
    eligibleForwarders: result.eligibleForwarders,
    createdDrafts: result.createdDrafts,
    existingDrafts: result.existingDrafts,
    skippedForwarders: result.skippedForwarders,
    auditEventId: auditEvent?.id ?? null,
    reviewUrl: `/dashboard/pricing?inquiry=${job.inquiryId}`,
    safety: "Reviewed drafts only. No forwarder email was sent.",
  };
}

export async function draftMissingInfoForJobAction(jobId: string) {
  const session = await requireSession();
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: {
      reference: true,
      title: true,
      customerEmail: true,
      origin: true,
      destination: true,
      mode: true,
      commodity: true,
      containerCount: true,
      containerType: true,
      dimensions: true,
      stackable: true,
      topLoad: true,
      dangerousGoods: true,
      customsBy: true,
      incoterms: true,
      weight: true,
      volume: true,
      targetPrice: true,
      targetCurrency: true,
      targetPriceStatus: true,
      notes: true,
      inquiry: {
        select: {
          subject: true,
          fromEmail: true,
          parsedData: true,
        },
      },
    },
  });
  if (!job) return { ok: false as const, error: "Job not found." };

  const qualification = qualifyRfq(job);
  const freshnessScope = "rfq" as const;
  const freshnessKey = draftFreshnessKey({
    ...job,
    subject: job.inquiry?.subject ?? job.title ?? job.reference,
  }, freshnessScope);
  if (qualification.isMature) {
    await recordJobDraftEvent({
      officeId: session.officeId,
      userId: session.userId,
      jobId,
      type: "missing_info_draft.blocked",
      payload: {
        status: "SKIPPED",
        decision: "SKIPPED",
        freshnessScope,
        freshnessKey,
        error: "This RFQ is already mature. No missing-info email is needed.",
      },
    });
    return { ok: false as const, error: "This RFQ is already mature. No missing-info email is needed." };
  }

  const strategyRun = await assessJobStrategy(session.officeId, jobId).catch(() => null);
  const draft = buildMissingInfoDraft({
    subject: job.inquiry?.subject ?? job.title ?? job.reference,
    fromEmail: job.customerEmail ?? job.inquiry?.fromEmail ?? null,
    origin: job.origin,
    destination: job.destination,
    mode: job.mode,
    commodity: job.commodity,
    containerCount: job.containerCount,
    containerType: job.containerType,
    incoterms: job.incoterms,
    weight: job.weight,
    volume: job.volume,
    parsedData: job.inquiry?.parsedData ?? job.notes ?? null,
    qualification,
    blockerResolutionPlan: strategyRun?.strategy.blockerResolutionPlan,
  });

  const auditEvent = await recordJobDraftEvent({
    officeId: session.officeId,
    userId: session.userId,
    jobId,
    type: "missing_info_draft.created",
    payload: {
      status: "CREATED",
      decision: "CREATED",
      freshnessScope,
      freshnessKey,
      to: draft.to,
      subject: draft.subject,
      missing: qualification.missing,
      targetPriceQuestion: qualification.targetPriceQuestion,
      blockerResolutionPlan: draft.blockerResolutionPlan.map((item) => ({
        key: item.key,
        label: item.label,
        priority: item.priority,
      })),
      questionCount: draft.questions.length,
      preview: draft.body.slice(0, 900),
      safety: "Missing-info draft only; no customer email was sent.",
    },
  });

  return {
    ok: true as const,
    auditEventId: auditEvent?.id ?? null,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
  };
}

export async function applyAgentProposalAction(proposalId: string, formData?: FormData) {
  const session = await requireSession();
  const acceptedFields = formData
    ? formData.getAll("field").map((v) => String(v)).filter(Boolean)
    : null;
  await applyPendingJobAgentProposal({
    officeId: session.officeId,
    userId: session.userId,
    proposalId,
    acceptedFields,
  });
}

export async function discardAgentProposalAction(proposalId: string, jobId: string, inquiryId?: string | null) {
  const session = await requireSession();
  await discardPendingAgentProposal({
    officeId: session.officeId,
    userId: session.userId,
    proposalId,
    jobId,
    inquiryId,
  });
}
