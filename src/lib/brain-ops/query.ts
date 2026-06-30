import { prisma } from "@/lib/prisma";
import { searchMemory } from "@/lib/memory/search-memory";
import type { BrainFact } from "./types";

function sourceFromObject(object: {
  id: string;
  title: string | null;
  sourceType: string;
  occurredAt: Date;
  rawRef: string | null;
}) {
  return {
    id: object.id,
    title: object.title,
    source_type: object.sourceType,
    occurred_at: object.occurredAt.toISOString(),
    source_uri: object.rawRef,
  };
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function payloadString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function proposalFact(proposal: {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: Date;
  sourcePreview: string | null;
}): BrainFact {
  const payload = payloadRecord(proposal.payload);
  const proposedPayload = payloadRecord(payload.proposedPayload);
  return {
    claim: payloadString(proposedPayload, ["description", "summary", "question", "title", "name"]) ?? proposal.kind,
    quote: typeof payload.sourceQuote === "string" ? payload.sourceQuote : proposal.sourcePreview,
    confidence: typeof payload.confidence === "number" ? payload.confidence : null,
    source: {
      id: proposal.id,
      title: proposal.sourcePreview ?? proposal.kind,
      source_type: "brain_ops_proposal",
      occurred_at: proposal.createdAt.toISOString(),
      source_uri: null,
    },
  };
}

export async function searchBrain(input: {
  officeId: string;
  query: string;
  limit?: number;
}) {
  const result = await searchMemory({
    officeId: input.officeId,
    query: input.query,
    canonicalTypes: ["company", "contact", "activity", "rfq", "job", "customer_note", "product_decision", "code_reference", "personal_note"],
    sourceTypes: ["CRM", "PRODUCT", "DOCUMENT", "AGENT", "CODE", "PERSONAL"],
    limit: input.limit ?? 20,
    includeChunks: true,
    includeEvents: true,
  });

  return result.hits.map((hit) => ({
    claim: hit.excerpt || hit.title || hit.canonicalType,
    quote: hit.excerpt || null,
    confidence: null,
    source: {
      id: hit.objectId ?? hit.eventId ?? "",
      title: hit.title,
      source_type: hit.sourceType,
      occurred_at: hit.occurredAt.toISOString(),
      source_uri: null,
    },
    reasons: hit.reasons,
    score: hit.score,
  }));
}

export async function getOperationalBrainContext(input: {
  officeId: string;
  companyId?: string | null;
  jobId?: string | null;
  inquiryId?: string | null;
  query?: string | null;
  limit?: number;
}) {
  const query = input.query?.trim() || [
    input.jobId ? `job ${input.jobId}` : "",
    input.inquiryId ? `inquiry ${input.inquiryId}` : "",
    input.companyId ? `company ${input.companyId}` : "",
  ].filter(Boolean).join(" ");

  const result = await searchMemory({
    officeId: input.officeId,
    query,
    companyId: input.companyId ?? undefined,
    jobId: input.jobId ?? undefined,
    inquiryId: input.inquiryId ?? undefined,
    canonicalTypes: [
      "company",
      "contact",
      "activity",
      "rfq",
      "job",
      "email_thread",
      "email_message",
      "job_document",
      "strategy_assessment",
      "agent_proposal",
      "customer_note",
      "product_decision",
    ],
    sourceTypes: ["CRM", "GMAIL", "WHATSAPP", "INQUIRY", "JOB", "DOCUMENT", "STRATEGY", "AGENT", "PRODUCT"],
    limit: input.limit ?? 20,
    includeChunks: true,
    includeEvents: true,
  });

  return result.hits.map((hit) => ({
    claim: hit.excerpt || hit.title || hit.canonicalType,
    quote: hit.excerpt || null,
    confidence: null,
    source: {
      id: hit.objectId ?? hit.eventId ?? "",
      title: hit.title,
      source_type: hit.sourceType,
      occurred_at: hit.occurredAt.toISOString(),
      source_uri: null,
    },
    reasons: hit.reasons,
    score: hit.score,
  }));
}

export async function getOrganizationDossier(input: {
  officeId: string;
  organizationName: string;
}) {
  const normalized = input.organizationName.trim();
  const company = await prisma.company.findFirst({
    where: { officeId: input.officeId, name: { equals: normalized, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      status: true,
      class1: true,
      class2: true,
      lane: true,
      updatedAt: true,
    },
  });
  if (!company) {
    return { found: false as const, message: "No exact organization match found.", unresolved_organization_name: normalized };
  }
  const facts = await searchBrain({ officeId: input.officeId, query: company.name, limit: 12 });
  return { found: true as const, company, facts };
}

export async function getOpenCommitments(input: { officeId: string; limit?: number }) {
  const proposals = await prisma.agentProposal.findMany({
    where: { officeId: input.officeId, kind: "brain_ingest_commitment", status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 50,
    select: { id: true, kind: true, payload: true, createdAt: true, sourcePreview: true },
  });
  return proposals.map(proposalFact);
}

export async function getDecisionTimeline(input: { officeId: string; limit?: number }) {
  const [proposals, objects] = await Promise.all([
    prisma.agentProposal.findMany({
      where: { officeId: input.officeId, kind: "brain_ingest_decision" },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 50,
      select: { id: true, kind: true, payload: true, createdAt: true, sourcePreview: true },
    }),
    prisma.knowledgeObject.findMany({
      where: { officeId: input.officeId, canonicalType: "product_decision" },
      orderBy: { occurredAt: "desc" },
      take: input.limit ?? 50,
      select: { id: true, title: true, sourceType: true, occurredAt: true, rawRef: true, payload: true },
    }),
  ]);

  return [
    ...proposals.map(proposalFact),
    ...objects.map((object) => ({
      claim: object.title ?? "Product decision",
      quote: null,
      confidence: null,
      source: sourceFromObject(object),
    })),
  ].slice(0, input.limit ?? 50);
}

export async function getBrainSource(input: { officeId: string; sourceId: string }) {
  return prisma.knowledgeObject.findFirst({
    where: { officeId: input.officeId, id: input.sourceId },
    include: { chunks: { orderBy: { ordinal: "asc" } } },
  });
}

export async function getUnresolvedIngestProposals(input: { officeId: string; limit?: number }) {
  const rows = await prisma.agentProposal.findMany({
    where: {
      officeId: input.officeId,
      kind: { startsWith: "brain_ingest_" },
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 50,
    select: { id: true, kind: true, payload: true, createdAt: true, sourcePreview: true },
  });
  return rows.map(proposalFact);
}
