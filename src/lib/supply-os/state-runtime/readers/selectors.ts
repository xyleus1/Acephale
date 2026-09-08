import { hashSupplyStateValue } from "@/lib/supply-os/state-runtime/canonicalize";
import type { ProcurementConversationMessage } from "@/lib/procurement-conversation-model";
import { supplierWrittenMessages } from "@/lib/procurement-inbound-triage";

export function procurementConversationMessageState(messages: readonly ProcurementConversationMessage[]) {
  const written = supplierWrittenMessages(messages);
  const latest = written.at(-1) ?? null;
  const latestInbound = [...written].reverse().find((message) => message.direction === "INBOUND") ?? null;
  const messageValue = (message: ProcurementConversationMessage | null) => message ? {
    id: message.id,
    direction: message.direction,
    fromEmail: message.fromEmail,
    toEmails: [...message.toEmails].sort(),
    ccEmails: [...message.ccEmails].sort(),
    subject: message.subject,
    bodyHash: hashSupplyStateValue(message.body),
    sentAt: message.sentAt,
    truncated: message.truncated,
  } : null;
  const latestValue = messageValue(latest);
  const inboundValue = messageValue(latestInbound);
  // A follow up uses an earlier inbound anchor while the latest human message
  // is outbound. Both must stay fixed, including the anchor body and recipient.
  const value = latestValue ? {
    ...latestValue,
    latestInboundMessage: latestInbound?.id !== latest?.id ? inboundValue : null,
  } : null;
  const evidenceRefs = [latest, latestInbound]
    .filter((message, index, selected): message is ProcurementConversationMessage => (
      message !== null && selected.findIndex((entry) => entry?.id === message.id) === index
    ))
    .map((message) => ({
      kind: "procurement_message" as const,
      id: message.id,
      valueHash: hashSupplyStateValue(messageValue(message)),
    }));
  return { latest, latestInbound, value, evidenceRefs };
}

type CompanyIdentityRow = {
  id: string;
  name: string;
  status: string;
};

type CanonicalItemIdentityRow = {
  id: string;
  companyId: string;
  name: string;
  sku: string | null;
  specification: string | null;
  manufacturer: string | null;
  partNumber: string | null;
  unit: string | null;
};

type WorkspaceIdentityRow = {
  id: string;
  companyId: string | null;
  externalKey: string | null;
  name: string;
  status: string;
  version: number;
  archivedAt: Date | string | null;
};

type SnapshotHeaderRow = {
  id: string;
  version: number;
  schemaVersion: number;
  sourceHash: string | null;
  publishedAt: Date | string | null;
};

type PlanningHeadRow = {
  id: string;
  snapshotId: string;
  engineVersion: string;
  snapshotHash: string;
  normalizedInputHash: string;
  outputHash: string;
  createdAt: Date | string;
};

type EquivalenceHeadRow = {
  id: string;
  ruleKey: string;
  version: number;
  fromItemKey: string;
  toItemKey: string | null;
  action: string;
  status: string;
  ruleHash: string;
  approvedAt: Date | string | null;
};

type DecisionControlRow = {
  id: string;
  proposal: unknown;
  proposalHash: string | null;
  status: string;
  snapshotId: string;
  finalizedAt: Date | string | null;
};

type CompanySupplierRelationshipRow = {
  id: string;
  companyId: string;
  supplierId: string;
  status: string;
  notes: string | null;
  sourceRefs: unknown;
};

type SupplierProfileIdentityRow = {
  id: string;
  linkedCompanyId: string | null;
  supplierKey: string;
  normalizedName: string;
  companyName: string;
  website: string | null;
  websiteDomain: string | null;
  roles: unknown;
  status: string;
};

type SupplierProfileResearchRow = {
  id: string;
  lastResearchRunId: string | null;
  lastSeenAt: Date | string;
};

type SupplierEvidenceRow = {
  id: string;
  contentHash: string | null;
  sourceType: string;
  sourceRecordId: string | null;
  sourceVersion: string | null;
};

type ApprovalControlRow = {
  id: string;
  scopeHash: string;
  status: string;
  requiredRole: string | null;
  decisionId: string | null;
  executionTaskId: string | null;
  expiresAt: Date | string | null;
  decidedAt: Date | string | null;
};

type TaskControlRow = {
  id: string;
  inputHash: string;
  status: string;
  decisionId: string | null;
  snapshotId: string | null;
  requiresApproval: boolean;
  resultHash: string | null;
  externalSystem: string | null;
  externalRef: string | null;
  scheduledFor: Date | string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  failedAt: Date | string | null;
  cancelledAt: Date | string | null;
};

type ExecutionEventHeadRow = {
  id: string;
  executionTaskId?: string;
  sequence: number;
  eventType: string;
  status: string | null;
  payloadHash: string | null;
  occurredAt: Date | string;
};

type RoutedThreadHeadRow = {
  id: string;
  companyId: string | null;
  messageCount: number;
  lastMessageAt: Date | string;
  messages: Array<{
    id: string;
    direction: string;
  }>;
};

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function boundedSemanticValue(
  value: unknown,
  options: { depth?: number; maxArray?: number; maxKeys?: number; maxString?: number } = {},
): unknown {
  const depth = options.depth ?? 0;
  const maxArray = options.maxArray ?? 100;
  const maxKeys = options.maxKeys ?? 80;
  const maxString = options.maxString ?? 4_000;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim().slice(0, maxString);
  }
  if (value instanceof Date) return iso(value);
  if (depth >= 7) return "[bounded]";
  if (Array.isArray(value)) {
    return value.slice(0, maxArray).map((entry) => boundedSemanticValue(entry, {
      ...options,
      depth: depth + 1,
    }));
  }
  if (!value || typeof value !== "object") return null;
  if ("toJSON" in value && typeof value.toJSON === "function") {
    return boundedSemanticValue(value.toJSON(), { ...options, depth: depth + 1 });
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, maxKeys)
    .flatMap(([key, child]) => child === undefined
      ? []
      : [[key, boundedSemanticValue(child, { ...options, depth: depth + 1 })] as const]));
}

// Keep the strict Company fact intentionally narrow. Relationship notes,
// prospecting metadata, timestamps, and other presentation fields do not
// change the canonical account identity or lifecycle status used by V1.
export function companyIdentityValue(row: CompanyIdentityRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
  };
}

// Item.updatedAt is deliberately excluded. Only fields that define the item
// identity, requirement, or exact snapshot mapping participate in this fact.
export function canonicalItemIdentityValue(row: CanonicalItemIdentityRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    sku: row.sku,
    specification: row.specification,
    manufacturer: row.manufacturer,
    partNumber: row.partNumber,
    unit: row.unit,
  };
}

export function workspaceIdentityValue(row: WorkspaceIdentityRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    status: row.status,
    archivedAt: iso(row.archivedAt),
  };
}

export function workspacePresentationValue(row: WorkspaceIdentityRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    externalKey: row.externalKey,
    name: row.name,
    version: row.version,
  };
}

export function companySupplierRelationshipValue(row: CompanySupplierRelationshipRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    supplierId: row.supplierId,
    status: row.status,
    notes: row.notes,
    sourceRefs: boundedSemanticValue(row.sourceRefs, { maxArray: 30, maxString: 1_000 }),
  };
}

export function supplierProfileIdentityValue(row: SupplierProfileIdentityRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    linkedCompanyId: row.linkedCompanyId,
    supplierKey: row.supplierKey,
    normalizedName: row.normalizedName,
    companyName: row.companyName,
    website: row.website,
    websiteDomain: row.websiteDomain,
    roles: boundedSemanticValue(row.roles, { maxArray: 30, maxString: 1_000 }),
    status: row.status,
  };
}

export function supplierProfileResearchValue(row: SupplierProfileResearchRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    lastResearchRunId: row.lastResearchRunId,
    lastSeenAt: iso(row.lastSeenAt),
  };
}

export function supplyEvidenceContentHash(row: SupplierEvidenceRow) {
  return row.contentHash ?? hashSupplyStateValue({
    sourceType: row.sourceType,
    sourceRecordId: row.sourceRecordId,
    sourceVersion: row.sourceVersion,
  });
}

export function supplierEvidenceListValue(rows: SupplierEvidenceRow[]) {
  return [...rows]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((row) => ({ id: row.id, contentHash: supplyEvidenceContentHash(row) }));
}

export function snapshotSourceHash(row: SnapshotHeaderRow) {
  return row.sourceHash ?? hashSupplyStateValue({
    id: row.id,
    version: row.version,
    schemaVersion: row.schemaVersion,
    publishedAt: iso(row.publishedAt),
  });
}

export function currentSnapshotFactValue(row: SnapshotHeaderRow) {
  return {
    id: row.id,
    version: row.version,
    schemaVersion: row.schemaVersion,
    sourceHash: snapshotSourceHash(row),
    publishedAt: iso(row.publishedAt),
  };
}

export function planningResultListValue(rows: PlanningHeadRow[]) {
  return rows.map((row) => ({
    id: row.id,
    snapshotId: row.snapshotId,
    engineVersion: row.engineVersion,
    snapshotHash: row.snapshotHash,
    normalizedInputHash: row.normalizedInputHash,
    outputHash: row.outputHash,
    createdAt: iso(row.createdAt),
  }));
}

export function equivalenceRuleListValue(rows: EquivalenceHeadRow[]) {
  return rows.map((row) => ({
    id: row.id,
    ruleKey: row.ruleKey,
    version: row.version,
    fromItemKey: row.fromItemKey,
    toItemKey: row.toItemKey,
    action: row.action,
    status: row.status,
    ruleHash: row.ruleHash,
    approvedAt: iso(row.approvedAt),
  }));
}

export function executionControlListValue(args: {
  decisions: DecisionControlRow[];
  approvals: ApprovalControlRow[];
  tasks: TaskControlRow[];
}) {
  return {
    decisions: args.decisions.map((row) => ({
      id: row.id,
      proposalHash: effectiveDecisionProposalHash(row),
      status: row.status,
      snapshotId: row.snapshotId,
      finalizedAt: iso(row.finalizedAt),
    })),
    approvals: args.approvals.map((row) => ({
      id: row.id,
      scopeHash: row.scopeHash,
      status: row.status,
      requiredRole: row.requiredRole,
      decisionId: row.decisionId,
      executionTaskId: row.executionTaskId,
      expiresAt: iso(row.expiresAt),
      decidedAt: iso(row.decidedAt),
    })),
    tasks: args.tasks.map((row) => ({
      id: row.id,
      inputHash: row.inputHash,
      status: row.status,
      decisionId: row.decisionId,
      snapshotId: row.snapshotId,
      requiresApproval: row.requiresApproval,
      resultHash: row.resultHash,
      externalSystem: row.externalSystem,
      externalRef: row.externalRef,
      scheduledFor: iso(row.scheduledFor),
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      failedAt: iso(row.failedAt),
      cancelledAt: iso(row.cancelledAt),
    })),
  };
}

export function effectiveDecisionProposalHash(row: Pick<DecisionControlRow, "proposal" | "proposalHash">) {
  return row.proposalHash ?? hashSupplyStateValue(row.proposal);
}

export function executionEventListValue(rows: ExecutionEventHeadRow[]) {
  return rows.map((row) => {
    const payloadHash = row.payloadHash ?? hashSupplyStateValue({
      sequence: row.sequence,
      eventType: row.eventType,
      status: row.status,
      occurredAt: iso(row.occurredAt),
    });
    return {
      id: row.id,
      executionTaskId: row.executionTaskId ?? null,
      sequence: row.sequence,
      eventType: row.eventType,
      status: row.status,
      payloadHash,
      occurredAt: iso(row.occurredAt),
    };
  });
}

export function routedCompanyThreadListValue(rows: RoutedThreadHeadRow[]) {
  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    messageCount: row.messageCount,
    latestMessageId: row.messages[0]?.id ?? null,
    latestDirection: row.messages[0]?.direction ?? null,
    lastMessageAt: iso(row.lastMessageAt),
  }));
}

export function planningMentionsItem(output: unknown, itemKey: string) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return false;
  if ((output as Record<string, unknown>).productItemKey === itemKey) return true;
  return JSON.stringify(boundedSemanticValue(output, { maxArray: 200, maxString: 500 }))
    .includes(JSON.stringify(itemKey));
}
