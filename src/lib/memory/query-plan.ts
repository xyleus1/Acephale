import type {
  HybridMemorySearchInput,
  MemoryOperationalScope,
  MemoryRetrieverName,
} from "./retrievers/types";
import { MEMORY_VECTOR_SEARCH_FLAG, vectorMemoryRetrievalEnabled } from "./retrievers/vector";
import { supplyStateRuntimeConfig } from "../supply-os/state-runtime/config";

const MAX_RESULT_LIMIT = 75;
const MAX_CANDIDATE_LIMIT = 250;
export const MEMORY_RETRIEVAL_V2_FLAG = "MEMORY_RETRIEVAL_V2_ENABLED";

export function memoryRetrievalV2Enabled(
  environment: Record<string, string | undefined> = process.env as unknown as Record<string, string | undefined>,
) {
  return String(environment[MEMORY_RETRIEVAL_V2_FLAG] ?? "")
    .trim()
    .toLowerCase() === "true";
}

export type MemoryQueryPlan = {
  input: HybridMemorySearchInput;
  query: string | null;
  limit: number;
  candidateLimit: number;
  exactScope: MemoryOperationalScope & {
    companyId?: string | null;
    jobId?: string | null;
    inquiryId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  };
  scopeDiagnostics: {
    ignoredIncompleteScopes: string[];
  };
  retrievers: Record<MemoryRetrieverName, {
    enabled: boolean;
    reason?: string;
  }>;
};

function trimmed(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

export function clampMemorySearchLimit(limit: number | null | undefined, fallback = 20) {
  return Math.max(1, Math.min(MAX_RESULT_LIMIT, Math.floor(limit ?? fallback)));
}

export function exactMemoryScopeDiagnostics(input: HybridMemorySearchInput) {
  const ignoredIncompleteScopes: string[] = [];
  if (trimmed(input.supplierKey) && !trimmed(input.workspaceId)) {
    ignoredIncompleteScopes.push("supplierKey_requires_workspaceId");
  }
  if (trimmed(input.itemKey) && !trimmed(input.workspaceId)) {
    ignoredIncompleteScopes.push("itemKey_requires_workspaceId");
  }
  if (trimmed(input.procurementVendorId) && !trimmed(input.procurementOrderId)) {
    ignoredIncompleteScopes.push("procurementVendorId_requires_procurementOrderId");
  }
  if (trimmed(input.procurementOrderId)
    && !trimmed(input.companyId)
    && !trimmed(input.workspaceId)) {
    ignoredIncompleteScopes.push("procurementOrderId_requires_companyId_or_workspaceId");
  }
  return { ignoredIncompleteScopes };
}

export function hasExactMemoryScope(input: HybridMemorySearchInput) {
  const workspaceId = trimmed(input.workspaceId);
  const procurementOrderId = trimmed(input.procurementOrderId);
  const hasRequestOwner = Boolean(trimmed(input.companyId) || workspaceId);
  return Boolean(
    trimmed(input.companyId) ||
    trimmed(input.jobId) ||
    trimmed(input.inquiryId) ||
    (trimmed(input.entityType) && trimmed(input.entityId)) ||
    workspaceId ||
    (procurementOrderId && hasRequestOwner) ||
    (trimmed(input.procurementVendorId) && procurementOrderId && hasRequestOwner) ||
    (trimmed(input.supplierKey) && workspaceId) ||
    trimmed(input.itemId) ||
    (trimmed(input.itemKey) && workspaceId),
  );
}

export function hasOperationalMemoryScope(input: HybridMemorySearchInput) {
  const workspaceId = trimmed(input.workspaceId);
  const procurementOrderId = trimmed(input.procurementOrderId);
  const hasRequestOwner = Boolean(trimmed(input.companyId) || workspaceId);
  return Boolean(
    trimmed(input.companyId) ||
    workspaceId ||
    (procurementOrderId && hasRequestOwner) ||
    (trimmed(input.procurementVendorId) && procurementOrderId && hasRequestOwner) ||
    (trimmed(input.supplierKey) && workspaceId) ||
    trimmed(input.itemId) ||
    (trimmed(input.itemKey) && workspaceId),
  );
}

export function buildMemoryQueryPlan(input: HybridMemorySearchInput): MemoryQueryPlan {
  const officeId = trimmed(input.officeId);
  if (!officeId) throw new Error("Memory search requires officeId.");

  const normalizedInput: HybridMemorySearchInput = {
    ...input,
    officeId,
    query: trimmed(input.query),
    companyId: trimmed(input.companyId),
    jobId: trimmed(input.jobId),
    inquiryId: trimmed(input.inquiryId),
    entityType: trimmed(input.entityType),
    entityId: trimmed(input.entityId),
    workspaceId: trimmed(input.workspaceId),
    procurementOrderId: trimmed(input.procurementOrderId),
    procurementVendorId: trimmed(input.procurementVendorId),
    supplierKey: trimmed(input.supplierKey),
    itemId: trimmed(input.itemId),
    itemKey: trimmed(input.itemKey),
    strictReadErrors: input.strictReadErrors === true,
  };
  const limit = clampMemorySearchLimit(input.limit);
  const retrievalV2Enabled = memoryRetrievalV2Enabled();
  const vectorEnabled = retrievalV2Enabled && vectorMemoryRetrievalEnabled();
  const operationalStateEnabled = supplyStateRuntimeConfig().enabled;
  const hasOperationalScope = hasOperationalMemoryScope(normalizedInput);
  const scopeDiagnostics = exactMemoryScopeDiagnostics(normalizedInput);

  return {
    input: normalizedInput,
    query: normalizedInput.query ?? null,
    limit,
    candidateLimit: retrievalV2Enabled ? Math.min(MAX_CANDIDATE_LIMIT, Math.max(limit * 8, 25)) : limit,
    exactScope: {
      companyId: normalizedInput.companyId,
      jobId: normalizedInput.jobId,
      inquiryId: normalizedInput.inquiryId,
      entityType: normalizedInput.entityType,
      entityId: normalizedInput.entityId,
      workspaceId: normalizedInput.workspaceId,
      procurementOrderId: normalizedInput.procurementOrderId,
      procurementVendorId: normalizedInput.procurementVendorId,
      supplierKey: normalizedInput.supplierKey,
      itemId: normalizedInput.itemId,
      itemKey: normalizedInput.itemKey,
    },
    scopeDiagnostics,
    retrievers: {
      lexical: { enabled: true },
      operational_state: {
        enabled: retrievalV2Enabled && operationalStateEnabled
          && normalizedInput.includeOperationalState !== false && hasOperationalScope,
        ...(!retrievalV2Enabled
          ? { reason: `${MEMORY_RETRIEVAL_V2_FLAG}=false` }
          : normalizedInput.includeOperationalState === false
          ? { reason: "operational_state_disabled" }
          : !operationalStateEnabled
            ? { reason: "supply_state_runtime_disabled" }
            : !hasOperationalScope ? { reason: "no_operational_scope" } : {}),
      },
      entity: {
        enabled: retrievalV2Enabled && hasExactMemoryScope(normalizedInput),
        ...(!retrievalV2Enabled
          ? { reason: `${MEMORY_RETRIEVAL_V2_FLAG}=false` }
          : !hasExactMemoryScope(normalizedInput) ? { reason: "no_exact_scope" } : {}),
      },
      temporal: {
        enabled: retrievalV2Enabled && normalizedInput.includeEvents !== false,
        ...(!retrievalV2Enabled
          ? { reason: `${MEMORY_RETRIEVAL_V2_FLAG}=false` }
          : normalizedInput.includeEvents === false ? { reason: "events_disabled" } : {}),
      },
      vector: {
        enabled: vectorEnabled,
        ...(!vectorEnabled ? {
          reason: !retrievalV2Enabled
            ? `${MEMORY_RETRIEVAL_V2_FLAG}=false`
            : `${MEMORY_VECTOR_SEARCH_FLAG}=false`,
        } : {}),
      },
    },
  };
}
