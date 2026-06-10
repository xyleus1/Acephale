"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { maybeNotifyCustomerOnStatusChange, maybeNotifyCustomerOnMilestone } from "@/lib/customer-notify";
import { parsePipeLines } from "@/lib/quote-lines";
import { resolveCompanyIdByName } from "@/lib/company-resolve";

// ── Job status ────────────────────────────────────────────────────────────────

export async function updateJobStatus(jobId: string, status: string) {
  const session = await requireSession();
  const before = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    select: { status: true },
  });
  await prisma.job.update({
    where: { id: jobId, officeId: session.officeId },
    data: { status: status as never },
  });
  if (before && before.status !== status) {
    // Best-effort: don't block the UI if email send fails.
    maybeNotifyCustomerOnStatusChange(jobId, before.status, status).catch(() => {});
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

  // Notes: only touch when the form includes the field. Fold any legacy
  // pipe-delimited quote lines out of notes into quoteLines before overwriting.
  let notesData: { notes?: string | null; quoteLines?: string | null } = {};
  if (formData.has("notes")) {
    const existing = await prisma.job.findFirst({
      where: { id: jobId, officeId: session.officeId },
      select: { notes: true, quoteLines: true },
    });
    const legacyLines = parsePipeLines(existing?.notes);
    notesData = {
      notes: get("notes").trim() || null,
      ...(existing?.quoteLines == null && legacyLines.length > 0
        ? { quoteLines: legacyLines.map((l) => `${l.desc}|${l.amount}|${l.cur}`).join("\n") }
        : {}),
    };
  }

  await prisma.job.update({
    where: { id: jobId, officeId: session.officeId },
    data: {
      ...(status ? { status: status as never } : {}),
      companyId,
      origin: get("origin") || null,
      destination: get("destination") || null,
      mode,
      incoterms: get("incoterms") || null,
      commodity: get("commodity") || null,
      weight: num("weight"),
      volume: isFcl ? null : num("volume"),
      dimensions: isFcl ? null : (get("dimensions") || null),
      containerCount: isFcl ? num("containerCount") : null,
      containerType: isFcl ? (get("containerType") || null) : null,
      packages: num("packages") as number | null,
      etd: dt("etd"),
      eta: dt("eta"),
      revenue: num("revenue"),
      cost: num("cost"),
      currency: get("currency") || "USD",
      ...notesData,
    },
  });
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
  await prisma.jobDocument.update({
    where: { id: docId },
    data: { status, url: status === "UPLOADED" ? (doc.url ?? "#placeholder") : doc.url },
  });
  // On approve, run AI analysis (best-effort; don't block UI on failure).
  if (status === "APPROVED" && doc.url && !doc.url.includes("placeholder")) {
    const { analyzeJobDocument } = await import("@/lib/doc-analyze");
    analyzeJobDocument({ documentId: docId }).catch(() => {});
  }
  revalidatePath(`/dashboard/jobs/${doc.jobId}`);
}

export async function addDocument(jobId: string, formData: FormData) {
  const session = await requireSession();
  const job = await prisma.job.findFirst({ where: { id: jobId, officeId: session.officeId } });
  if (!job) return;
  await prisma.jobDocument.create({
    data: {
      jobId,
      officeId: session.officeId,
      name:    String(formData.get("name") ?? ""),
      docType: String(formData.get("docType") ?? "OTHER"),
      status:  "PENDING",
      uploadedByUserId: session.userId,
    },
  });
  revalidatePath(`/dashboard/jobs/${jobId}`);
}

// ── Milestones ────────────────────────────────────────────────────────────────

const DEFAULT_MILESTONES = [
  "BOOKING", "CARGO_READY", "ETD", "ETA", "CUSTOMS_ENTRY", "CUSTOMS_RELEASE", "DELIVERY",
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
  await prisma.jobMilestone.update({
    where: { id: milestoneId },
    data: { plannedAt: plannedAt ? new Date(plannedAt) : null },
  });
  revalidatePath(`/dashboard/jobs/${ms.jobId}`);
}

export async function markMilestoneActual(milestoneId: string) {
  const session = await requireSession();
  const ms = await prisma.jobMilestone.findFirst({
    where: { id: milestoneId },
    include: { job: { select: { officeId: true } } },
  });
  if (!ms || ms.job.officeId !== session.officeId) return;
  await prisma.jobMilestone.update({
    where: { id: milestoneId },
    data: { actualAt: new Date() },
  });
  maybeNotifyCustomerOnMilestone(ms.jobId, ms.type, true).catch(() => {});
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
