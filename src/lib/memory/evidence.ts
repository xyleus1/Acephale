export type MemoryEvidenceRef = {
  refType: "knowledge_object" | "knowledge_chunk" | "memory_event" | "entity";
  knowledgeObjectId?: string | null;
  knowledgeChunkId?: string | null;
  memoryEventId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceType?: string | null;
  sourceExternalId?: string | null;
  canonicalType?: string | null;
  title?: string | null;
  occurredAt?: Date | string | null;
};

export type EvidenceBearingResult = {
  kind?: string;
  objectId?: string | null;
  chunkId?: string | null;
  eventId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceType?: string | null;
  sourceExternalId?: string | null;
  canonicalType?: string | null;
  title?: string | null;
  excerpt?: string | null;
  occurredAt?: Date | string | null;
  score?: number | null;
  evidence?: MemoryEvidenceRef[] | null;
};

function evidenceKey(ref: MemoryEvidenceRef) {
  return [
    ref.refType,
    ref.knowledgeObjectId ?? "",
    ref.knowledgeChunkId ?? "",
    ref.memoryEventId ?? "",
    ref.entityType ?? "",
    ref.entityId ?? "",
  ].join(":");
}

function dateLabel(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function buildEvidenceRefs(results: EvidenceBearingResult[]) {
  const refs: MemoryEvidenceRef[] = [];
  const seen = new Set<string>();

  const add = (ref: MemoryEvidenceRef) => {
    const key = evidenceKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const result of results) {
    for (const ref of result.evidence ?? []) add(ref);
    if (result.objectId) {
      add({
        refType: "knowledge_object",
        knowledgeObjectId: result.objectId,
        entityType: result.entityType ?? null,
        entityId: result.entityId ?? null,
        sourceType: result.sourceType ?? null,
        sourceExternalId: result.sourceExternalId ?? null,
        canonicalType: result.canonicalType ?? null,
        title: result.title ?? null,
        occurredAt: result.occurredAt ?? null,
      });
    }
    if (result.chunkId) {
      add({
        refType: "knowledge_chunk",
        knowledgeObjectId: result.objectId ?? null,
        knowledgeChunkId: result.chunkId,
        entityType: result.entityType ?? null,
        entityId: result.entityId ?? null,
        sourceType: result.sourceType ?? null,
        canonicalType: result.canonicalType ?? null,
        title: result.title ?? null,
        occurredAt: result.occurredAt ?? null,
      });
    }
    if (result.eventId) {
      add({
        refType: "memory_event",
        memoryEventId: result.eventId,
        knowledgeObjectId: result.objectId ?? null,
        entityType: result.entityType ?? null,
        entityId: result.entityId ?? null,
        sourceType: result.sourceType ?? null,
        sourceExternalId: result.sourceExternalId ?? null,
        title: result.title ?? null,
        occurredAt: result.occurredAt ?? null,
      });
    }
  }

  return refs;
}

export function formatEvidenceForAgent(results: EvidenceBearingResult[]) {
  const rows = results.slice(0, 12).map((result, index) => {
    const refs = buildEvidenceRefs([result]).slice(0, 4).map((ref) => {
      if (ref.refType === "memory_event") return `MemoryEvent:${ref.memoryEventId}`;
      if (ref.refType === "knowledge_chunk") return `KnowledgeChunk:${ref.knowledgeChunkId}`;
      if (ref.refType === "knowledge_object") return `KnowledgeObject:${ref.knowledgeObjectId}`;
      return `${ref.entityType}:${ref.entityId}`;
    });
    const label = result.title || result.eventId || result.objectId || "memory result";
    const type = [result.canonicalType, result.sourceType].filter(Boolean).join("/");
    const when = dateLabel(result.occurredAt);
    const score = result.score == null ? "" : ` score=${Math.round(result.score)}`;
    return `${index + 1}. ${label}${type ? ` (${type})` : ""}${when ? ` ${when}` : ""}${score}: ${result.excerpt ?? ""} [${refs.join(", ")}]`;
  });
  return rows.join("\n");
}

export function formatEvidenceForUser(results: EvidenceBearingResult[]) {
  return results.slice(0, 6).map((result) => {
    const label = result.title || result.canonicalType || result.sourceType || "memory";
    const when = dateLabel(result.occurredAt);
    const source = [result.sourceType, result.canonicalType].filter(Boolean).join(" ");
    return [label, source ? `(${source})` : "", when ? `on ${when}` : ""].filter(Boolean).join(" ");
  });
}
