import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeSourceType } from "./canonical-types";

export type MemorySourceType =
  | "CRM"
  | "GMAIL"
  | "WHATSAPP"
  | "GOOGLE_SHEETS"
  | "INQUIRY"
  | "JOB"
  | "DOCUMENT"
  | "STRATEGY"
  | "AGENT"
  | "SYSTEM"
  | "MARKET"
  | "PRODUCT"
  | "CODE"
  | "PERSONAL";

export type MemoryEntityType =
  | "company"
  | "contact"
  | "activity"
  | "inquiry"
  | "job"
  | "email_thread"
  | "email_message"
  | "job_document"
  | "strategy_assessment"
  | "agent_proposal"
  | "forwarder_draft"
  | "customer_quote"
  | "system";

export type MemoryProvenance = {
  source: string;
  operation: string;
  path?: string;
  function?: string;
  sourceRecordId?: string | null;
  sourceExternalId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  notes?: string[];
};

type MemoryDb = typeof prisma | Prisma.TransactionClient;

export type RecordMemoryEventInput = {
  officeId: string;
  sourceType: MemorySourceType | string;
  sourceExternalId?: string | null;
  sourceLabel?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  objectId?: string | null;
  eventType: string;
  entityType: MemoryEntityType | string;
  entityId: string;
  actorType?: string | null;
  actorId?: string | null;
  occurredAt?: Date | string | null;
  payloadVersion?: number;
  payload: Record<string, unknown>;
  provenance: MemoryProvenance;
  idempotencyKey?: string | null;
  strict?: boolean;
};

export type EnsureKnowledgeSourceInput = {
  officeId: string;
  type: MemorySourceType | string;
  externalId?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function toMemoryJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function sourceExternalId(input: string | null | undefined) {
  return input?.trim() || "default";
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return new Date();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 24);
}

function derivedIdempotencyKey(input: RecordMemoryEventInput) {
  if (input.idempotencyKey?.trim()) return input.idempotencyKey.trim();
  const stableSource = input.sourceExternalId?.trim() || `${input.entityType}:${input.entityId}`;
  return [
    normalizeSourceType(input.sourceType),
    stableSource,
    input.eventType,
    input.entityType,
    input.entityId,
    hash(input.payload),
  ].join(":").slice(0, 500);
}

export function isRecoverableMemoryError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "P2021" || code === "P2022" || code === "P2003";
}

export async function ensureKnowledgeSource(
  input: EnsureKnowledgeSourceInput,
  db: MemoryDb = prisma,
) {
  const externalId = sourceExternalId(input.externalId);
  const type = normalizeSourceType(input.type);
  return db.knowledgeSource.upsert({
    where: {
      officeId_type_externalId: {
        officeId: input.officeId,
        type,
        externalId,
      },
    },
    update: {
      label: input.label ?? undefined,
      metadata: input.metadata ? toMemoryJson(input.metadata) : undefined,
      status: "ACTIVE",
    },
    create: {
      officeId: input.officeId,
      type,
      label: input.label ?? null,
      externalId,
      metadata: input.metadata ? toMemoryJson(input.metadata) : undefined,
    },
    select: { id: true, type: true, externalId: true },
  });
}

async function writeMemoryEvent(input: RecordMemoryEventInput) {
  const sourceType = normalizeSourceType(input.sourceType);
  const occurredAt = asDate(input.occurredAt);
  const idempotencyKey = derivedIdempotencyKey({ ...input, sourceType });
  const source = await ensureKnowledgeSource({
    officeId: input.officeId,
    type: sourceType,
    externalId: input.sourceExternalId,
    label: input.sourceLabel,
    metadata: input.sourceMetadata,
  });

  const data = {
    officeId: input.officeId,
    sourceId: source.id,
    objectId: input.objectId ?? null,
    sourceType,
    sourceExternalId: input.sourceExternalId ?? null,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    actorType: input.actorType ?? input.provenance.actorType ?? null,
    actorId: input.actorId ?? input.provenance.actorId ?? null,
    occurredAt,
    payloadVersion: input.payloadVersion ?? 1,
    payload: toMemoryJson(input.payload),
    provenance: toMemoryJson(input.provenance),
    idempotencyKey,
  };

  return prisma.memoryEvent.upsert({
    where: {
      officeId_idempotencyKey: {
        officeId: input.officeId,
        idempotencyKey,
      },
    },
    update: {
      sourceId: data.sourceId,
      objectId: data.objectId,
      sourceType: data.sourceType,
      sourceExternalId: data.sourceExternalId,
      eventType: data.eventType,
      entityType: data.entityType,
      entityId: data.entityId,
      actorType: data.actorType,
      actorId: data.actorId,
      occurredAt: data.occurredAt,
      payloadVersion: data.payloadVersion,
      payload: data.payload,
      provenance: data.provenance,
    },
    create: data,
    select: { id: true },
  });
}

export async function recordMemoryEvent(input: RecordMemoryEventInput): Promise<{ id: string } | null> {
  try {
    return await writeMemoryEvent(input);
  } catch (error) {
    if (input.strict || !isRecoverableMemoryError(error)) throw error;
    return null;
  }
}

export async function recordMemoryEventStrict(input: Omit<RecordMemoryEventInput, "strict">) {
  return recordMemoryEvent({ ...input, strict: true });
}
