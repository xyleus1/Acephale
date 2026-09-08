import "server-only";

import { autopilotRequestStage } from "@/lib/procurement-autopilot-plan";
import { procurementReplyFacts, triageSupplierInbound } from "@/lib/procurement-inbound-triage";
import { assembleCompanyContextForAgent } from "@/lib/company-context";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import {
  getProcurementRequest,
  getProcurementWorkflowAccount,
  procurementOfficeIdFromServerMetadata,
  type ProcurementOrderDetail,
  type ProcurementOrderVendor,
  type ProcurementWorkflowAccountLookup,
} from "@/lib/procurement-workflow";
import { prisma } from "@/lib/prisma";
import { buildProcurementCompanyContextSnapshot } from "@/lib/supply-os/procurement-company-context";
import { normalizeItemIdentityValue } from "./readers/item-identity";
import {
  canonicalizeSupplyStateValue,
  hashSupplyStateValue,
  type CanonicalSupplyStateValue,
} from "./canonicalize";
import {
  boundedSemanticValue,
  canonicalItemIdentityValue,
  companyIdentityValue,
  companySupplierRelationshipValue,
  currentSnapshotFactValue,
  effectiveDecisionProposalHash,
  equivalenceRuleListValue,
  executionControlListValue,
  executionEventListValue,
  planningMentionsItem,
  planningResultListValue,
  procurementConversationMessageState,
  routedCompanyThreadListValue,
  snapshotSourceHash,
  supplierEvidenceListValue,
  supplierProfileIdentityValue,
  supplierProfileResearchValue,
  workspaceIdentityValue,
  workspacePresentationValue,
} from "./readers/selectors";
import type {
  SupplyStateDependency,
  SupplyStateSource,
  SupplyWorldEvidenceRef,
} from "./types";

const PROCUREMENT_REPLY_DRAFT_TASK_TYPE = "PROCUREMENT_SUPPLIER_REPLY_DRAFT";
const UNROUTED_MAIL_THREAD_MARKER = "UNROUTED_SHARED_MAILBOX";
const MAX_FACT_KEY_CHARS = 2_000;
const MAX_FACT_EVIDENCE = 240;

type SupplyStateDatabase = typeof prisma;
type SupplyConversationReader = typeof import("@/lib/procurement-conversation")["procurementVendorConversation"];

export type SupplyStateFactReadContext = {
  officeId: string;
  cache?: Map<string, Promise<unknown>>;
};

export type SupplyStateFactValue = {
  exists: boolean;
  entityType: string;
  entityRef: string;
  value: unknown;
  version?: string | null;
  evidenceRefs?: SupplyWorldEvidenceRef[];
};

export type SupplyStateFactRegistryEntry = {
  prefix: string;
  source: SupplyStateSource;
  readCurrent: (
    context: SupplyStateFactReadContext,
    key: string,
    suffix: string,
  ) => Promise<SupplyStateFactValue>;
  canonicalize: (value: unknown) => CanonicalSupplyStateValue;
  hash: (value: unknown) => string;
  evidence: (value: SupplyStateFactValue) => SupplyWorldEvidenceRef[];
  defaultPolicy: SupplyStateDependency["policy"];
};

export type CurrentSupplyStateFact = SupplyStateFactValue & {
  key: string;
  source: SupplyStateSource;
  canonicalValue: CanonicalSupplyStateValue;
  valueHash: string;
  resolvedVersion: string;
  evidenceRefs: SupplyWorldEvidenceRef[];
};

export type SupplyStateFactRegistryDependencies = {
  appDb?: SupplyStateDatabase;
  getProcurementRequest?: typeof getProcurementRequest;
  getWorkflowAccount?: ProcurementWorkflowAccountLookup;
  resolveWorkflowOffice?: typeof procurementOfficeIdFromServerMetadata;
  getProcurementConversation?: SupplyConversationReader;
  assembleCompanyContext?: typeof assembleCompanyContextForAgent;
  resolveCompanyContextAccess?: typeof procurementOperatorAccess;
};

export class SupplyStateFactRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_key" | "unsupported_fact" | "source_unavailable",
  ) {
    super(message);
    this.name = "SupplyStateFactRegistryError";
  }
}

export class SupplyStateFactRegistry {
  readonly #entries = new Map<string, SupplyStateFactRegistryEntry>();

  constructor(entries: SupplyStateFactRegistryEntry[] = []) {
    for (const entry of entries) this.register(entry);
  }

  register(entry: SupplyStateFactRegistryEntry, options: { replace?: boolean } = {}) {
    validateEntry(entry);
    if (this.#entries.has(entry.prefix) && !options.replace) {
      throw new SupplyStateFactRegistryError(
        `Supply state fact prefix ${entry.prefix} is already registered.`,
        "invalid_key",
      );
    }
    this.#entries.set(entry.prefix, entry);
    return this;
  }

  resolve(key: string) {
    validateFactKey(key);
    const entry = [...this.#entries.values()]
      .filter((candidate) => key.startsWith(candidate.prefix))
      .sort((left, right) => right.prefix.length - left.prefix.length)[0];
    if (!entry) {
      throw new SupplyStateFactRegistryError(`Supply state fact ${key} is not registered.`, "unsupported_fact");
    }
    const suffix = key.slice(entry.prefix.length);
    if (!suffix) {
      throw new SupplyStateFactRegistryError(`Supply state fact ${key} is incomplete.`, "invalid_key");
    }
    return { entry, suffix };
  }

  entries() {
    return [...this.#entries.values()].sort((left, right) => left.prefix.localeCompare(right.prefix));
  }
}

function validateEntry(entry: SupplyStateFactRegistryEntry) {
  if (!entry.prefix || entry.prefix.length > 200 || !entry.prefix.endsWith(":")) {
    throw new SupplyStateFactRegistryError("Supply state fact prefixes must be bounded and end with a colon.", "invalid_key");
  }
}

function validateFactKey(key: string) {
  if (!key.trim() || key.length > MAX_FACT_KEY_CHARS || /[\r\n\0]/.test(key)) {
    throw new SupplyStateFactRegistryError("Supply state fact key is invalid.", "invalid_key");
  }
}

function evidenceKey(reference: SupplyWorldEvidenceRef) {
  return `${reference.kind}:${reference.id}`;
}

function dedupeEvidence(references: SupplyWorldEvidenceRef[] = []) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    if (!reference.id || reference.id.length > 1_000) return false;
    const key = evidenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_FACT_EVIDENCE);
}

function defineEntry(args: Pick<
  SupplyStateFactRegistryEntry,
  "prefix" | "source" | "readCurrent" | "defaultPolicy"
>): SupplyStateFactRegistryEntry {
  return {
    ...args,
    canonicalize: canonicalizeSupplyStateValue,
    hash: hashSupplyStateValue,
    evidence: (value) => dedupeEvidence(value.evidenceRefs),
  };
}

function missingFact(entityType: string, entityRef: string): SupplyStateFactValue {
  return { exists: false, entityType, entityRef, value: null, evidenceRefs: [] };
}

function cacheRead<T>(
  context: SupplyStateFactReadContext,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!context.cache) return operation();
  const existing = context.cache.get(key);
  if (existing) return existing as Promise<T>;
  const pending = operation();
  context.cache.set(key, pending as Promise<unknown>);
  return pending;
}

function segments(suffix: string, count: number) {
  const values = suffix.split(":");
  if (values.length !== count || values.some((value) => !value)) {
    throw new SupplyStateFactRegistryError("Supply state fact key has invalid segments.", "invalid_key");
  }
  return values;
}

function decodedSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.trim()) throw new Error("empty");
    return decoded;
  } catch {
    throw new SupplyStateFactRegistryError("Supply state fact key contains invalid encoding.", "invalid_key");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function messageRole(payload: unknown, portalUserId: string | null) {
  return asRecord(payload).role === "AGENT" ? "AGENT" : portalUserId ? "CUSTOMER" : "OPERATOR";
}

function requestWorkspaceId(order: ProcurementOrderDetail) {
  const source = asRecord(asRecord(order.requestContext).source);
  return typeof source.workspace_id === "string" && source.workspace_id.trim()
    ? source.workspace_id.trim()
    : null;
}

function selectedRequestContext(requestContext: Record<string, unknown>) {
  return boundedSemanticValue({
    source: requestContext.source ?? null,
    procurementContext: requestContext.procurement_context ?? null,
    companyContext: requestContext.company_context ?? null,
    logistics: requestContext.logistics ?? null,
  }, { maxArray: 50, maxString: 8_000 });
}

function requestDocumentIds(requestContext: Record<string, unknown>) {
  const ids = new Set<string>();
  for (const context of [asRecord(requestContext.procurement_context), asRecord(requestContext.company_context)]) {
    if (!Array.isArray(context.documents)) continue;
    for (const entry of context.documents) {
      const citation = asRecord(entry).citation_id;
      if (typeof citation === "string" && citation.startsWith("document:") && citation.length > 9) {
        ids.add(citation.slice("document:".length));
      }
    }
  }
  return [...ids].sort().slice(0, 50);
}

function orderFactValue(order: ProcurementOrderDetail) {
  return {
    id: order.id,
    status: order.status,
    neededBy: order.neededBy,
    quantity: order.quantity,
    unit: order.unit,
    material: order.material,
    specification: order.specification,
  };
}

function orderDecisionStateValue(order: ProcurementOrderDetail) {
  return {
    progress: order.progress,
    approvalRequestedAt: order.approvalRequestedAt,
    decisionSnapshot: boundedSemanticValue(order.decisionSnapshot, { maxArray: 30, maxString: 2_000 }),
  };
}

function vendorIdentityValue(vendor: ProcurementOrderVendor) {
  return {
    id: vendor.id,
    supplierRegistryId: vendor.supplierRegistryId,
    name: vendor.name,
    website: vendor.website,
    contact: vendor.contact,
    status: vendor.status,
    contacted: vendor.contacted,
  };
}

function assertWorkflowTenant(
  context: SupplyStateFactReadContext,
  customerId: string,
  resolveOffice: typeof procurementOfficeIdFromServerMetadata,
) {
  if (resolveOffice(customerId) !== context.officeId) {
    throw new SupplyStateFactRegistryError("Workflow fact is outside the requested office.", "invalid_key");
  }
}

function workflowOrder(
  context: SupplyStateFactReadContext,
  customerId: string,
  orderId: string,
  dependencies: Required<Pick<SupplyStateFactRegistryDependencies, "getProcurementRequest" | "resolveWorkflowOffice">>,
) {
  assertWorkflowTenant(context, customerId, dependencies.resolveWorkflowOffice);
  return cacheRead(context, `workflow-order:${customerId}:${orderId}`, () => (
    dependencies.getProcurementRequest(customerId, orderId)
  ));
}

function workflowConversation(
  context: SupplyStateFactReadContext,
  customerId: string,
  orderId: string,
  vendorId: string,
  dependencies: Required<Pick<SupplyStateFactRegistryDependencies, "getProcurementConversation">>,
) {
  return cacheRead(context, `workflow-conversation:${customerId}:${orderId}:${vendorId}`, () => (
    dependencies.getProcurementConversation({ officeId: context.officeId, customerId, orderId, vendorId })
  ));
}

function companyEntries(appDb: SupplyStateDatabase) {
  return [
    defineEntry({
      prefix: "company.identity:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, companyId) => {
        const company = await appDb.company.findFirst({
          where: { id: companyId, officeId: context.officeId },
          select: {
            id: true,
            name: true,
            status: true,
          },
        });
        const value = companyIdentityValue(company);
        return company ? {
          exists: true,
          entityType: "Company",
          entityRef: company.id,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        } : missingFact("Company", companyId);
      },
    }),
    defineEntry({
      prefix: "item.identity:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [companyId, itemId] = segments(suffix, 2);
        const item = await appDb.item.findFirst({
          where: { id: itemId, officeId: context.officeId, companyId },
          select: {
            id: true,
            companyId: true,
            name: true,
            sku: true,
            specification: true,
            manufacturer: true,
            partNumber: true,
            unit: true,
          },
        });
        const value = canonicalItemIdentityValue(item);
        return item ? {
          exists: true,
          entityType: "Item",
          entityRef: item.id,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        } : missingFact("Item", itemId);
      },
    }),
    defineEntry({
      prefix: "item.approved_alias_mapping:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, companyId, itemId, encodedItemKey] = segments(suffix, 4);
        const itemKey = decodedSegment(encodedItemKey!);
        const item = await appDb.item.findFirst({
          where: { id: itemId, officeId: context.officeId, companyId },
          select: { id: true, name: true, sku: true, partNumber: true },
        });
        if (!item) return missingFact("SupplyItemAlias", `${workspaceId}:${itemId}:${itemKey}`);
        const normalizedValues = [...new Set([
          normalizeItemIdentityValue(item.sku),
          normalizeItemIdentityValue(item.partNumber),
          normalizeItemIdentityValue(item.name),
        ].filter(Boolean))];
        const alias = normalizedValues.length ? await appDb.supplyItemAlias.findFirst({
          where: {
            officeId: context.officeId,
            workspaceId,
            canonicalItemKey: itemKey,
            normalizedValue: { in: normalizedValues },
            isActive: true,
            approvedAt: { not: null },
          },
          select: { id: true },
        }) : null;
        if (!alias) return missingFact("SupplyItemAlias", `${workspaceId}:${itemId}:${itemKey}`);
        const value = { canonicalItemId: item.id, itemKey, method: "APPROVED_ALIAS" };
        return {
          exists: true,
          entityType: "SupplyItemAlias",
          entityRef: `${workspaceId}:${item.id}:${itemKey}`,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        };
      },
    }),
  ];
}

function companyContextEntries(dependencies: {
  appDb: SupplyStateDatabase;
  assembleCompanyContext: typeof assembleCompanyContextForAgent;
  resolveCompanyContextAccess: typeof procurementOperatorAccess;
}) {
  return [
    defineEntry({
      prefix: "company.context_workspaces:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, companyId) => {
        const rows = await dependencies.appDb.supplyWorkspace.findMany({
          where: { officeId: context.officeId, companyId, status: "ACTIVE" },
          orderBy: [{ id: "asc" }],
          take: 50,
          select: {
            id: true,
            companyId: true,
            externalKey: true,
            name: true,
            status: true,
            version: true,
            archivedAt: true,
          },
        });
        const value = rows.map(workspaceIdentityValue);
        return {
          exists: true,
          entityType: "SupplyWorkspaceList",
          entityRef: companyId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "company.context_version:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [companyId, workspaceId] = segments(suffix, 2);
        const workspace = await dependencies.appDb.supplyWorkspace.findFirst({
          where: { id: workspaceId, officeId: context.officeId, companyId, status: "ACTIVE" },
          select: { id: true, companyId: true },
        });
        if (!workspace?.companyId) return missingFact("CompanyContext", `${companyId}:${workspaceId}`);
        const access = await dependencies.resolveCompanyContextAccess(context.officeId);
        const assembled = await dependencies.assembleCompanyContext(access, workspace.id);
        if (assembled.company.id !== companyId) {
          throw new SupplyStateFactRegistryError("Company Context resolved outside the requested company.", "source_unavailable");
        }
        const snapshot = buildProcurementCompanyContextSnapshot(assembled);
        const rows = await dependencies.appDb.companyContext.findMany({
          where: { officeId: context.officeId, companyId, kind: { in: ["DOCUMENT", "MESSAGE"] } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 240,
          select: {
            id: true,
            kind: true,
            itemId: true,
            contentHash: true,
            processingState: true,
            payload: true,
            createdByPortalUserId: true,
          },
        });
        const documentIds = new Set((snapshot?.documents ?? []).flatMap((document) => (
          document.citation_id.startsWith("document:")
            ? [document.citation_id.slice("document:".length)]
            : []
        )));
        const messageIds = new Set((snapshot?.operator_messages ?? []).flatMap((message) => (
          message.citation_id.startsWith("message:")
            ? [message.citation_id.slice("message:".length)]
            : []
        )));
        const selectedRows = rows.filter((row) => (
          (row.kind === "DOCUMENT" && documentIds.has(row.id))
          || (row.kind === "MESSAGE" && messageIds.has(row.id)
            && messageRole(row.payload, row.createdByPortalUserId) !== "AGENT")
        ));
        const value = selectedRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          itemId: row.itemId,
          contentHash: row.contentHash,
          processingState: row.processingState,
        }));
        return {
          exists: true,
          entityType: "CompanyContext",
          entityRef: `${companyId}:${workspaceId}`,
          value,
          version: snapshot?.version ?? hashSupplyStateValue(value),
          evidenceRefs: selectedRows.map((row) => ({
            kind: "company_context" as const,
            id: row.id,
            contentHash: row.contentHash,
          })),
        };
      },
    }),
    defineEntry({
      prefix: "company.context_document:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [companyId, documentId] = segments(suffix, 2);
        const row = await dependencies.appDb.companyContext.findFirst({
          where: {
            id: documentId!,
            officeId: context.officeId,
            companyId,
            kind: "DOCUMENT",
          },
          select: { id: true, contentHash: true, processingState: true },
        });
        if (!row) return missingFact("CompanyContext", documentId!);
        return {
          exists: true,
          entityType: "CompanyContext",
          entityRef: row.id,
          value: { contentHash: row.contentHash, processingState: row.processingState },
          version: row.contentHash,
          evidenceRefs: [{ kind: "company_context", id: row.id, contentHash: row.contentHash }],
        };
      },
    }),
    defineEntry({
      prefix: "company.context_message:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [companyId, messageId] = segments(suffix, 2);
        const row = await dependencies.appDb.companyContext.findFirst({
          where: { id: messageId, officeId: context.officeId, companyId, kind: "MESSAGE" },
          select: {
            id: true,
            contentHash: true,
            markdown: true,
            payload: true,
            createdByPortalUserId: true,
          },
        });
        if (!row || messageRole(row.payload, row.createdByPortalUserId) === "AGENT") {
          return missingFact("CompanyContext", messageId);
        }
        const value = {
          role: messageRole(row.payload, row.createdByPortalUserId),
          markdown: row.markdown,
        };
        return {
          exists: true,
          entityType: "CompanyContext",
          entityRef: row.id,
          value,
          version: row.contentHash,
          evidenceRefs: [{
            kind: "company_context",
            id: row.id,
            contentHash: row.contentHash ?? hashSupplyStateValue(value),
          }],
        };
      },
    }),
  ];
}

function snapshotEntries(appDb: SupplyStateDatabase) {
  return [
    defineEntry({
      prefix: "workspace.identity:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, workspaceId) => {
        const workspace = await appDb.supplyWorkspace.findFirst({
          where: { id: workspaceId, officeId: context.officeId, status: "ACTIVE" },
          select: {
            id: true,
            companyId: true,
            externalKey: true,
            name: true,
            status: true,
            version: true,
            archivedAt: true,
          },
        });
        const value = workspaceIdentityValue(workspace);
        return workspace ? {
          exists: true,
          entityType: "SupplyWorkspace",
          entityRef: workspaceId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        } : missingFact("SupplyWorkspace", workspaceId);
      },
    }),
    defineEntry({
      prefix: "workspace.presentation:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, workspaceId) => {
        const workspace = await appDb.supplyWorkspace.findFirst({
          where: { id: workspaceId, officeId: context.officeId, status: "ACTIVE" },
          select: {
            id: true,
            companyId: true,
            externalKey: true,
            name: true,
            status: true,
            version: true,
            archivedAt: true,
          },
        });
        const value = workspacePresentationValue(workspace);
        return workspace ? {
          exists: true,
          entityType: "SupplyWorkspace",
          entityRef: workspaceId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        } : missingFact("SupplyWorkspace", workspaceId);
      },
    }),
    defineEntry({
      prefix: "workspace.current_snapshot:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, workspaceId) => {
        const snapshot = await appDb.supplySnapshot.findFirst({
          where: { officeId: context.officeId, workspaceId, status: "PUBLISHED" },
          orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            version: true,
            schemaVersion: true,
            sourceHash: true,
            publishedAt: true,
          },
        });
        if (!snapshot) return missingFact("SupplySnapshot", workspaceId);
        const sourceHash = snapshotSourceHash(snapshot);
        return {
          exists: true,
          entityType: "SupplySnapshot",
          entityRef: workspaceId,
          value: currentSnapshotFactValue(snapshot),
          version: snapshot.id,
          evidenceRefs: [{ kind: "supply_snapshot", id: snapshot.id, sourceHash }],
        };
      },
    }),
    defineEntry({
      prefix: "workspace.snapshot_hash:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, snapshotId) => {
        const snapshot = await appDb.supplySnapshot.findFirst({
          where: { id: snapshotId, officeId: context.officeId, status: "PUBLISHED" },
          select: {
            id: true,
            version: true,
            schemaVersion: true,
            sourceHash: true,
            publishedAt: true,
          },
        });
        if (!snapshot) return missingFact("SupplySnapshot", snapshotId);
        const sourceHash = snapshotSourceHash(snapshot);
        return {
          exists: true,
          entityType: "SupplySnapshot",
          entityRef: snapshot.id,
          value: { sourceHash, schemaVersion: snapshot.schemaVersion },
          version: sourceHash,
          evidenceRefs: [{ kind: "supply_snapshot", id: snapshot.id, sourceHash }],
        };
      },
    }),
    defineEntry({
      prefix: "workspace.equivalence_rules:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, workspaceId) => {
        const rows = await appDb.supplyEquivalenceRule.findMany({
          where: { officeId: context.officeId, workspaceId },
          orderBy: [{ ruleKey: "asc" }, { version: "desc" }],
          take: 80,
          select: {
            id: true,
            ruleKey: true,
            version: true,
            fromItemKey: true,
            toItemKey: true,
            action: true,
            status: true,
            ruleHash: true,
            approvedAt: true,
          },
        });
        const latest = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
          if (latest.size >= 40) break;
          if (!latest.has(row.ruleKey)) latest.set(row.ruleKey, row);
        }
        const value = equivalenceRuleListValue([...latest.values()]);
        return {
          exists: true,
          entityType: "SupplyEquivalenceRuleList",
          entityRef: workspaceId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "workspace.equivalence_rule:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedRuleKey] = segments(suffix, 2);
        const ruleKey = decodedSegment(encodedRuleKey!);
        const rule = await appDb.supplyEquivalenceRule.findFirst({
          where: { officeId: context.officeId, workspaceId, ruleKey },
          orderBy: [{ version: "desc" }, { id: "desc" }],
          select: { id: true, ruleHash: true, status: true },
        });
        if (!rule) return missingFact("SupplyEquivalenceRule", `${workspaceId}:${ruleKey}`);
        return {
          exists: true,
          entityType: "SupplyEquivalenceRule",
          entityRef: rule.id,
          value: { ruleHash: rule.ruleHash, status: rule.status },
          version: rule.ruleHash,
          evidenceRefs: [],
        };
      },
    }),
  ];
}

function planningAndExecutionEntries(appDb: SupplyStateDatabase) {
  return [
    defineEntry({
      prefix: "planning.latest_results:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, workspaceId) => {
        const rows = await appDb.supplyPlanningResult.findMany({
          where: { officeId: context.officeId, workspaceId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 10,
          select: {
            id: true,
            snapshotId: true,
            engineVersion: true,
            snapshotHash: true,
            normalizedInputHash: true,
            outputHash: true,
            createdAt: true,
          },
        });
        const value = planningResultListValue(rows);
        return {
          exists: true,
          entityType: "SupplyPlanningResultList",
          entityRef: workspaceId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: rows.map((row) => ({
            kind: "planning_result" as const,
            id: row.id,
            outputHash: row.outputHash,
          })),
        };
      },
    }),
    defineEntry({
      prefix: "item.planning_results:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedItemKey] = segments(suffix, 2);
        const itemKey = decodedSegment(encodedItemKey!);
        const snapshot = await appDb.supplySnapshot.findFirst({
          where: { officeId: context.officeId, workspaceId, status: "PUBLISHED" },
          orderBy: [{ version: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (!snapshot) {
          const value = planningResultListValue([]);
          return {
            exists: true,
            entityType: "SupplyPlanningResultList",
            entityRef: `${workspaceId}:${itemKey}`,
            value,
            version: hashSupplyStateValue(value),
            evidenceRefs: [],
          };
        }
        const rows = await appDb.supplyPlanningResult.findMany({
          where: { officeId: context.officeId, workspaceId, snapshotId: snapshot.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20,
          select: {
            id: true,
            snapshotId: true,
            engineVersion: true,
            snapshotHash: true,
            normalizedInputHash: true,
            outputHash: true,
            output: true,
            createdAt: true,
          },
        });
        const selected = rows.filter((row) => planningMentionsItem(row.output, itemKey)).slice(0, 5);
        const value = planningResultListValue(selected);
        return {
          exists: true,
          entityType: "SupplyPlanningResultList",
          entityRef: `${workspaceId}:${itemKey}`,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: selected.map((row) => ({
            kind: "planning_result" as const,
            id: row.id,
            outputHash: row.outputHash,
          })),
        };
      },
    }),
    defineEntry({
      prefix: "item.equivalence_rules:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedItemKey] = segments(suffix, 2);
        const itemKey = decodedSegment(encodedItemKey!);
        const rows = await appDb.supplyEquivalenceRule.findMany({
          where: {
            officeId: context.officeId,
            workspaceId,
            OR: [{ fromItemKey: itemKey }, { toItemKey: itemKey }],
          },
          orderBy: [{ ruleKey: "asc" }, { version: "desc" }],
          take: 100,
          select: {
            id: true,
            ruleKey: true,
            version: true,
            fromItemKey: true,
            toItemKey: true,
            action: true,
            status: true,
            ruleHash: true,
            approvedAt: true,
          },
        });
        const latest = new Map<string, (typeof rows)[number]>();
        for (const row of rows) if (!latest.has(row.ruleKey)) latest.set(row.ruleKey, row);
        const value = equivalenceRuleListValue([...latest.values()]);
        return {
          exists: true,
          entityType: "SupplyEquivalenceRuleList",
          entityRef: `${workspaceId}:${itemKey}`,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "execution.controls:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, workspaceId) => {
        const [decisions, approvals, tasks] = await Promise.all([
          appDb.supplyDecision.findMany({
            where: { officeId: context.officeId, workspaceId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 12,
            select: {
              id: true,
              proposal: true,
              proposalHash: true,
              status: true,
              snapshotId: true,
              finalizedAt: true,
            },
          }),
          appDb.supplyApproval.findMany({
            where: { officeId: context.officeId, workspaceId },
            orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
            take: 20,
            select: {
              id: true,
              scopeHash: true,
              status: true,
              requiredRole: true,
              decisionId: true,
              executionTaskId: true,
              expiresAt: true,
              decidedAt: true,
            },
          }),
          appDb.supplyExecutionTask.findMany({
            where: { officeId: context.officeId, workspaceId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 15,
            select: {
              id: true,
              inputHash: true,
              status: true,
              decisionId: true,
              snapshotId: true,
              requiresApproval: true,
              resultHash: true,
              externalSystem: true,
              externalRef: true,
              scheduledFor: true,
              startedAt: true,
              completedAt: true,
              failedAt: true,
              cancelledAt: true,
            },
          }),
        ]);
        const value = executionControlListValue({ decisions, approvals, tasks });
        return {
          exists: true,
          entityType: "SupplyExecutionControlList",
          entityRef: workspaceId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [
            ...decisions.map((row) => ({
              kind: "supply_decision" as const,
              id: row.id,
              proposalHash: effectiveDecisionProposalHash(row),
            })),
            ...tasks.map((row) => ({ kind: "execution_task" as const, id: row.id, inputHash: row.inputHash })),
          ],
        };
      },
    }),
    defineEntry({
      prefix: "execution.events:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, workspaceId) => {
        const tasks = await appDb.supplyExecutionTask.findMany({
          where: { officeId: context.officeId, workspaceId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 15,
          select: {
            id: true,
            events: {
              orderBy: [{ sequence: "desc" }],
              take: 3,
              select: {
                id: true,
                sequence: true,
                eventType: true,
                status: true,
                payloadHash: true,
                occurredAt: true,
              },
            },
          },
        });
        const rows = tasks.flatMap((task) => task.events.map((event) => ({
          ...event,
          executionTaskId: task.id,
        })));
        const value = executionEventListValue(rows);
        return {
          exists: true,
          entityType: "SupplyExecutionEventList",
          entityRef: workspaceId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: value.map((row) => ({
            kind: "execution_event" as const,
            id: row.id,
            payloadHash: row.payloadHash,
          })),
        };
      },
    }),
    defineEntry({
      prefix: "planning.result:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, planningResultId) => {
        const row = await appDb.supplyPlanningResult.findFirst({
          where: { id: planningResultId, officeId: context.officeId },
          select: { id: true, outputHash: true, snapshotHash: true, normalizedInputHash: true },
        });
        if (!row) return missingFact("SupplyPlanningResult", planningResultId);
        return {
          exists: true,
          entityType: "SupplyPlanningResult",
          entityRef: row.id,
          value: {
            outputHash: row.outputHash,
            snapshotHash: row.snapshotHash,
            normalizedInputHash: row.normalizedInputHash,
          },
          version: row.outputHash,
          evidenceRefs: [{ kind: "planning_result", id: row.id, outputHash: row.outputHash }],
        };
      },
    }),
    defineEntry({
      prefix: "decision.proposal:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, decisionId) => {
        const row = await appDb.supplyDecision.findFirst({
          where: { id: decisionId, officeId: context.officeId },
          select: { id: true, proposal: true, proposalHash: true, status: true, snapshotId: true },
        });
        if (!row) return missingFact("SupplyDecision", decisionId);
        const proposalHash = effectiveDecisionProposalHash(row);
        return {
          exists: true,
          entityType: "SupplyDecision",
          entityRef: row.id,
          value: { proposalHash, status: row.status, snapshotId: row.snapshotId },
          version: proposalHash,
          evidenceRefs: [{ kind: "supply_decision", id: row.id, proposalHash }],
        };
      },
    }),
    defineEntry({
      prefix: "approval.scope:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, approvalId) => {
        const row = await appDb.supplyApproval.findFirst({
          where: { id: approvalId, officeId: context.officeId },
          select: {
            id: true,
            scopeHash: true,
            status: true,
            requiredRole: true,
            decisionId: true,
            executionTaskId: true,
            expiresAt: true,
          },
        });
        if (!row) return missingFact("SupplyApproval", approvalId);
        return {
          exists: true,
          entityType: "SupplyApproval",
          entityRef: row.id,
          value: {
            scopeHash: row.scopeHash,
            status: row.status,
            requiredRole: row.requiredRole,
            decisionId: row.decisionId,
            executionTaskId: row.executionTaskId,
            expiresAt: safeIso(row.expiresAt),
          },
          version: row.scopeHash,
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "execution.task:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, taskId) => {
        const row = await appDb.supplyExecutionTask.findFirst({
          where: { id: taskId, officeId: context.officeId },
          select: {
            id: true,
            inputHash: true,
            status: true,
            decisionId: true,
            snapshotId: true,
            requiresApproval: true,
          },
        });
        if (!row) return missingFact("SupplyExecutionTask", taskId);
        return {
          exists: true,
          entityType: "SupplyExecutionTask",
          entityRef: row.id,
          value: {
            inputHash: row.inputHash,
            status: row.status,
            decisionId: row.decisionId,
            snapshotId: row.snapshotId,
            requiresApproval: row.requiresApproval,
          },
          version: row.inputHash,
          evidenceRefs: [{ kind: "execution_task", id: row.id, inputHash: row.inputHash }],
        };
      },
    }),
    defineEntry({
      prefix: "execution.event:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, eventId) => {
        const row = await appDb.supplyExecutionEvent.findFirst({
          where: { id: eventId, officeId: context.officeId },
          select: {
            id: true,
            sequence: true,
            eventType: true,
            status: true,
            payloadHash: true,
            occurredAt: true,
          },
        });
        if (!row) return missingFact("SupplyExecutionEvent", eventId);
        const payloadHash = row.payloadHash ?? hashSupplyStateValue({
          sequence: row.sequence,
          eventType: row.eventType,
          status: row.status,
          occurredAt: safeIso(row.occurredAt),
        });
        return {
          exists: true,
          entityType: "SupplyExecutionEvent",
          entityRef: row.id,
          value: { payloadHash, eventType: row.eventType, status: row.status },
          version: payloadHash,
          evidenceRefs: [{ kind: "execution_event", id: row.id, payloadHash }],
        };
      },
    }),
  ];
}

function supplierEntries(appDb: SupplyStateDatabase) {
  return [
    defineEntry({
      prefix: "supplier.identity:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, supplierId) => {
        const row = await appDb.supplier.findFirst({
          where: { id: supplierId, officeId: context.officeId },
          select: {
            id: true,
            name: true,
            normalizedName: true,
            website: true,
            domain: true,
            status: true,
          },
        });
        if (!row) return missingFact("Supplier", supplierId);
        return {
          exists: true,
          entityType: "Supplier",
          entityRef: row.id,
          value: row,
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "supplier.company_relationship:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [companyId, supplierId] = segments(suffix, 2);
        const row = await appDb.companySupplier.findFirst({
          where: { officeId: context.officeId, companyId, supplierId },
          select: {
            id: true,
            companyId: true,
            supplierId: true,
            status: true,
            notes: true,
            sourceRefs: true,
          },
        });
        if (!row) return missingFact("CompanySupplier", `${companyId}:${supplierId}`);
        return {
          exists: true,
          entityType: "CompanySupplier",
          entityRef: row.id,
          value: companySupplierRelationshipValue(row),
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "supplier.profile:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedSupplierKey] = segments(suffix, 2);
        const supplierKey = decodedSegment(encodedSupplierKey!);
        const row = await appDb.supplySupplierProfile.findFirst({
          where: { officeId: context.officeId, workspaceId, supplierKey },
          select: {
            id: true,
            linkedCompanyId: true,
            supplierKey: true,
            normalizedName: true,
            companyName: true,
            website: true,
            websiteDomain: true,
            roles: true,
            status: true,
          },
        });
        if (!row) return missingFact("SupplySupplierProfile", `${workspaceId}:${supplierKey}`);
        return {
          exists: true,
          entityType: "SupplySupplierProfile",
          entityRef: row.id,
          value: supplierProfileIdentityValue(row),
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "supplier.profile_research:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedSupplierKey] = segments(suffix, 2);
        const supplierKey = decodedSegment(encodedSupplierKey!);
        const row = await appDb.supplySupplierProfile.findFirst({
          where: { officeId: context.officeId, workspaceId, supplierKey },
          select: { id: true, lastResearchRunId: true, lastSeenAt: true },
        });
        if (!row) return missingFact("SupplySupplierProfileResearch", `${workspaceId}:${supplierKey}`);
        const value = supplierProfileResearchValue(row);
        return {
          exists: true,
          entityType: "SupplySupplierProfileResearch",
          entityRef: row.id,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: [],
        };
      },
    }),
    defineEntry({
      prefix: "supplier.profile_facts:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedSupplierKey] = segments(suffix, 2);
        const supplierKey = decodedSegment(encodedSupplierKey!);
        const facts = await appDb.supplyProfileFact.findMany({
          where: {
            officeId: context.officeId,
            workspaceId,
            subjectType: "SUPPLIER",
            subjectRef: supplierKey,
          },
          orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
          take: 50,
          select: { id: true, contentHash: true },
        });
        const value = facts.map((fact) => ({ id: fact.id, contentHash: fact.contentHash }));
        return {
          exists: true,
          entityType: "SupplyProfileFact",
          entityRef: supplierKey,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: facts.map((fact) => ({
            kind: "supply_profile_fact" as const,
            id: fact.id,
            contentHash: fact.contentHash,
          })),
        };
      },
    }),
    defineEntry({
      prefix: "supplier.price_observations:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedSupplierKey] = segments(suffix, 2);
        const supplierKey = decodedSegment(encodedSupplierKey!);
        const profile = await appDb.supplySupplierProfile.findFirst({
          where: { officeId: context.officeId, workspaceId, supplierKey },
          select: { id: true },
        });
        if (!profile) return missingFact("SupplyPriceObservation", supplierKey);
        const observations = await appDb.supplyPriceObservation.findMany({
          where: { officeId: context.officeId, workspaceId, supplierProfileId: profile.id },
          orderBy: [{ observedAt: "desc" }, { id: "desc" }],
          take: 50,
          select: { id: true, contentHash: true },
        });
        const value = observations.map((observation) => ({
          id: observation.id,
          contentHash: observation.contentHash,
        }));
        return {
          exists: true,
          entityType: "SupplyPriceObservation",
          entityRef: supplierKey,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: observations.map((observation) => ({
            kind: "supply_price_observation" as const,
            id: observation.id,
            contentHash: observation.contentHash,
          })),
        };
      },
    }),
    defineEntry({
      prefix: "supplier.evidence:",
      source: "APP_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [workspaceId, encodedSupplierKey] = segments(suffix, 2);
        const supplierKey = decodedSegment(encodedSupplierKey!);
        const profile = await appDb.supplySupplierProfile.findFirst({
          where: { officeId: context.officeId, workspaceId, supplierKey },
          select: { id: true },
        });
        if (!profile) return missingFact("SupplyEvidenceList", `${workspaceId}:${supplierKey}`);
        const [facts, observations] = await Promise.all([
          appDb.supplyProfileFact.findMany({
            where: {
              officeId: context.officeId,
              workspaceId,
              subjectType: "SUPPLIER",
              subjectRef: supplierKey,
            },
            orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
            take: 50,
            select: { evidenceId: true },
          }),
          appDb.supplyPriceObservation.findMany({
            where: { officeId: context.officeId, workspaceId, supplierProfileId: profile.id },
            orderBy: [{ observedAt: "desc" }, { id: "desc" }],
            take: 50,
            select: { evidenceId: true },
          }),
        ]);
        const evidenceIds = [...new Set([
          ...facts.map((fact) => fact.evidenceId),
          ...observations.map((observation) => observation.evidenceId),
        ].filter((id): id is string => Boolean(id)))];
        const evidence = evidenceIds.length ? await appDb.supplyEvidence.findMany({
          where: { officeId: context.officeId, workspaceId, id: { in: evidenceIds } },
          select: {
            id: true,
            contentHash: true,
            sourceType: true,
            sourceRecordId: true,
            sourceVersion: true,
          },
        }) : [];
        const value = supplierEvidenceListValue(evidence);
        return {
          exists: true,
          entityType: "SupplyEvidenceList",
          entityRef: `${workspaceId}:${supplierKey}`,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: value.map((row) => ({
            kind: "supply_evidence" as const,
            id: row.id,
            contentHash: row.contentHash,
          })),
        };
      },
    }),
  ];
}

type WorkflowEntryDependencies = {
  appDb: SupplyStateDatabase;
  getProcurementRequest: typeof getProcurementRequest;
  getWorkflowAccount: ProcurementWorkflowAccountLookup;
  resolveWorkflowOffice: typeof procurementOfficeIdFromServerMetadata;
  getProcurementConversation: SupplyConversationReader;
};

async function currentWorkflowVendor(
  context: SupplyStateFactReadContext,
  suffix: string,
  dependencies: WorkflowEntryDependencies,
) {
  const [customerId, orderId, vendorId] = segments(suffix, 3);
  const order = await workflowOrder(context, customerId!, orderId!, dependencies);
  const vendor = order?.vendors.find((candidate) => candidate.id === vendorId) ?? null;
  return { customerId: customerId!, orderId: orderId!, vendorId: vendorId!, order, vendor };
}

function workflowEntries(dependencies: WorkflowEntryDependencies) {
  return [
    defineEntry({
      prefix: "procurement.order:",
      source: "WORKFLOW_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [customerId, orderId] = segments(suffix, 2);
        const order = await workflowOrder(context, customerId!, orderId!, dependencies);
        if (!order) return missingFact("orders", orderId!);
        const value = orderFactValue(order);
        const valueHash = hashSupplyStateValue(value);
        return {
          exists: true,
          entityType: "orders",
          entityRef: order.id,
          value,
          evidenceRefs: [{ kind: "procurement_order", id: order.id, valueHash }],
        };
      },
    }),
    defineEntry({
      prefix: "procurement.order_decision_state:",
      source: "WORKFLOW_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [customerId, orderId] = segments(suffix, 2);
        const order = await workflowOrder(context, customerId!, orderId!, dependencies);
        if (!order) return missingFact("orders.decision_state", orderId!);
        return {
          exists: true,
          entityType: "orders.decision_state",
          entityRef: order.id,
          value: orderDecisionStateValue(order),
          evidenceRefs: [{
            kind: "procurement_order",
            id: order.id,
            valueHash: hashSupplyStateValue(orderFactValue(order)),
          }],
        };
      },
    }),
    defineEntry({
      prefix: "procurement.order_request_context:",
      source: "WORKFLOW_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const [customerId, orderId] = segments(suffix, 2);
        const order = await workflowOrder(context, customerId!, orderId!, dependencies);
        if (!order) return missingFact("orders.request_context", orderId!);
        const workflowAccount = await dependencies.getWorkflowAccount({
          customerId: customerId!,
          officeId: context.officeId,
        });
        if (!workflowAccount) return missingFact("orders.request_context", orderId!);
        const documentIds = requestDocumentIds(order.requestContext);
        const documents = documentIds.length
          ? await dependencies.appDb.companyContext.findMany({
              where: {
                officeId: context.officeId,
                companyId: workflowAccount.companyId,
                id: { in: documentIds },
                kind: "DOCUMENT",
              },
              select: { id: true, contentHash: true, processingState: true },
            })
          : [];
        const byId = new Map(documents.map((document) => [document.id, document]));
        const documentManifest = documentIds.map((id) => ({
          id,
          contentHash: byId.get(id)?.contentHash ?? null,
          processingState: byId.get(id)?.processingState ?? "MISSING",
        }));
        const value = {
          requestContext: selectedRequestContext(order.requestContext),
          documents: documentManifest,
        };
        const orderValueHash = hashSupplyStateValue(orderFactValue(order));
        return {
          exists: true,
          entityType: "orders.request_context",
          entityRef: order.id,
          value,
          evidenceRefs: [
            { kind: "procurement_order", id: order.id, valueHash: orderValueHash },
            ...documentManifest.map((document) => ({
              kind: "company_context" as const,
              id: document.id,
              contentHash: document.contentHash,
            })),
          ],
        };
      },
    }),
    defineEntry({
      prefix: "procurement.order_stage:",
      source: "WORKFLOW_DB",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, suffix) => {
        const [customerId, orderId] = segments(suffix, 2);
        const order = await workflowOrder(context, customerId!, orderId!, dependencies);
        if (!order) return missingFact("procurement_order_stage", orderId!);
        const quotes = order.vendors.filter((vendor) => Boolean(vendor.quote)).length;
        const value = {
          stage: autopilotRequestStage({ quotes }),
          quotes,
          vendorCount: order.vendors.length,
        };
        return {
          exists: true,
          entityType: "procurement_order_stage",
          entityRef: order.id,
          value,
          evidenceRefs: [{
            kind: "procurement_order",
            id: order.id,
            valueHash: hashSupplyStateValue(orderFactValue(order)),
          }],
        };
      },
    }),
    defineEntry({
      prefix: "procurement.vendor:",
      source: "WORKFLOW_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const { vendorId, vendor } = await currentWorkflowVendor(context, suffix, dependencies);
        if (!vendor) return missingFact("order_vendor", vendorId);
        const value = vendorIdentityValue(vendor);
        const valueHash = hashSupplyStateValue(value);
        return {
          exists: true,
          entityType: "order_vendor",
          entityRef: vendor.id,
          value,
          evidenceRefs: [{ kind: "procurement_vendor", id: vendor.id, valueHash }],
        };
      },
    }),
    defineEntry({
      prefix: "procurement.vendor_quote:",
      source: "WORKFLOW_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const { vendorId, vendor } = await currentWorkflowVendor(context, suffix, dependencies);
        if (!vendor) return missingFact("order_vendor_quote", vendorId);
        const identityHash = hashSupplyStateValue(vendorIdentityValue(vendor));
        return {
          exists: true,
          entityType: "order_vendor_quote",
          entityRef: vendor.id,
          value: vendor.quote,
          evidenceRefs: [{ kind: "procurement_vendor", id: vendor.id, valueHash: identityHash }],
        };
      },
    }),
    defineEntry({
      prefix: "procurement.vendor_latest_message:",
      source: "EMAIL_LEDGER",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const { customerId, orderId, vendorId, vendor } = await currentWorkflowVendor(context, suffix, dependencies);
        if (!vendor) return missingFact("procurement_communication_message", vendorId);
        const conversation = await workflowConversation(
          context,
          customerId,
          orderId,
          vendorId,
          dependencies,
        );
        const { latest, value, evidenceRefs } = procurementConversationMessageState(conversation.messages);
        return {
          exists: true,
          entityType: "procurement_communication_message",
          entityRef: vendor.id,
          value,
          version: latest?.id,
          evidenceRefs,
        };
      },
    }),
    defineEntry({
      prefix: "procurement.vendor_triage:",
      source: "WORKFLOW_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const { customerId, orderId, vendorId, order, vendor } = await currentWorkflowVendor(
          context,
          suffix,
          dependencies,
        );
        if (!order || !vendor) return missingFact("procurement_inbound_triage", vendorId);
        const conversation = await workflowConversation(
          context,
          customerId,
          orderId,
          vendorId,
          dependencies,
        );
        const { latest, evidenceRefs } = procurementConversationMessageState(conversation.messages);
        const value = latest?.direction === "INBOUND"
          ? triageSupplierInbound({
              subject: latest.subject,
              body: latest.body,
              facts: procurementReplyFacts(order),
            })
          : null;
        return {
          exists: true,
          entityType: "procurement_inbound_triage",
          entityRef: vendor.id,
          value,
          evidenceRefs,
        };
      },
    }),
    defineEntry({
      prefix: "procurement.vendor_saved_draft:",
      source: "APP_DB",
      defaultPolicy: "STRICT",
      readCurrent: async (context, _key, suffix) => {
        const { orderId, vendorId, order, vendor } = await currentWorkflowVendor(context, suffix, dependencies);
        if (!order || !vendor) return missingFact("SupplyExecutionTask", `${orderId}:${vendorId}`);
        const workspaceId = requestWorkspaceId(order);
        const draft = workspaceId ? await dependencies.appDb.supplyExecutionTask.findFirst({
          where: {
            officeId: context.officeId,
            workspaceId,
            taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
            status: { in: ["PLANNED", "BLOCKED", "READY"] },
            taskKey: { startsWith: `procurement-reply-draft:${orderId}:${vendorId}:` },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, inputHash: true, status: true },
        }) : null;
        const value = draft ? { id: draft.id, inputHash: draft.inputHash, status: draft.status } : null;
        return {
          exists: true,
          entityType: "SupplyExecutionTask",
          entityRef: draft?.id ?? `${orderId}:${vendorId}`,
          value,
          version: draft?.inputHash,
          evidenceRefs: draft
            ? [{ kind: "execution_task", id: draft.id, inputHash: draft.inputHash }]
            : [],
        };
      },
    }),
  ];
}

function emailAndBrainEntries(appDb: SupplyStateDatabase) {
  return [
    defineEntry({
      prefix: "email.company_threads:",
      source: "EMAIL_LEDGER",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, companyId) => {
        const threads = await appDb.emailThread.findMany({
          where: {
            officeId: context.officeId,
            companyId,
            hiddenAt: null,
            OR: [
              { autoLinkSkipReason: null },
              { autoLinkSkipReason: { not: UNROUTED_MAIL_THREAD_MARKER } },
            ],
          },
          orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
          take: 20,
          select: {
            id: true,
            companyId: true,
            messageCount: true,
            lastMessageAt: true,
            messages: {
              orderBy: [{ sentAt: "desc" }, { id: "desc" }],
              take: 10,
              select: { id: true, direction: true },
            },
          },
        });
        const value = routedCompanyThreadListValue(threads);
        return {
          exists: true,
          entityType: "EmailThreadList",
          entityRef: companyId,
          value,
          version: hashSupplyStateValue(value),
          evidenceRefs: threads.flatMap((thread) => thread.messages.map((message) => ({
            kind: "email_message" as const,
            id: message.id,
          }))),
        };
      },
    }),
    defineEntry({
      prefix: "email.thread:",
      source: "EMAIL_LEDGER",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, threadId) => {
        const thread = await appDb.emailThread.findFirst({
          where: {
            id: threadId,
            officeId: context.officeId,
            companyId: { not: null },
            hiddenAt: null,
          },
          select: {
            id: true,
            companyId: true,
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
        });
        if (!thread || thread.autoLinkSkipReason === UNROUTED_MAIL_THREAD_MARKER) {
          return missingFact("EmailThread", threadId);
        }
        const newest = thread.messages[0] ?? null;
        return {
          exists: true,
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
          evidenceRefs: thread.messages.map((message) => ({
            kind: "email_message" as const,
            id: message.id,
            providerMessageId: message.externalId ?? message.gmailMessageId,
          })),
        };
      },
    }),
    defineEntry({
      prefix: "company_brain.knowledge_object:",
      source: "COMPANY_BRAIN",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, objectId) => {
        const object = await appDb.knowledgeObject.findFirst({
          where: { id: objectId, officeId: context.officeId },
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
          },
        });
        if (!object) return missingFact("KnowledgeObject", objectId);
        return {
          exists: true,
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
          evidenceRefs: [{ kind: "knowledge_object", id: object.id }],
        };
      },
    }),
    defineEntry({
      prefix: "company_brain.knowledge_chunk:",
      source: "COMPANY_BRAIN",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, chunkId) => {
        const chunk = await appDb.knowledgeChunk.findFirst({
          where: { id: chunkId, officeId: context.officeId },
          select: { id: true, objectId: true, ordinal: true, kind: true, text: true, payloadVersion: true },
        });
        if (!chunk) return missingFact("KnowledgeChunk", chunkId);
        const contentHash = hashSupplyStateValue(chunk.text);
        return {
          exists: true,
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
          evidenceRefs: [{ kind: "knowledge_chunk", id: chunk.id }],
        };
      },
    }),
    defineEntry({
      prefix: "company_brain.memory_event:",
      source: "COMPANY_BRAIN",
      defaultPolicy: "ADVISORY",
      readCurrent: async (context, _key, eventId) => {
        const event = await appDb.memoryEvent.findFirst({
          where: { id: eventId, officeId: context.officeId },
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
        });
        if (!event) return missingFact("MemoryEvent", eventId);
        const payloadHash = hashSupplyStateValue(event.payload);
        return {
          exists: true,
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
          evidenceRefs: [{ kind: "memory_event", id: event.id }],
        };
      },
    }),
  ];
}

export function createSupplyStateFactRegistry(
  overrides: SupplyStateFactRegistryDependencies = {},
) {
  const dependencies = {
    appDb: overrides.appDb ?? prisma,
    getProcurementRequest: overrides.getProcurementRequest ?? getProcurementRequest,
    getWorkflowAccount: overrides.getWorkflowAccount ?? getProcurementWorkflowAccount,
    resolveWorkflowOffice: overrides.resolveWorkflowOffice ?? procurementOfficeIdFromServerMetadata,
    getProcurementConversation: overrides.getProcurementConversation ?? (async (...args) => {
      // Keep provider/auth modules out of read-only registry startup. They are
      // loaded only for an explicitly linked procurement communication fact.
      const { procurementVendorConversation } = await import("@/lib/procurement-conversation");
      return procurementVendorConversation(...args);
    }),
    assembleCompanyContext: overrides.assembleCompanyContext ?? assembleCompanyContextForAgent,
    resolveCompanyContextAccess: overrides.resolveCompanyContextAccess ?? procurementOperatorAccess,
  };
  return new SupplyStateFactRegistry([
    ...companyEntries(dependencies.appDb),
    ...companyContextEntries(dependencies),
    ...snapshotEntries(dependencies.appDb),
    ...planningAndExecutionEntries(dependencies.appDb),
    ...supplierEntries(dependencies.appDb),
    ...workflowEntries(dependencies),
    ...emailAndBrainEntries(dependencies.appDb),
  ]);
}

export const supplyStateFactRegistry = createSupplyStateFactRegistry();

export function registerSupplyStateFactRegistryEntry(
  entry: SupplyStateFactRegistryEntry,
  options: { replace?: boolean } = {},
) {
  supplyStateFactRegistry.register(entry, options);
}

export function resolveSupplyStateDependencyPolicy(args: {
  registry?: SupplyStateFactRegistry;
  key: string;
  requestedPolicy?: SupplyStateDependency["policy"];
}) {
  const registry = args.registry ?? supplyStateFactRegistry;
  const { entry } = registry.resolve(args.key);
  return entry.defaultPolicy === "STRICT" || args.requestedPolicy === "STRICT"
    ? "STRICT" as const
    : "ADVISORY" as const;
}

export async function readCurrentSupplyStateFact(args: {
  registry?: SupplyStateFactRegistry;
  key: string;
  context: SupplyStateFactReadContext;
}): Promise<CurrentSupplyStateFact> {
  const registry = args.registry ?? supplyStateFactRegistry;
  const { entry, suffix } = registry.resolve(args.key);
  let current: SupplyStateFactValue;
  try {
    current = await entry.readCurrent(args.context, args.key, suffix);
  } catch (error) {
    if (error instanceof SupplyStateFactRegistryError) throw error;
    throw new SupplyStateFactRegistryError(
      `Current value for supply state fact ${args.key} could not be read.`,
      "source_unavailable",
    );
  }
  const canonicalValue = entry.canonicalize(current.value);
  const valueHash = entry.hash(canonicalValue);
  const resolvedVersion = current.version?.trim() || valueHash;
  return {
    ...current,
    key: args.key,
    source: entry.source,
    canonicalValue,
    valueHash,
    resolvedVersion,
    evidenceRefs: entry.evidence(current),
  };
}

export async function readSupplyStateDependency(args: {
  registry?: SupplyStateFactRegistry;
  key: string;
  context: SupplyStateFactReadContext;
  policy?: SupplyStateDependency["policy"];
  reason?: string;
}): Promise<SupplyStateDependency> {
  const registry = args.registry ?? supplyStateFactRegistry;
  const current = await readCurrentSupplyStateFact({
    registry,
    key: args.key,
    context: args.context,
  });
  return {
    key: args.key,
    source: current.source,
    entityType: current.entityType,
    entityRef: current.entityRef,
    version: current.resolvedVersion,
    valueHash: current.valueHash,
    // A caller may promote an advisory registry fact to STRICT for a specific
    // action, but it may never weaken a registry-owned STRICT fact.
    policy: resolveSupplyStateDependencyPolicy({
      registry,
      key: args.key,
      requestedPolicy: args.policy,
    }),
    reason: args.reason?.trim().slice(0, 1_000)
      || "The semantic fact changed after this state was compiled.",
    evidenceRefs: current.evidenceRefs,
  };
}
