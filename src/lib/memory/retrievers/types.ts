import type { MemoryEvidenceRef } from "../evidence";

export type MemorySearchDateRange = {
  from?: Date | string | null;
  to?: Date | string | null;
};

export type MemoryOperationalScope = {
  workspaceId?: string | null;
  procurementOrderId?: string | null;
  procurementVendorId?: string | null;
  supplierKey?: string | null;
  itemId?: string | null;
  itemKey?: string | null;
};

export function memoryOperationalScopeMetadata(input: MemoryOperationalScope) {
  return {
    workspaceId: input.workspaceId ?? null,
    procurementOrderId: input.procurementOrderId ?? null,
    procurementVendorId: input.procurementVendorId ?? null,
    supplierKey: input.supplierKey ?? null,
    itemId: input.itemId ?? null,
    itemKey: input.itemKey ?? null,
  };
}

export type HybridMemorySearchInput = MemoryOperationalScope & {
  officeId: string;
  query?: string | null;
  companyId?: string | null;
  jobId?: string | null;
  inquiryId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  canonicalTypes?: string[] | null;
  sourceTypes?: string[] | null;
  dateRange?: MemorySearchDateRange | null;
  limit?: number | null;
  includeEvents?: boolean;
  includeChunks?: boolean;
  includeOperationalState?: boolean;
  /** Preserve legacy empty-read fallback unless a measurement caller opts into hard failures. */
  strictReadErrors?: boolean;
};

export type HybridMemorySearchResult = {
  officeId: string;
  kind: "object" | "chunk" | "event" | "operational" | "projection";
  objectId: string | null;
  chunkId: string | null;
  eventId: string | null;
  sourceType: string | null;
  sourceExternalId: string | null;
  canonicalType: string | null;
  title: string | null;
  excerpt: string;
  score: number;
  occurredAt: Date;
  entityType: string | null;
  entityId: string | null;
  companyId: string | null;
  jobId: string | null;
  inquiryId: string | null;
  emailThreadId?: string | null;
  workspaceId?: string | null;
  procurementOrderId?: string | null;
  procurementVendorId?: string | null;
  supplierKey?: string | null;
  itemId?: string | null;
  itemKey?: string | null;
  reasons: string[];
  evidence: MemoryEvidenceRef[];
};

export type MemoryRetrieverName =
  | "lexical"
  | "operational_state"
  | "entity"
  | "temporal"
  | "vector";

export type RankedMemoryList = {
  retriever: MemoryRetrieverName;
  results: HybridMemorySearchResult[];
};

export type MemoryRetrievalDiagnostics = {
  version: 2;
  scopeWarnings: string[];
  retrievers: Record<MemoryRetrieverName, {
    enabled: boolean;
    resultCount: number;
    durationMs: number;
    reason?: string;
  }>;
  fusion: "reciprocal_rank_fusion" | "none";
  diversification: "email_thread_cap" | "none";
};
