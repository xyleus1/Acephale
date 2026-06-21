import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { assessJobStrategy } from "./commercial-strategy-persistence";
import { buildCustomerQuoteDraft, type CustomerQuoteDraftContext } from "./customer-quote-draft";
import { draftFreshnessKey } from "./draft-freshness";
import { parsePipeLines } from "./quote-lines";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function lineKey(line: { description: string; amount: number; currency: string }) {
  return `${line.description.trim().toLowerCase()}|${line.amount}|${line.currency.trim().toUpperCase()}`;
}

export async function buildCustomerQuoteDraftForJob(officeId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId },
    include: {
      company: { select: { name: true } },
      inquiry: { include: { carrierQuotes: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!job) return null;

  const run = await assessJobStrategy(officeId, job.id);
  if (!run) return null;

  const context: CustomerQuoteDraftContext = {
    reference: job.reference,
    subject: job.title ?? job.inquiry?.subject ?? job.reference,
    customerName: job.company?.name ?? job.inquiry?.fromCompany,
    customerEmail: job.customerEmail ?? job.inquiry?.fromEmail,
    origin: job.origin,
    destination: job.destination,
    mode: job.mode,
    commodity: job.commodity,
    containerCount: job.containerCount,
    containerType: job.containerType,
    dimensions: job.dimensions,
    stackable: job.stackable,
    topLoad: job.topLoad,
    dangerousGoods: job.dangerousGoods,
    customsBy: job.customsBy,
    incoterms: job.incoterms,
    weight: job.weight,
    volume: job.volume,
    cargoReadyDate: job.inquiry?.cargoReadyDate ?? null,
    carrierQuotes: job.inquiry?.carrierQuotes ?? [],
  };

  return {
    job,
    assessmentId: run.assessmentId,
    draft: buildCustomerQuoteDraft(context, run.strategy),
    to: context.customerEmail ?? null,
    reviewUrl: `/dashboard/jobs/${job.id}`,
  };
}

export async function applyCustomerQuoteDraftToJob(input: {
  officeId: string;
  userId?: string | null;
  jobId: string;
}) {
  const loaded = await buildCustomerQuoteDraftForJob(input.officeId, input.jobId);
  if (!loaded) return { ok: false as const, error: "Job or strategy assessment not found." };
  const { job, draft } = loaded;
  if (draft.status !== "READY" || draft.lineItems.length === 0) {
    return {
      ok: false as const,
      error: draft.blockers.length ? `Customer quote is blocked: ${draft.blockers.join("; ")}` : "Customer quote gate is not ready.",
      blockers: draft.blockers,
    };
  }

  const legacy = job.quoteLines == null
    ? parsePipeLines(job.notes).map((line) => `${line.desc}|${line.amount}|${line.cur}`)
    : [];
  const existingRaw = [job.quoteLines ?? "", ...legacy].filter(Boolean).join("\n");
  const existingLines = parsePipeLines(existingRaw);
  const existingKeys = new Set(existingLines.map((line) => lineKey({
    description: line.desc,
    amount: line.amount,
    currency: line.cur,
  })));
  const newLines = draft.lineItems.filter((line) => !existingKeys.has(lineKey(line)));
  if (newLines.length === 0) {
    return {
      ok: true as const,
      applied: false,
      message: "The recommended customer quote line is already on this job.",
      quoteLines: existingLines.length,
    };
  }

  const appended = newLines.map((line) => `${line.description}|${line.amount}|${line.currency}`).join("\n");
  const quoteLines = existingRaw ? `${existingRaw}\n${appended}` : appended;
  const total = [...existingLines, ...newLines.map((line) => ({ desc: line.description, amount: line.amount, cur: line.currency }))]
    .reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0);
  const firstCurrency = newLines[0]?.currency ?? job.currency ?? "USD";

  await prisma.job.updateMany({
    where: { id: job.id, officeId: input.officeId },
    data: {
      quoteLines,
      revenue: job.revenue ?? (total || null),
      currency: firstCurrency,
    },
  });

  const freshnessScope = "customer_quote" as const;
  await prisma.event.create({
    data: {
      officeId: input.officeId,
      type: "customer_quote_draft.applied",
      entityType: "job",
      entityId: job.id,
      payload: toJson({
        userId: input.userId ?? null,
        jobId: job.id,
        inquiryId: job.inquiryId,
        assessmentId: loaded.assessmentId,
        freshnessScope,
        freshnessKey: draftFreshnessKey({
          ...job,
          subject: job.title ?? job.inquiry?.subject ?? job.reference,
          carrierQuotes: job.inquiry?.carrierQuotes ?? [],
          quoteLines,
          revenue: job.revenue ?? (total || null),
          currency: firstCurrency,
        }, freshnessScope),
        appliedLineItems: newLines,
        notSent: true,
        notRecordedAsOutcome: true,
      }),
    },
  }).catch(() => {});

  return {
    ok: true as const,
    applied: true,
    message: `Added ${newLines.length} quote line${newLines.length === 1 ? "" : "s"} to the quote PDF. No email was sent.`,
    quoteLines: existingLines.length + newLines.length,
  };
}
