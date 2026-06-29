import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { toMemoryJson } from "@/lib/memory/record-event";
import type {
  BrainIngestPayload,
  BrainIngestRejectedItem,
  BrainIngestResult,
  BrainIngestWarning,
  BrainMode,
  BrainProposalType,
} from "./types";

const VALID_SOURCE_TYPES = new Set([
  "meeting_note",
  "granola_meeting_note",
  "email",
  "call_note",
  "proposal",
  "contract",
  "memo",
  "product_doc",
  "support_ticket",
  "research",
  "manual_note",
  "other",
]);

const VALID_DOCUMENT_STATUSES = new Set(["current-state", "plan", "brainstorm", "report", "archived", "unknown"]);
const RISKY_PROPOSAL_KEYS = ["commitments", "decisions", "risks", "open_questions"] as const;

type CompanyLink = {
  companyId: string | null;
  unresolvedName: string | null;
};

type ResolvedOperationalRef = {
  type: string;
  id: string;
  label: string;
  path: string;
};

type OperationalContext = {
  companyId: string | null;
  jobId: string | null;
  inquiryId: string | null;
  refs: ResolvedOperationalRef[];
};

type BrainProposal = {
  type: BrainProposalType;
  payload: Record<string, unknown>;
  sourceQuote: string | null;
  confidence: number | null;
};

export function normalizeBrainName(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function parseDate(value: string | null | undefined, path: string, rejected: BrainIngestRejectedItem[]) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    rejected.push({ path, message: "Invalid date. Use ISO or YYYY-MM-DD.", payload: value });
    return null;
  }
  return date;
}

function contentHash(value: unknown) {
  return crypto.createHash("sha256").update(stableStringify(value ?? null)).digest("hex").slice(0, 24);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function requireText(value: unknown, path: string, rejected: BrainIngestRejectedItem[]) {
  const text = String(value ?? "").trim();
  if (!text) rejected.push({ path, message: "Required field is missing." });
  return text;
}

function maybeConfidence(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
}

function sourceQuoteFor(
  item: { source_quote?: string; manually_entered?: boolean },
  path: string,
  rejected: BrainIngestRejectedItem[],
) {
  const quote = String(item.source_quote ?? "").trim();
  if (!quote && !item.manually_entered) {
    rejected.push({
      path,
      message: "source_quote is required for commitments, decisions, risks, and open questions unless manually_entered is true.",
      payload: item,
    });
  }
  return quote || null;
}

function addUnresolvedRef(
  unresolvedEntities: BrainIngestResult["unresolvedEntities"],
  type: string,
  name: string,
  path: string,
  reason?: string,
) {
  unresolvedEntities.push({ type, name: reason ? `${name} (${reason})` : name, path });
}

async function validateActor(input: {
  officeId: string;
  userId?: string | null;
}) {
  if (!input.userId) return null;
  const user = await prisma.user.findFirst({
    where: { id: input.userId, officeId: input.officeId },
    select: { id: true },
  });
  return user ? null : { path: "userId", message: "userId must belong to the same office as the Brain Ops ingest.", payload: input.userId };
}

async function resolveCompanyLinks(officeId: string, names: string[]) {
  const uniqueNames = [...new Set(names.map(normalizeBrainName).filter(Boolean))];
  if (uniqueNames.length === 0) return new Map<string, CompanyLink>();

  const companies = await prisma.company.findMany({
    where: { officeId, name: { in: uniqueNames, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const byNormalized = new Map(companies.map((company) => [normalizeBrainName(company.name), company.id]));
  return new Map(uniqueNames.map((name) => [name, { companyId: byNormalized.get(name) ?? null, unresolvedName: byNormalized.has(name) ? null : name }]));
}

function collectOrganizationNames(payload: BrainIngestPayload) {
  return [
    ...(payload.people ?? []).map((item) => item.organization_name),
    ...(payload.interactions ?? []).map((item) => item.organization_name),
    ...(payload.commitments ?? []).map((item) => item.organization_name),
    ...(payload.risks ?? []).map((item) => item.organization_name),
    ...(payload.open_questions ?? []).map((item) => item.organization_name),
    ...(payload.documents ?? []).map((item) => item.organization_name),
  ].filter((name): name is string => Boolean(String(name ?? "").trim()));
}

function linkFor(links: Map<string, CompanyLink>, organizationName: string | null | undefined) {
  const name = normalizeBrainName(organizationName);
  return links.get(name) ?? { companyId: null, unresolvedName: name || null };
}

async function resolveOperationalRefs(input: {
  officeId: string;
  payload: BrainIngestPayload;
  unresolvedEntities: BrainIngestResult["unresolvedEntities"];
}) {
  const refs = input.payload.operational_refs ?? [];
  const resolved: ResolvedOperationalRef[] = [];
  const addUnresolved = (type: string, name: string, path: string) => {
    addUnresolvedRef(input.unresolvedEntities, type, name, path);
  };
  const addAmbiguous = (type: string, name: string, path: string) => {
    addUnresolvedRef(input.unresolvedEntities, type, name, path, "ambiguous exact match");
  };

  for (const [index, ref] of refs.entries()) {
    const type = String(ref.type ?? "").trim();
    const path = `operational_refs.${index}`;
    if (!type) {
      addUnresolved("operational_ref", JSON.stringify(ref), `${path}.type`);
      continue;
    }

    if (type === "company") {
      const name = String(ref.name ?? "").trim();
      const id = String(ref.id ?? "").trim();
      const company = await prisma.company.findFirst({
        where: {
          officeId: input.officeId,
          ...(id ? { id } : { name: { equals: name, mode: "insensitive" } }),
        },
        select: { id: true, name: true },
      });
      if (company) resolved.push({ type, id: company.id, label: company.name, path });
      else addUnresolved(type, name || id || "missing company reference", path);
      continue;
    }

    if (type === "contact") {
      const email = String(ref.email ?? "").trim();
      const name = String(ref.name ?? "").trim();
      const contacts = await prisma.contact.findMany({
        where: {
          company: { officeId: input.officeId },
          ...(email ? { email: { equals: email, mode: "insensitive" } } : { fullName: { equals: name, mode: "insensitive" } }),
        },
        take: 2,
        select: { id: true, fullName: true, email: true },
      });
      if (contacts.length > 1) {
        addAmbiguous(type, email || name, path);
        continue;
      }
      const contact = contacts[0];
      if (contact) resolved.push({ type, id: contact.id, label: contact.email ?? contact.fullName, path });
      else addUnresolved(type, email || name || "missing contact reference", path);
      continue;
    }

    if (type === "job") {
      const id = String(ref.id ?? "").trim();
      const reference = String(ref.reference ?? "").trim();
      const job = await prisma.job.findFirst({
        where: {
          officeId: input.officeId,
          ...(id ? { id } : { reference: { equals: reference, mode: "insensitive" } }),
        },
        select: { id: true, reference: true, title: true, companyId: true, inquiryId: true },
      });
      if (job) {
        resolved.push({ type, id: job.id, label: job.reference, path });
        if (job.companyId) resolved.push({ type: "company", id: job.companyId, label: `company:${job.companyId}`, path: `${path}.companyId` });
        if (job.inquiryId) resolved.push({ type: "inquiry", id: job.inquiryId, label: `inquiry:${job.inquiryId}`, path: `${path}.inquiryId` });
      } else {
        addUnresolved(type, reference || id || "missing job reference", path);
      }
      continue;
    }

    if (type === "inquiry") {
      const id = String(ref.id ?? "").trim();
      const subject = String(ref.subject ?? "").trim();
      const inquiries = await prisma.inquiry.findMany({
        where: {
          officeId: input.officeId,
          ...(id ? { id } : { subject: { equals: subject, mode: "insensitive" } }),
        },
        take: 2,
        select: { id: true, subject: true, companyId: true },
      });
      if (inquiries.length > 1) {
        addAmbiguous(type, subject || id, path);
        continue;
      }
      const inquiry = inquiries[0];
      if (inquiry) {
        resolved.push({ type, id: inquiry.id, label: inquiry.subject, path });
        if (inquiry.companyId) resolved.push({ type: "company", id: inquiry.companyId, label: `company:${inquiry.companyId}`, path: `${path}.companyId` });
      } else {
        addUnresolved(type, subject || id || "missing inquiry reference", path);
      }
      continue;
    }

    if (type === "email_thread") {
      const id = String(ref.id ?? "").trim();
      const externalId = String(ref.external_id ?? "").trim();
      const threads = await prisma.emailThread.findMany({
        where: {
          officeId: input.officeId,
          ...(id ? { id } : { externalThreadId: externalId || "__missing_external_id__" }),
        },
        take: 2,
        select: { id: true, subject: true, jobId: true, inquiryId: true },
      });
      if (threads.length > 1) {
        addAmbiguous(type, externalId || id, path);
        continue;
      }
      const thread = threads[0];
      if (thread) {
        resolved.push({ type, id: thread.id, label: thread.subject, path });
        if (thread.jobId) resolved.push({ type: "job", id: thread.jobId, label: `job:${thread.jobId}`, path: `${path}.jobId` });
        if (thread.inquiryId) resolved.push({ type: "inquiry", id: thread.inquiryId, label: `inquiry:${thread.inquiryId}`, path: `${path}.inquiryId` });
      } else {
        addUnresolved(type, externalId || id || "missing email thread reference", path);
      }
      continue;
    }

    if (type === "email_message") {
      const id = String(ref.id ?? "").trim();
      const externalId = String(ref.external_id ?? "").trim();
      const messages = await prisma.emailMessage.findMany({
        where: {
          ...(id ? { id } : { OR: [{ externalId: externalId || "__missing_external_id__" }, { gmailMessageId: externalId || "__missing_external_id__" }] }),
          thread: { officeId: input.officeId },
        },
        take: 2,
        select: { id: true, subject: true, threadId: true, thread: { select: { jobId: true, inquiryId: true } } },
      });
      if (messages.length > 1) {
        addAmbiguous(type, externalId || id, path);
        continue;
      }
      const message = messages[0];
      if (message) {
        resolved.push({ type, id: message.id, label: message.subject ?? message.id, path });
        resolved.push({ type: "email_thread", id: message.threadId, label: `email_thread:${message.threadId}`, path: `${path}.threadId` });
        if (message.thread.jobId) resolved.push({ type: "job", id: message.thread.jobId, label: `job:${message.thread.jobId}`, path: `${path}.jobId` });
        if (message.thread.inquiryId) resolved.push({ type: "inquiry", id: message.thread.inquiryId, label: `inquiry:${message.thread.inquiryId}`, path: `${path}.inquiryId` });
      } else {
        addUnresolved(type, externalId || id || "missing email message reference", path);
      }
      continue;
    }

    if (type === "job_document") {
      const id = String(ref.id ?? "").trim();
      if (!id) {
        addUnresolved(type, "missing job document id", path);
        continue;
      }
      const document = await prisma.jobDocument.findFirst({
        where: { id, officeId: input.officeId },
        select: { id: true, name: true, jobId: true },
      });
      if (document) {
        resolved.push({ type, id: document.id, label: document.name, path });
        resolved.push({ type: "job", id: document.jobId, label: `job:${document.jobId}`, path: `${path}.jobId` });
      } else {
        addUnresolved(type, id, path);
      }
      continue;
    }

    if (type === "strategy_assessment") {
      const id = String(ref.id ?? "").trim();
      if (!id) {
        addUnresolved(type, "missing strategy assessment id", path);
        continue;
      }
      const assessment = await prisma.strategyAssessment.findFirst({
        where: { id, officeId: input.officeId },
        select: { id: true, subject: true, jobId: true, inquiryId: true },
      });
      if (assessment) {
        resolved.push({ type, id: assessment.id, label: assessment.subject ?? assessment.id, path });
        if (assessment.jobId) resolved.push({ type: "job", id: assessment.jobId, label: `job:${assessment.jobId}`, path: `${path}.jobId` });
        if (assessment.inquiryId) resolved.push({ type: "inquiry", id: assessment.inquiryId, label: `inquiry:${assessment.inquiryId}`, path: `${path}.inquiryId` });
      } else {
        addUnresolved(type, id, path);
      }
      continue;
    }

    addUnresolved(type, String(ref.id ?? ref.reference ?? ref.name ?? ref.email ?? type), path);
  }

  const first = (type: string) => resolved.find((ref) => ref.type === type)?.id ?? null;
  return {
    companyId: first("company"),
    jobId: first("job"),
    inquiryId: first("inquiry"),
    refs: resolved,
  };
}

function sourceMemoryShape(sourceType: string, context: OperationalContext) {
  if (context.jobId) return { sourceType: "DOCUMENT", canonicalType: "job" };
  if (context.inquiryId) return { sourceType: "DOCUMENT", canonicalType: "rfq" };
  if (context.companyId) return { sourceType: "DOCUMENT", canonicalType: "customer_note" };
  if (sourceType === "product_doc") return { sourceType: "PRODUCT", canonicalType: "product_decision" };
  return { sourceType: "DOCUMENT", canonicalType: "customer_note" };
}

export async function validateBrainIngestPayload(input: {
  officeId: string;
  payload: BrainIngestPayload;
}): Promise<Omit<BrainIngestResult, "sourceObjectId" | "batchProposalId" | "proposalIds" | "createdRecords"> & { proposals: BrainProposal[] }> {
  const rejectedItems: BrainIngestRejectedItem[] = [];
  const warnings: BrainIngestWarning[] = [];
  const unresolvedEntities: BrainIngestResult["unresolvedEntities"] = [];
  const payload = input.payload ?? {};
  const mode: BrainMode = payload.mode === "trusted" ? "trusted" : "calibration";
  const source = payload.source ?? {};

  const title = requireText(source.title, "source.title", rejectedItems);
  const sourceType = requireText(source.source_type, "source.source_type", rejectedItems);
  if (sourceType && !VALID_SOURCE_TYPES.has(sourceType)) {
    rejectedItems.push({ path: "source.source_type", message: `Invalid source_type "${sourceType}".`, payload: sourceType });
  }
  parseDate(source.occurred_at, "source.occurred_at", rejectedItems);
  if (sourceType === "granola_meeting_note" && !String(source.raw_text ?? "").trim() && !String(source.source_uri ?? "").trim()) {
    rejectedItems.push({
      path: "source",
      message: "Granola meeting notes require source.raw_text or source.source_uri so the note remains source-backed.",
      payload: source,
    });
  }

  for (const key of RISKY_PROPOSAL_KEYS) {
    (payload[key] ?? []).forEach((item, index) => sourceQuoteFor(item, `${key}.${index}.source_quote`, rejectedItems));
  }
  (payload.documents ?? []).forEach((item, index) => {
    if (item.status && !VALID_DOCUMENT_STATUSES.has(item.status)) {
      rejectedItems.push({ path: `documents.${index}.status`, message: `Invalid document status "${item.status}".`, payload: item });
    }
  });

  const links = await resolveCompanyLinks(input.officeId, collectOrganizationNames(payload));
  const operationalContext = await resolveOperationalRefs({ officeId: input.officeId, payload, unresolvedEntities });
  const proposals: BrainProposal[] = [];
  const pushProposal = (type: BrainProposalType, item: Record<string, unknown>, sourceQuote?: string | null, confidence?: number | null) => {
    proposals.push({ type, payload: item, sourceQuote: sourceQuote ?? null, confidence: confidence ?? null });
  };

  (payload.organizations ?? []).forEach((item, index) => {
    const name = String(item.name ?? "").trim();
    if (!name) rejectedItems.push({ path: `organizations.${index}.name`, message: "Organization name is required.", payload: item });
    pushProposal("organization", { ...item, normalized_name: normalizeBrainName(name) }, item.source_quote ?? null, maybeConfidence(item.confidence));
    if (mode === "calibration") warnings.push({ path: `organizations.${index}`, message: "Calibration mode does not auto-create organizations." });
  });

  ([
    ["people", "person"],
    ["interactions", "interaction"],
    ["commitments", "commitment"],
    ["risks", "risk"],
    ["open_questions", "open_question"],
    ["documents", "document"],
  ] as const).forEach(([collection, type]) => {
    (payload[collection] ?? []).forEach((item, index) => {
      const orgName = "organization_name" in item ? item.organization_name : undefined;
      const link = linkFor(links, orgName);
      if (link.unresolvedName) unresolvedEntities.push({ type: "organization", name: link.unresolvedName, path: `${collection}.${index}.organization_name` });
      pushProposal(type, {
        ...item,
        company_id: link.companyId,
        unresolved_organization_name: link.unresolvedName,
      }, item.source_quote ?? null, maybeConfidence(item.confidence));
    });
  });

  (payload.decisions ?? []).forEach((item) => {
    pushProposal("decision", { ...item, status: "proposed" }, item.source_quote ?? null, maybeConfidence(item.confidence));
  });

  if (mode === "trusted") {
    warnings.push({
      path: "mode",
      message: "Trusted mode still creates reviewable proposals for decisions, commitments, pricing, legal, scope, and customer-facing claims.",
    });
  }

  return {
    ok: rejectedItems.length === 0,
    mode,
    unresolvedEntities,
    resolvedOperationalRefs: operationalContext.refs,
    rejectedItems,
    warnings,
    proposals,
  };
}

export async function applyBrainIngest(input: {
  officeId: string;
  userId?: string | null;
  payload: BrainIngestPayload;
}): Promise<BrainIngestResult> {
  const validation = await validateBrainIngestPayload({ officeId: input.officeId, payload: input.payload });
  const actorError = await validateActor({ officeId: input.officeId, userId: input.userId });
  if (actorError) validation.rejectedItems.push(actorError);
  if (!validation.ok || validation.rejectedItems.length > 0) {
    return {
      ok: false,
      mode: validation.mode,
      proposalIds: [],
      createdRecords: [],
      unresolvedEntities: validation.unresolvedEntities,
      rejectedItems: validation.rejectedItems,
      warnings: validation.warnings,
    };
  }

  const source = input.payload.source!;
  const occurredAt = parseDate(source.occurred_at, "source.occurred_at", []) ?? new Date();
  const sourceExternalId = `brain-ops:${contentHash({ officeId: input.officeId, source, payload: input.payload })}`;
  const operationalContext = await resolveOperationalRefs({
    officeId: input.officeId,
    payload: input.payload,
    unresolvedEntities: [],
  });
  const memoryShape = sourceMemoryShape(String(source.source_type ?? ""), operationalContext);
  const existingSourceObject = await prisma.knowledgeObject.findUnique({
    where: {
      officeId_sourceType_sourceExternalId: {
        officeId: input.officeId,
        sourceType: memoryShape.sourceType,
        sourceExternalId,
      },
    },
    select: { id: true },
  });

  if (existingSourceObject) {
    const existingProposals = await prisma.agentProposal.findMany({
      where: {
        officeId: input.officeId,
        sourceType: "brain_ops",
        kind: { startsWith: "brain_ingest_" },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, payload: true },
    });
    const matching = existingProposals.filter((proposal) => payloadRecord(proposal.payload).sourceObjectId === existingSourceObject.id);
    const batch = matching.find((proposal) => proposal.kind === "brain_ingest_batch") ?? null;
    const proposalIds = matching.filter((proposal) => proposal.kind !== "brain_ingest_batch").map((proposal) => proposal.id);
    return {
      ok: true,
      mode: validation.mode,
      sourceObjectId: existingSourceObject.id,
      batchProposalId: batch?.id,
      proposalIds,
      createdRecords: [
        { type: "KnowledgeObject", id: existingSourceObject.id },
        ...(batch ? [{ type: "AgentProposal", id: batch.id }] : []),
        ...proposalIds.map((id) => ({ type: "AgentProposal", id })),
      ],
      unresolvedEntities: validation.unresolvedEntities,
      resolvedOperationalRefs: validation.resolvedOperationalRefs ?? [],
      rejectedItems: [],
      warnings: [
        ...validation.warnings,
        { path: "source", message: "Duplicate Brain Ops source payload detected; returning existing source/proposals without writing duplicates." },
      ],
    };
  }

  return prisma.$transaction(async (tx) => {
    const knowledgeSource = await tx.knowledgeSource.upsert({
      where: {
        officeId_type_externalId: {
          officeId: input.officeId,
          type: memoryShape.sourceType,
          externalId: "brain-ops",
        },
      },
      update: { label: "Derya Brain Ops" },
      create: { officeId: input.officeId, type: memoryShape.sourceType, externalId: "brain-ops", label: "Derya Brain Ops" },
      select: { id: true },
    });

    const sourceObject = await tx.knowledgeObject.create({
      data: {
        officeId: input.officeId,
        sourceId: knowledgeSource.id,
        sourceType: memoryShape.sourceType,
        sourceExternalId,
        canonicalType: memoryShape.canonicalType,
        title: source.title!,
        rawRef: source.source_uri || null,
        companyId: operationalContext.companyId,
        jobId: operationalContext.jobId,
        inquiryId: operationalContext.inquiryId,
        entityType: operationalContext.jobId ? "job" : operationalContext.inquiryId ? "inquiry" : operationalContext.companyId ? "company" : null,
        entityId: operationalContext.jobId ?? operationalContext.inquiryId ?? operationalContext.companyId,
        occurredAt,
        payload: toMemoryJson({
          brainOpsKind: "source",
          sourceType: source.source_type,
          sourceUri: source.source_uri ?? null,
          mode: validation.mode,
          operationalRefs: operationalContext.refs,
        }),
        provenance: toMemoryJson({
          source: "brain_ops_ingest",
          operation: "create_source_and_proposals",
          path: "src/lib/brain-ops/ingest.ts",
          actorType: input.userId ? "user" : "system",
          actorId: input.userId ?? null,
        }),
      },
      select: { id: true },
    });

    if (operationalContext.refs.length > 0) {
      const mentionKeys = new Set<string>();
      await Promise.all(operationalContext.refs
        .filter((ref) => {
          const key = `${ref.type}:${ref.id}`;
          if (mentionKeys.has(key)) return false;
          mentionKeys.add(key);
          return true;
        })
        .map((ref) => tx.entityMention.create({
          data: {
            officeId: input.officeId,
            objectId: sourceObject.id,
            entityType: ref.type,
            entityId: ref.id,
            label: ref.label,
            confidence: 1,
            source: "BRAIN_OPS_EXACT_REF",
            provenance: toMemoryJson({
              source: "brain_ops_ingest",
              operation: "resolve_operational_ref",
              path: ref.path,
            }),
          },
        })));
    }

    if (source.raw_text?.trim()) {
      await tx.knowledgeChunk.create({
        data: {
          officeId: input.officeId,
          objectId: sourceObject.id,
          ordinal: 0,
          kind: "TEXT",
          text: source.raw_text.trim(),
          provenance: toMemoryJson({ source: "brain_ops_ingest", operation: "store_source_text", path: "src/lib/brain-ops/ingest.ts" }),
        },
      });
    }

    const batch = await tx.agentProposal.create({
      data: {
        officeId: input.officeId,
        userId: input.userId ?? null,
        kind: "brain_ingest_batch",
        status: "PENDING",
        sourceType: "brain_ops",
        sourcePreview: source.title,
        payload: toMemoryJson({
          mode: validation.mode,
          sourceObjectId: sourceObject.id,
          source,
          warnings: validation.warnings,
          unresolvedEntities: validation.unresolvedEntities,
          resolvedOperationalRefs: validation.resolvedOperationalRefs ?? [],
        }),
      },
      select: { id: true },
    });

    const created = await Promise.all(validation.proposals.map((proposal, index) => tx.agentProposal.create({
      data: {
        officeId: input.officeId,
        userId: input.userId ?? null,
        kind: `brain_ingest_${proposal.type}`,
        status: "PENDING",
        sourceType: "brain_ops",
        sourcePreview: proposal.sourceQuote ?? source.title,
        payload: toMemoryJson({
          batchId: batch.id,
          sourceObjectId: sourceObject.id,
          proposalType: proposal.type,
          proposedPayload: proposal.payload,
          sourceQuote: proposal.sourceQuote,
          confidence: proposal.confidence,
          reviewStatus: "pending",
        }),
      },
      select: { id: true },
    })));

    return {
      ok: true,
      mode: validation.mode,
      sourceObjectId: sourceObject.id,
      batchProposalId: batch.id,
      proposalIds: created.map((row) => row.id),
      createdRecords: [
        { type: "KnowledgeObject", id: sourceObject.id },
        { type: "AgentProposal", id: batch.id },
        ...created.map((row) => ({ type: "AgentProposal", id: row.id })),
      ],
      unresolvedEntities: validation.unresolvedEntities,
      resolvedOperationalRefs: validation.resolvedOperationalRefs ?? [],
      rejectedItems: validation.rejectedItems,
      warnings: validation.warnings,
    };
  });
}
