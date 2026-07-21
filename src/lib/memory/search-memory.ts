import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildEvidenceRefs, formatEvidenceForAgent, formatEvidenceForUser } from "./evidence";
import { hybridSearchMemory, type HybridMemorySearchInput } from "./hybrid-search";

export type SearchMemoryInput = HybridMemorySearchInput & {
  entityType?: string | null;
  entityId?: string | null;
};

function clampLimit(limit: number | null | undefined, fallback = 20) {
  return Math.max(1, Math.min(75, Math.floor(limit ?? fallback)));
}

export async function searchMemory(input: SearchMemoryInput) {
  const search = await hybridSearchMemory({
    ...input,
    limit: clampLimit(input.limit),
    includeEvents: input.includeEvents ?? true,
    includeChunks: input.includeChunks ?? true,
  });

  return {
    ...search,
    hits: search.results,
  };
}

export async function searchCustomerMemory(input: Omit<SearchMemoryInput, "entityType" | "entityId"> & { companyId: string }) {
  return searchMemory({
    ...input,
    companyId: input.companyId,
    canonicalTypes: input.canonicalTypes ?? [
      "company",
      "contact",
      "activity",
      "rfq",
      "job",
      "email_thread",
      "email_message",
      "job_document",
      "strategy_assessment",
      "customer_note",
    ],
  });
}

export async function searchJobMemory(input: Omit<SearchMemoryInput, "entityType" | "entityId"> & { jobId: string }) {
  return searchMemory({
    ...input,
    jobId: input.jobId,
    entityType: "job",
    entityId: input.jobId,
    canonicalTypes: input.canonicalTypes ?? [
      "job",
      "rfq",
      "email_thread",
      "email_message",
      "job_document",
      "strategy_assessment",
      "agent_proposal",
    ],
  });
}

export async function explainStrategyDecision(input: {
  officeId: string;
  jobId?: string | null;
  inquiryId?: string | null;
}) {
  const where: Prisma.StrategyAssessmentWhereInput = {
    officeId: input.officeId,
    status: "ACTIVE",
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(!input.jobId && input.inquiryId ? { inquiryId: input.inquiryId } : {}),
  };
  const assessment = await prisma.strategyAssessment.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      routeOptions: { orderBy: [{ source: "asc" }, { cost: "asc" }] },
      priceRecommendation: true,
      riskAssessments: { orderBy: [{ score: "desc" }] },
      actions: { orderBy: [{ createdAt: "asc" }] },
    },
  });

  if (!assessment) {
    return {
      found: false as const,
      message: "No active StrategyAssessment found for that job/RFQ. Run assess_strategy first.",
    };
  }

  const memorySearch = await hybridSearchMemory({
    officeId: input.officeId,
    query: assessment.subject ?? assessment.recommendationLabel ?? assessment.recommendation,
    jobId: assessment.jobId ?? input.jobId ?? null,
    inquiryId: assessment.inquiryId ?? input.inquiryId ?? null,
    entityType: "strategy_assessment",
    entityId: assessment.id,
    canonicalTypes: ["strategy_assessment", "job", "rfq", "email_message", "email_thread", "job_document"],
    sourceTypes: ["STRATEGY", "JOB", "INQUIRY", "GMAIL", "WHATSAPP", "DOCUMENT"],
    limit: 10,
    includeEvents: true,
    includeChunks: true,
  }).catch(() => ({
    results: [],
    evidence: [],
    evidence_for_agent: "",
    evidence_for_user: [],
  }));

  const evidenceRefs = buildEvidenceRefs(memorySearch.results);

  return {
    found: true as const,
    assessment: {
      id: assessment.id,
      entityType: assessment.entityType,
      jobId: assessment.jobId,
      inquiryId: assessment.inquiryId,
      subject: assessment.subject,
      recommendation: assessment.recommendation,
      recommendationLabel: assessment.recommendationLabel,
      strategyMemo: assessment.strategyMemo,
      score: assessment.score,
      band: assessment.band,
      confidence: assessment.confidence,
      decisionBrief: assessment.decisionBrief,
      createdAt: assessment.createdAt,
    },
    price: assessment.priceRecommendation,
    selected_route: assessment.routeOptions[0] ?? null,
    route_options: assessment.routeOptions,
    risks: assessment.riskAssessments,
    actions: assessment.actions,
    related_memory: memorySearch.results,
    evidence: evidenceRefs,
    evidence_for_agent: formatEvidenceForAgent(memorySearch.results),
    evidence_for_user: formatEvidenceForUser(memorySearch.results),
  };
}

export async function buildCompactJobMemoryContext(input: {
  officeId: string;
  jobId?: string | null;
  limit?: number | null;
}) {
  if (!input.jobId) return "";
  const search = await hybridSearchMemory({
    officeId: input.officeId,
    jobId: input.jobId,
    entityType: "job",
    entityId: input.jobId,
    canonicalTypes: ["job", "rfq", "email_thread", "email_message", "job_document", "strategy_assessment", "agent_proposal"],
    limit: clampLimit(input.limit, 8),
    includeEvents: true,
    includeChunks: true,
  }).catch(() => null);
  if (!search || search.results.length === 0) return "";
  const rows = search.results.slice(0, 8).map((result) => {
    const when = result.occurredAt.toISOString().slice(0, 10);
    const label = result.title ?? result.canonicalType ?? result.eventId ?? "memory";
    const source = [result.sourceType, result.canonicalType].filter(Boolean).join("/");
    return `- ${when} ${source}: ${label}${result.excerpt ? ` - ${result.excerpt.slice(0, 180)}` : ""}`;
  });
  return `\n\nCOMPACT JOB MEMORY (source-linked; call search_job_memory or explain_strategy_decision for details):\n${rows.join("\n")}\n`;
}
