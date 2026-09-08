import "server-only";

import { DEMO_EMAIL_THREAD_MARKER } from "@/lib/email-demo-markers";
import { UNROUTED_MAIL_THREAD_MARKER } from "@/lib/inbound-mail-routing";
import { hybridSearchMemory } from "@/lib/memory/hybrid-search";
import type { MemoryEvidenceRef } from "@/lib/memory/evidence";
import { prisma } from "@/lib/prisma";
import { hashSupplyStateValue } from "@/lib/supply-os/state-runtime/canonicalize";
import { recordSupplyStateMetric } from "@/lib/supply-os/state-runtime/instrumentation";
import {
  supplyStateWorkspaceId,
  type SupplyWorldEvidenceRef,
} from "@/lib/supply-os/state-runtime/types";
import {
  boundedText,
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  safeIso,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";

type CompanyBrainReaderDependencies = {
  search: typeof hybridSearchMemory;
  findObjects: typeof prisma.knowledgeObject.findMany;
  findChunks: typeof prisma.knowledgeChunk.findMany;
  findEvents: typeof prisma.memoryEvent.findMany;
  findEmailThreads: typeof prisma.emailThread.findMany;
};

const defaultDependencies: CompanyBrainReaderDependencies = {
  search: hybridSearchMemory,
  findObjects: (args) => prisma.knowledgeObject.findMany(args),
  findChunks: (args) => prisma.knowledgeChunk.findMany(args),
  findEvents: (args) => prisma.memoryEvent.findMany(args),
  findEmailThreads: (args) => prisma.emailThread.findMany(args),
};

function scopeFilters(input: SupplyStateReaderInput) {
  const scope = input.scope;
  return {
    companyId: scope.type === "company" || scope.type === "procurement_request" || scope.type === "item"
      ? scope.companyId
      : scope.type === "supplier" ? scope.companyId ?? null : null,
    workspaceId: scope.type === "workspace" || scope.type === "item"
      ? scope.workspaceId
      : "workspaceId" in scope ? scope.workspaceId ?? null : null,
    procurementOrderId: scope.type === "procurement_request"
      ? scope.orderId
      : scope.type === "supplier" ? scope.orderId ?? null : null,
    procurementVendorId: scope.type === "supplier" ? scope.vendorId ?? null : null,
    supplierKey: scope.type === "supplier" ? scope.supplierKey ?? null : null,
    itemId: scope.type === "item" ? scope.itemId ?? null : null,
    itemKey: scope.type === "item" ? scope.itemKey ?? null : null,
  };
}

function worldRefs(refs: MemoryEvidenceRef[]) {
  const output: SupplyWorldEvidenceRef[] = [];
  for (const ref of refs) {
    if (ref.knowledgeObjectId) output.push({ kind: "knowledge_object", id: ref.knowledgeObjectId });
    if (ref.knowledgeChunkId) output.push({ kind: "knowledge_chunk", id: ref.knowledgeChunkId });
    if (ref.memoryEventId) output.push({ kind: "memory_event", id: ref.memoryEventId });
  }
  return [...new Map(output.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()];
}

async function readCompanyBrainStateUninstrumented(
  input: SupplyStateReaderInput,
  dependencies: CompanyBrainReaderDependencies,
): Promise<SupplyStateReaderResult> {
  const result = emptySupplyStateReaderResult();
  const search = await dependencies.search({
    officeId: input.scope.officeId,
    query: boundedText(input.objective, 1_000),
    ...scopeFilters(input),
    limit: 12,
    includeChunks: true,
    includeEvents: true,
    // Compilation retrieves canonical history only. Feeding a prior derived
    // projection into its replacement would create a cache feedback loop.
    includeOperationalState: false,
  });
  const requestedThreadIds = [...new Set(search.results.flatMap((entry) => (
    entry.emailThreadId ? [entry.emailThreadId] : []
  )))];
  const emailThreads = requestedThreadIds.length ? await dependencies.findEmailThreads({
    where: { officeId: input.scope.officeId, id: { in: requestedThreadIds } },
    select: {
      id: true,
      companyId: true,
      hiddenAt: true,
      autoLinkSkipReason: true,
      messageCount: true,
      lastMessageAt: true,
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: 10,
        select: {
          id: true,
          externalId: true,
          gmailMessageId: true,
          direction: true,
        },
      },
    },
  }) : [];
  const expectedCompanyId = scopeFilters(input).companyId;
  const routedThreadById = new Map(emailThreads.flatMap((thread) => (
    thread.companyId
      && thread.hiddenAt === null
      && thread.autoLinkSkipReason !== UNROUTED_MAIL_THREAD_MARKER
      && thread.autoLinkSkipReason !== DEMO_EMAIL_THREAD_MARKER
      && (!expectedCompanyId || thread.companyId === expectedCompanyId)
      ? [[thread.id, thread] as const]
      : []
  )));
  const admittedResults = search.results.filter((entry) => (
    !entry.emailThreadId || routedThreadById.has(entry.emailThreadId)
  ));
  const refs = worldRefs(admittedResults.flatMap((entry) => entry.evidence));
  const objectIds = refs.filter((ref) => ref.kind === "knowledge_object").map((ref) => ref.id);
  const chunkIds = refs.filter((ref) => ref.kind === "knowledge_chunk").map((ref) => ref.id);
  const eventIds = refs.filter((ref) => ref.kind === "memory_event").map((ref) => ref.id);
  const [objects, chunks, events] = await Promise.all([
    objectIds.length ? dependencies.findObjects({
      where: { officeId: input.scope.officeId, id: { in: objectIds } },
      select: {
        id: true,
        contentHash: true,
        payloadVersion: true,
        sourceType: true,
        sourceExternalId: true,
        canonicalType: true,
        entityType: true,
        entityId: true,
        companyId: true,
        visibility: true,
        emailThreadId: true,
        emailMessageId: true,
        occurredAt: true,
        updatedAt: true,
      },
    }) : [],
    chunkIds.length ? dependencies.findChunks({
      where: { officeId: input.scope.officeId, id: { in: chunkIds } },
      select: {
        id: true,
        objectId: true,
        ordinal: true,
        kind: true,
        text: true,
        payloadVersion: true,
        updatedAt: true,
      },
    }) : [],
    eventIds.length ? dependencies.findEvents({
      where: { officeId: input.scope.officeId, id: { in: eventIds } },
      select: {
        id: true,
        objectId: true,
        sourceType: true,
        sourceExternalId: true,
        eventType: true,
        entityType: true,
        entityId: true,
        occurredAt: true,
        payloadVersion: true,
        payload: true,
      },
    }) : [],
  ]);
  const verifiedRefs = refs.filter((ref) => (
    (ref.kind === "knowledge_object" && objects.some((row) => row.id === ref.id))
    || (ref.kind === "knowledge_chunk" && chunks.some((row) => row.id === ref.id))
    || (ref.kind === "memory_event" && events.some((row) => row.id === ref.id))
  ));
  result.evidenceRefs.push(...verifiedRefs);
  for (const object of objects) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `company_brain.knowledge_object:${object.id}`,
      source: "COMPANY_BRAIN",
      entityType: "KnowledgeObject",
      entityRef: object.id,
      value: {
        contentHash: object.contentHash,
        payloadVersion: object.payloadVersion,
        sourceType: object.sourceType,
        sourceExternalId: object.sourceExternalId,
        canonicalType: object.canonicalType,
        entityType: object.entityType,
        entityId: object.entityId,
        companyId: object.companyId,
        visibility: object.visibility,
        emailThreadId: object.emailThreadId,
        emailMessageId: object.emailMessageId,
        occurredAt: safeIso(object.occurredAt),
      },
      version: object.contentHash ?? `${object.payloadVersion}`,
      policy: "ADVISORY",
      reason: "A Company Brain source object used as historical evidence changed.",
      evidenceRefs: [{ kind: "knowledge_object", id: object.id }],
    }));
  }
  for (const thread of routedThreadById.values()) {
    const newest = thread.messages[0] ?? null;
    const threadEvidence: SupplyWorldEvidenceRef[] = thread.messages.map((message) => ({
      kind: "email_message" as const,
      id: message.id,
      providerMessageId: message.externalId ?? message.gmailMessageId,
    }));
    result.dependencies.push(makeSupplyStateDependency({
      key: `email.thread:${thread.id}`,
      source: "EMAIL_LEDGER",
      entityType: "EmailThread",
      entityRef: thread.id,
      value: {
        companyId: thread.companyId,
        messageCount: thread.messageCount,
        latestMessageId: newest?.id ?? null,
        latestDirection: newest?.direction ?? null,
        lastMessageAt: safeIso(thread.lastMessageAt),
      },
      version: newest?.id ?? safeIso(thread.lastMessageAt),
      policy: "ADVISORY",
      reason: "The routed ownership or current message identity of historical email evidence changed.",
      evidenceRefs: threadEvidence,
    }));
    result.evidenceRefs.push(...threadEvidence);
  }
  for (const chunk of chunks) {
    const contentHash = hashSupplyStateValue(chunk.text);
    result.dependencies.push(makeSupplyStateDependency({
      key: `company_brain.knowledge_chunk:${chunk.id}`,
      source: "COMPANY_BRAIN",
      entityType: "KnowledgeChunk",
      entityRef: chunk.id,
      value: {
        objectId: chunk.objectId,
        ordinal: chunk.ordinal,
        kind: chunk.kind,
        contentHash,
        payloadVersion: chunk.payloadVersion,
      },
      version: contentHash,
      policy: "ADVISORY",
      reason: "A Company Brain text chunk used as historical evidence changed.",
      evidenceRefs: [{ kind: "knowledge_chunk", id: chunk.id }],
    }));
  }
  for (const event of events) {
    const payloadHash = hashSupplyStateValue(event.payload);
    result.dependencies.push(makeSupplyStateDependency({
      key: `company_brain.memory_event:${event.id}`,
      source: "COMPANY_BRAIN",
      entityType: "MemoryEvent",
      entityRef: event.id,
      value: {
        objectId: event.objectId,
        sourceType: event.sourceType,
        sourceExternalId: event.sourceExternalId,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        occurredAt: safeIso(event.occurredAt),
        payloadVersion: event.payloadVersion,
        payloadHash,
      },
      version: `${event.payloadVersion}:${payloadHash}`,
      policy: "ADVISORY",
      reason: "A Company Brain event used as historical evidence changed.",
      evidenceRefs: [{ kind: "memory_event", id: event.id }],
    }));
  }
  result.derivedState.companyBrainEvidence = admittedResults.slice(0, 12).map((entry) => ({
    kind: entry.kind,
    objectId: entry.objectId,
    chunkId: entry.chunkId,
    eventId: entry.eventId,
    sourceType: entry.sourceType,
    sourceExternalId: entry.sourceExternalId,
    canonicalType: entry.canonicalType,
    title: boundedText(entry.title, 500) || null,
    excerpt: boundedText(entry.excerpt, 1_200),
    occurredAt: safeIso(entry.occurredAt),
    entityType: entry.entityType,
    entityId: entry.entityId,
    emailThreadId: entry.emailThreadId ?? null,
    reasons: entry.reasons.slice(0, 8),
    evidence: worldRefs(entry.evidence),
  }));
  result.sourceCounts = {
    companyBrainResults: admittedResults.length,
    companyBrainSuppressedRoutingResults: search.results.length - admittedResults.length,
    routedEmailThreads: routedThreadById.size,
    knowledgeObjects: objects.length,
    knowledgeChunks: chunks.length,
    memoryEvents: events.length,
  };
  return result;
}

export async function readCompanyBrainState(
  input: SupplyStateReaderInput,
  dependencies: CompanyBrainReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  const startedAt = performance.now();
  let result: SupplyStateReaderResult | null = null;
  try {
    result = await readCompanyBrainStateUninstrumented(input, dependencies);
    return result;
  } finally {
    const elapsed = Math.max(0, performance.now() - startedAt);
    if (result) result.timingsMs.company_brain = elapsed;
    recordSupplyStateMetric("source_reader_ms", elapsed, {
      officeId: input.scope.officeId,
      workspaceId: supplyStateWorkspaceId(input.scope),
      scopeType: input.scope.type,
      source: "company_brain",
      compilerVersion: input.compilerVersion,
    });
  }
}
