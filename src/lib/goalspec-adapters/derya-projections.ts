import type { Prisma } from "@prisma/client";
import { JobStatus } from "@prisma/client";
import { buildDocumentReadiness } from "../document-readiness";
import { openInquiryStatusFilter } from "../inquiry-status";
import type { ScopedProjection } from "./derya-read-executor";
import { ReadAuthorizationDeniedError } from "../goalspec/scheduler";

function limit(value: unknown, fallback: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error("Invalid read limit");
  return n;
}
function owned(value: unknown, officeId: string): void {
  if (!value || typeof value !== "object") return;
  if ("officeId" in value && value.officeId !== officeId) throw new ReadAuthorizationDeniedError("Joined record ownership changed");
  for (const child of Object.values(value)) if (child && typeof child === "object") owned(child, officeId);
}
// Serialize at the same JSON boundary as authoritative tool results (dates and
// absent optional fields). Do not canonicalize live Prisma objects directly.
function result(value: unknown) { return JSON.parse(JSON.stringify({ ok: true, result: value })); }

export const deryaProjection: ScopedProjection = async (tx, name, input, officeId, access) => {
  const q = String(input.q ?? "");
  const type = input.type ? String(input.type) : undefined;
  switch (name) {
    case "search_jobs": {
      const status = input.status ? String(input.status) : undefined;
      if (status && !Object.values(JobStatus).includes(status as JobStatus)) throw new Error("Invalid job status");
      const search: Prisma.JobWhereInput[] = ["reference", "origin", "destination", "commodity", "notes"].map(field => ({ [field]: { contains: q, mode: "insensitive" } }));
      search.push({ company: { name: { contains: q, mode: "insensitive" } } });
      const rows = await tx.job.findMany({
        where: { officeId, type, status: status as JobStatus | undefined, OR: q ? search : undefined },
        select: { id: true, reference: true, type: true, status: true, origin: true, destination: true, commodity: true, company: { select: { name: true, officeId: true } } },
        take: limit(input.limit, 10), orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      });
      owned(rows, officeId);
      return result(rows.map(({ company, ...row }) => ({ ...row, company: company ? { name: company.name } : null })));
    }
    case "search_inquiries": {
      const rows = await tx.inquiry.findMany({ where: { officeId, type,
        OR: q ? ["reference", "subject", "commodity", "fromEmail", "fromCompany", "origin", "destination"].map(field => ({ [field]: { contains: q, mode: "insensitive" } })) : undefined },
        select: { id: true, reference: true, subject: true, type: true, status: true, commodity: true, origin: true, destination: true, fromEmail: true, receivedAt: true },
        take: limit(input.limit, 10), orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
      });
      return result(rows);
    }
    case "search_companies":
      return result(await tx.company.findMany({ where: { officeId, name: { contains: q, mode: "insensitive" },
        ...(access?.companyOwnerId ? { owners: { some: { userId: access.companyOwnerId } } } : {}) },
        select: { id: true, name: true, status: true }, take: limit(input.limit, 10), orderBy: { id: "asc" } }));
    case "list_open_inquiries":
      return result(await tx.inquiry.findMany({ where: { officeId, type, status: openInquiryStatusFilter() },
        select: { id: true, reference: true, subject: true, type: true, commodity: true, origin: true, destination: true, status: true }, take: limit(input.limit, 20), orderBy: [{ receivedAt: "desc" }, { id: "asc" }] }));
    case "get_job": return getJob(tx, input.job_id, officeId);
  }
};

async function getJob(tx: Prisma.TransactionClient, id: unknown, officeId: string) {
  // An explicit current binding is required; no implicit focus from history.
  if (typeof id !== "string" || !id) throw new Error("Current job_id binding required");
  const job = await tx.job.findFirst({ where: { id, officeId }, include: {
    company: { select: { name: true, officeId: true } },
    inquiry: { include: { carrierQuotes: { orderBy: { id: "asc" } }, emailThreads: { orderBy: { id: "asc" }, include: { messages: { orderBy: [{ sentAt: "desc" }, { id: "asc" }], take: 1 } } } } },
    milestones: { orderBy: { id: "asc" } }, documents: { orderBy: { id: "asc" } },
  } });
  if (!job) return { ok: false, error: "Job not found" };
  owned(job, officeId);
  const readiness = buildDocumentReadiness(job.documents);
  const offers = (job.inquiry?.emailThreads ?? []).map(t => {
    let o: Record<string, unknown> = {};
    try { if (t.supplierOffer) o = JSON.parse(t.supplierOffer); } catch { /* Matches authoritative tool behavior. */ }
    return { thread_id: t.id, subject: t.subject, supplier: o.supplierName ?? null, price: o.pricePerUnit ?? null,
      currency: o.currency ?? null, unit: o.unit ?? null, qty: o.qtyAvailable ?? null, incoterms: o.incoterms ?? null,
      origin: o.origin ?? null, lead_time: o.leadTime ?? null, payment_terms: o.paymentTerms ?? null, awarded: !!t.awardedAt };
  });
  return result({ id: job.id, reference: job.reference, type: job.type, status: job.status, customer: job.company?.name ?? null,
    origin: job.origin, destination: job.destination, mode: job.mode, commodity: job.commodity, weight: job.weight, volume: job.volume,
    etd: job.etd, eta: job.eta, revenue: job.revenue, cost: job.cost, currency: job.currency, inquiry_id: job.inquiryId,
    supplier_offers: job.type === "SOURCING" ? offers : undefined,
    carrier_quotes: job.type === "FORWARDING" ? job.inquiry?.carrierQuotes.map(q => ({ carrier: q.carrier, status: q.status, total_40hc: q.total40HC, total_40: q.total40, total_20: q.total20, transit_days: q.transitDays, service: q.service })) : undefined,
    milestones: job.milestones.map(m => ({ type: m.type, planned: m.plannedAt, actual: m.actualAt })),
    document_readiness: { status: readiness.tone, label: readiness.label, metric: readiness.metric, detail: readiness.detail,
      approved: readiness.approved, uploaded: readiness.uploaded, pending: readiness.pending, analyzed: readiness.analyzed, extracted_fields: readiness.extractedFields, flags: readiness.flags },
    documents: job.documents.map(d => ({ id: d.id, name: d.name, type: d.docType, status: d.status, ai_summary: d.aiSummary, ai_flags: d.aiFlags, ai_key_fields: d.aiKeyFields })),
  });
}
