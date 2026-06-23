import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCanonicalType, normalizeCanonicalType, normalizeSourceType } from "./canonical-types";
import {
  ensureKnowledgeSource,
  isRecoverableMemoryError,
  toMemoryJson,
  type MemoryEntityType,
  type MemoryProvenance,
  type MemorySourceType,
} from "./record-event";

export type EntityReference = {
  entityType: MemoryEntityType | string;
  entityId: string | null | undefined;
  label?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type IngestKnowledgeObjectInput = {
  officeId: string;
  sourceType: MemorySourceType | string;
  sourceExternalId: string;
  sourceLabel?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  canonicalType: string;
  title?: string | null;
  text?: string | null;
  rawRef?: string | null;
  visibility?: string | null;
  retentionPolicy?: string | null;
  entityType?: MemoryEntityType | string | null;
  entityId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  inquiryId?: string | null;
  jobId?: string | null;
  emailThreadId?: string | null;
  emailMessageId?: string | null;
  jobDocumentId?: string | null;
  strategyAssessmentId?: string | null;
  agentProposalId?: string | null;
  occurredAt?: Date | string | null;
  payloadVersion?: number;
  payload: Record<string, unknown>;
  provenance: MemoryProvenance;
  mentions?: EntityReference[];
  strict?: boolean;
};

function asDate(value: Date | string | null | undefined) {
  if (!value) return new Date();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function contentHash(input: Pick<IngestKnowledgeObjectInput, "text" | "payload">) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ text: input.text ?? "", payload: input.payload ?? {} }))
    .digest("hex");
}

function roughTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3));
}

function normalizeExternalId(value: string) {
  return value.trim();
}

function uniqueMentions(input: IngestKnowledgeObjectInput): EntityReference[] {
  const base: EntityReference[] = [
    { entityType: input.entityType ?? "", entityId: input.entityId ?? null, label: input.title ?? null },
    { entityType: "company", entityId: input.companyId ?? null },
    { entityType: "contact", entityId: input.contactId ?? null },
    { entityType: "inquiry", entityId: input.inquiryId ?? null },
    { entityType: "job", entityId: input.jobId ?? null },
    { entityType: "email_thread", entityId: input.emailThreadId ?? null },
    { entityType: "email_message", entityId: input.emailMessageId ?? null },
    { entityType: "job_document", entityId: input.jobDocumentId ?? null },
    { entityType: "strategy_assessment", entityId: input.strategyAssessmentId ?? null },
    { entityType: "agent_proposal", entityId: input.agentProposalId ?? null },
    ...(input.mentions ?? []),
  ];

  const seen = new Set<string>();
  return base.filter((mention) => {
    if (!mention.entityType || !mention.entityId) return false;
    const key = `${mention.entityType}:${mention.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function writeKnowledgeObject(input: IngestKnowledgeObjectInput) {
  const sourceExternalId = normalizeExternalId(input.sourceExternalId);
  if (!sourceExternalId) throw new Error("KnowledgeObject sourceExternalId is required.");
  const sourceType = normalizeSourceType(input.sourceType);
  const canonicalType = input.strict
    ? assertCanonicalType(input.canonicalType)
    : normalizeCanonicalType(input.canonicalType);
  const source = await ensureKnowledgeSource({
    officeId: input.officeId,
    type: sourceType,
    externalId: sourceExternalId.split(":").slice(0, 2).join(":") || sourceExternalId,
    label: input.sourceLabel,
    metadata: input.sourceMetadata,
  });
  const occurredAt = asDate(input.occurredAt);
  const hash = contentHash(input);
  const payloadVersion = input.payloadVersion ?? 1;

  return prisma.$transaction(async (tx) => {
    const object = await tx.knowledgeObject.upsert({
      where: {
        officeId_sourceType_sourceExternalId: {
          officeId: input.officeId,
          sourceType,
          sourceExternalId,
        },
      },
      update: {
        sourceId: source.id,
        canonicalType,
        title: input.title ?? null,
        contentHash: hash,
        rawRef: input.rawRef ?? null,
        visibility: input.visibility ?? "INTERNAL",
        retentionPolicy: input.retentionPolicy ?? "DEFAULT",
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        inquiryId: input.inquiryId ?? null,
        jobId: input.jobId ?? null,
        emailThreadId: input.emailThreadId ?? null,
        emailMessageId: input.emailMessageId ?? null,
        jobDocumentId: input.jobDocumentId ?? null,
        strategyAssessmentId: input.strategyAssessmentId ?? null,
        agentProposalId: input.agentProposalId ?? null,
        occurredAt,
        payloadVersion,
        payload: toMemoryJson(input.payload),
        provenance: toMemoryJson(input.provenance),
      },
      create: {
        officeId: input.officeId,
        sourceId: source.id,
        sourceType,
        sourceExternalId,
        canonicalType,
        title: input.title ?? null,
        contentHash: hash,
        rawRef: input.rawRef ?? null,
        visibility: input.visibility ?? "INTERNAL",
        retentionPolicy: input.retentionPolicy ?? "DEFAULT",
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        companyId: input.companyId ?? null,
        contactId: input.contactId ?? null,
        inquiryId: input.inquiryId ?? null,
        jobId: input.jobId ?? null,
        emailThreadId: input.emailThreadId ?? null,
        emailMessageId: input.emailMessageId ?? null,
        jobDocumentId: input.jobDocumentId ?? null,
        strategyAssessmentId: input.strategyAssessmentId ?? null,
        agentProposalId: input.agentProposalId ?? null,
        occurredAt,
        payloadVersion,
        payload: toMemoryJson(input.payload),
        provenance: toMemoryJson(input.provenance),
      },
      select: { id: true },
    });

    const text = input.text?.trim();
    if (text) {
      await tx.knowledgeChunk.upsert({
        where: { objectId_ordinal: { objectId: object.id, ordinal: 0 } },
        update: {
          officeId: input.officeId,
          kind: "TEXT",
          text,
          tokenCount: roughTokenCount(text),
          payloadVersion,
          provenance: toMemoryJson(input.provenance),
        },
        create: {
          officeId: input.officeId,
          objectId: object.id,
          ordinal: 0,
          kind: "TEXT",
          text,
          tokenCount: roughTokenCount(text),
          payloadVersion,
          provenance: toMemoryJson(input.provenance),
        },
        select: { id: true },
      });
    }

    await tx.entityMention.deleteMany({ where: { officeId: input.officeId, objectId: object.id } });
    const mentions = uniqueMentions(input);
    if (mentions.length > 0) {
      await tx.entityMention.createMany({
        data: mentions.map((mention) => ({
          officeId: input.officeId,
          objectId: object.id,
          entityType: mention.entityType,
          entityId: String(mention.entityId),
          label: mention.label ?? null,
          confidence: mention.confidence ?? null,
          source: "SYSTEM",
          metadata: mention.metadata ? toMemoryJson(mention.metadata) : undefined,
          payloadVersion,
          provenance: toMemoryJson(input.provenance),
        })) as Prisma.EntityMentionCreateManyInput[],
      });
    }

    return object;
  });
}

export async function ingestKnowledgeObject(input: IngestKnowledgeObjectInput): Promise<{ id: string } | null> {
  try {
    return await writeKnowledgeObject(input);
  } catch (error) {
    if (input.strict || !isRecoverableMemoryError(error)) throw error;
    return null;
  }
}

export async function ingestKnowledgeObjectStrict(input: Omit<IngestKnowledgeObjectInput, "strict">) {
  return ingestKnowledgeObject({ ...input, strict: true });
}
