import "server-only";

import { assembleCompanyContextForAgent } from "@/lib/company-context";
import {
  companyContextVisibilityWhere,
  type CompanyContextAccess,
} from "@/lib/customer-context-access";
import { prisma } from "@/lib/prisma";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { buildProcurementCompanyContextSnapshot } from "@/lib/supply-os/procurement-company-context";
import type { SupplyStateScope, SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import {
  boundSupplyStateValue,
  emptySupplyStateReaderResult,
  isRecord,
  makeSupplyStateDependency,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";
import { workspaceIdentityValue, workspacePresentationValue } from "./selectors";

type CompanyContextReaderDependencies = {
  assemble: typeof assembleCompanyContextForAgent;
  resolveInternalAccess: (officeId: string) => Promise<CompanyContextAccess>;
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findWorkspaces: typeof prisma.supplyWorkspace.findMany;
  findContextRows: typeof prisma.companyContext.findMany;
};

const defaultDependencies: CompanyContextReaderDependencies = {
  assemble: assembleCompanyContextForAgent,
  resolveInternalAccess: procurementOperatorAccess,
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findWorkspaces: (args) => prisma.supplyWorkspace.findMany(args),
  findContextRows: (args) => prisma.companyContext.findMany(args),
};

function companyIdForScope(scope: SupplyStateScope) {
  if (scope.type === "company" || scope.type === "procurement_request" || scope.type === "item") {
    return scope.companyId;
  }
  return scope.type === "supplier" ? scope.companyId ?? null : null;
}

function requestedWorkspaceId(scope: SupplyStateScope) {
  if (scope.type === "workspace" || scope.type === "item") return scope.workspaceId;
  return "workspaceId" in scope ? scope.workspaceId ?? null : null;
}

function messageRole(payload: unknown, portalUserId: string | null) {
  if (isRecord(payload) && payload.role === "AGENT") return "AGENT";
  return portalUserId ? "CUSTOMER" : "OPERATOR";
}

export async function readCompanyContextState(
  input: SupplyStateReaderInput,
  dependencies: CompanyContextReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  const result = emptySupplyStateReaderResult();
  const requestedCompanyId = companyIdForScope(input.scope);
  const requestedWorkspace = requestedWorkspaceId(input.scope);
  const workspaceSelect = {
      id: true,
      companyId: true,
      externalKey: true,
      name: true,
      status: true,
      version: true,
      archivedAt: true,
  } as const;
  const eligibleWorkspaces = requestedCompanyId && !requestedWorkspace
    ? await dependencies.findWorkspaces({
        where: { officeId: input.scope.officeId, companyId: requestedCompanyId, status: "ACTIVE" },
        orderBy: [{ id: "asc" }],
        take: 50,
        select: workspaceSelect,
      })
    : null;
  const workspace = eligibleWorkspaces?.[0] ?? await dependencies.findWorkspace({
    where: {
      officeId: input.scope.officeId,
      status: "ACTIVE",
      ...(requestedWorkspace ? { id: requestedWorkspace } : {}),
      ...(requestedCompanyId ? { companyId: requestedCompanyId } : { companyId: { not: null } }),
    },
    orderBy: [{ id: "asc" }],
    select: workspaceSelect,
  });
  if (requestedCompanyId && !requestedWorkspace) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `company.context_workspaces:${requestedCompanyId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspaceList",
      entityRef: requestedCompanyId,
      value: (eligibleWorkspaces ?? []).map(workspaceIdentityValue),
      policy: "ADVISORY",
      reason: "The bounded active Company Context workspace list changed.",
    }));
  }
  if (!workspace?.companyId) {
    if (requestedWorkspace) {
      result.dependencies.push(makeSupplyStateDependency({
        key: `workspace.identity:${requestedWorkspace}`,
        source: "APP_DB",
        entityType: "SupplyWorkspace",
        entityRef: requestedWorkspace,
        value: null,
        policy: "STRICT",
        reason: "The requested Company Context workspace is missing or inactive.",
      }));
      if (requestedCompanyId) {
        result.dependencies.push(makeSupplyStateDependency({
          key: `company.context_version:${requestedCompanyId}:${requestedWorkspace}`,
          source: "APP_DB",
          entityType: "CompanyContext",
          entityRef: `${requestedCompanyId}:${requestedWorkspace}`,
          value: null,
          policy: input.scope.type === "procurement_request" ? "STRICT" : "ADVISORY",
          reason: "The exact company and workspace context head is missing.",
        }));
      }
    }
    result.uncertainties.push({
      kind: "company_context_workspace_missing",
      companyId: requestedCompanyId,
      workspaceId: requestedWorkspace,
    });
    return result;
  }

  const identityValue = workspaceIdentityValue(workspace);
  const presentationValue = workspacePresentationValue(workspace);
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `workspace.identity:${workspace.id}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspace.id,
      value: identityValue,
      policy: "STRICT",
      reason: "Company Context workspace ownership or lifecycle changed.",
    }),
    makeSupplyStateDependency({
      key: `workspace.presentation:${workspace.id}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspace.id,
      value: presentationValue,
      policy: "ADVISORY",
      reason: "Company Context workspace presentation changed.",
    }),
  );

  const access = input.access ?? await dependencies.resolveInternalAccess(input.scope.officeId);
  if (access.officeId !== input.scope.officeId) {
    throw new Error("Company Context access does not match the state scope office.");
  }
  const assembled = await dependencies.assemble(access, workspace.id);
  if (assembled.company.id !== workspace.companyId) {
    throw new Error("Company Context assembly returned a different company.");
  }
  const snapshot = buildProcurementCompanyContextSnapshot(assembled);
  const rows = await dependencies.findContextRows({
    where: {
      officeId: input.scope.officeId,
      companyId: workspace.companyId,
      kind: { in: ["DOCUMENT", "MESSAGE"] },
      ...companyContextVisibilityWhere(access),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 240,
    select: {
      id: true,
      kind: true,
      itemId: true,
      name: true,
      contentHash: true,
      markdown: true,
      processingState: true,
      processingError: true,
      payload: true,
      createdByPortalUserId: true,
      createdAt: true,
    },
  });

  const snapshotDocumentIds = new Set((snapshot?.documents ?? []).map((document) => (
    document.citation_id.startsWith("document:") ? document.citation_id.slice("document:".length) : ""
  )));
  const snapshotMessageIds = new Set((snapshot?.operator_messages ?? []).map((message) => (
    message.citation_id.startsWith("message:") ? message.citation_id.slice("message:".length) : ""
  )));
  const selectedRows = rows.filter((row) => (
    (row.kind === "DOCUMENT" && snapshotDocumentIds.has(row.id))
    || (row.kind === "MESSAGE" && snapshotMessageIds.has(row.id) && messageRole(row.payload, row.createdByPortalUserId) !== "AGENT")
  ));
  const failedDocuments = rows.filter((row) => (
    row.kind === "DOCUMENT" && row.processingState !== "READY"
  )).slice(-40);
  const evidenceRefs: SupplyWorldEvidenceRef[] = selectedRows.map((row) => ({
    kind: "company_context" as const,
    id: row.id,
    contentHash: row.contentHash ?? undefined,
  }));
  const strict = input.scope.type === "procurement_request";
  const contextManifest = selectedRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    itemId: row.itemId,
    contentHash: row.contentHash,
    processingState: row.processingState,
  }));

  if (snapshot) {
    result.currentState.companyContext = boundSupplyStateValue({
      schemaVersion: snapshot.schema_version,
      trust: snapshot.trust,
      handling: snapshot.handling,
      company: snapshot.company,
      workspaceId: workspace.id,
      version: snapshot.version,
      capturedAt: snapshot.captured_at,
      documents: snapshot.documents,
      operatorMessages: snapshot.operator_messages,
      processing: {
        failedOrPending: failedDocuments.map((document) => ({
          id: document.id,
          name: document.name,
          state: document.processingState ?? "FAILED",
          error: document.processingError?.slice(0, 500) ?? null,
        })),
      },
    }, { maxArray: 50, maxString: 12_000 });
  } else {
    result.currentState.companyContext = {
      company: { id: workspace.companyId, name: workspace.name },
      workspaceId: workspace.id,
      version: null,
      documents: [],
      operatorMessages: [],
      processing: { failedOrPending: failedDocuments.map((row) => ({ id: row.id, state: row.processingState })) },
    };
    result.uncertainties.push({ kind: "company_context_empty", companyId: workspace.companyId });
  }

  result.dependencies.push(makeSupplyStateDependency({
    key: `company.context_version:${workspace.companyId}:${workspace.id}`,
    source: "APP_DB",
    entityType: "CompanyContext",
    entityRef: `${workspace.companyId}:${workspace.id}`,
    version: snapshot?.version,
    value: contextManifest,
    policy: strict ? "STRICT" : "ADVISORY",
    reason: strict
      ? "The request relies on the selected company documents and operator requirements."
      : "Company Context changed after this state was compiled.",
    evidenceRefs,
  }));

  for (const row of selectedRows) {
    const ref = evidenceRefs.find((evidence) => evidence.id === row.id);
    result.dependencies.push(makeSupplyStateDependency({
      key: row.kind === "DOCUMENT"
        ? `company.context_document:${workspace.companyId}:${row.id}`
        : `company.context_message:${workspace.companyId}:${row.id}`,
      source: "APP_DB",
      entityType: "CompanyContext",
      entityRef: row.id,
      version: row.contentHash,
      value: row.kind === "DOCUMENT"
        ? { contentHash: row.contentHash, processingState: row.processingState }
        : { role: messageRole(row.payload, row.createdByPortalUserId), markdown: row.markdown },
      policy: strict ? "STRICT" : "ADVISORY",
      reason: row.kind === "DOCUMENT"
        ? "Selected Company Context document content or processing state changed."
        : "Selected operator requirement changed.",
      evidenceRefs: ref ? [ref] : [],
    }));
  }
  result.uncertainties.push(...failedDocuments.map((document) => ({
    kind: "company_context_document_not_ready",
    documentId: document.id,
    processingState: document.processingState ?? "FAILED",
  })));
  result.evidenceRefs = evidenceRefs;
  result.sourceCounts = {
    companyContextDocuments: snapshot?.documents.length ?? 0,
    companyContextOperatorMessages: snapshot?.operator_messages.length ?? 0,
    companyContextDocumentsNotReady: failedDocuments.length,
    companyContextAgentMessagesExcluded: rows.filter((row) => (
      row.kind === "MESSAGE" && messageRole(row.payload, row.createdByPortalUserId) === "AGENT"
    )).length,
  };
  return result;
}
