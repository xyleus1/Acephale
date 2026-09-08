import "server-only";

import { prisma } from "@/lib/prisma";
import {
  supplyStateScopeRef,
  type SupplyStateProjectionType,
  type SupplyStateScope,
} from "@/lib/supply-os/state-runtime/types";
import { projectionTypeForSupplyStateScope, SUPPLY_STATE_COMPILER_VERSION } from "./types";

type ProjectionInvalidationDependencies = {
  findMany: typeof prisma.supplyStateProjection.findMany;
  updateMany: typeof prisma.supplyStateProjection.updateMany;
  now: () => Date;
};

const defaultDependencies: ProjectionInvalidationDependencies = {
  findMany: (args) => prisma.supplyStateProjection.findMany(args),
  updateMany: (args) => prisma.supplyStateProjection.updateMany(args),
  now: () => new Date(),
};

type RoutedEmailProjectionInvalidationDependencies = ProjectionInvalidationDependencies & {
  findThreadMessages: typeof prisma.emailMessage.findMany;
};

const defaultRoutedEmailDependencies: RoutedEmailProjectionInvalidationDependencies = {
  ...defaultDependencies,
  findThreadMessages: (args) => prisma.emailMessage.findMany(args),
};

export async function invalidateSupplyStateProjection(
  scope: SupplyStateScope,
  options: { compilerVersion?: string } = {},
  dependencies: ProjectionInvalidationDependencies = defaultDependencies,
) {
  return dependencies.updateMany({
    where: {
      officeId: scope.officeId,
      projectionType: projectionTypeForSupplyStateScope(scope),
      scopeType: scope.type,
      scopeRef: supplyStateScopeRef(scope),
      compilerVersion: options.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION,
      dirtyAt: null,
    },
    data: { dirtyAt: dependencies.now() },
  });
}

export async function invalidateSupplyStateProjections(args: {
  officeId: string;
  workspaceId?: string | null;
  projectionTypes?: SupplyStateProjectionType[];
  scopeTypes?: SupplyStateScope["type"][];
  scopeRefContains?: string;
  compilerVersion?: string;
}, dependencies: ProjectionInvalidationDependencies = defaultDependencies) {
  return dependencies.updateMany({
    where: {
      officeId: args.officeId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      ...(args.projectionTypes?.length ? { projectionType: { in: args.projectionTypes } } : {}),
      ...(args.scopeTypes?.length ? { scopeType: { in: args.scopeTypes } } : {}),
      ...(args.scopeRefContains ? { scopeRef: { contains: args.scopeRefContains } } : {}),
      compilerVersion: args.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION,
      dirtyAt: null,
    },
    data: { dirtyAt: dependencies.now() },
  });
}

export function invalidateCompanyContextStateProjections(args: {
  officeId: string;
  companyId: string;
  compilerVersion?: string;
}) {
  return invalidateSupplyStateProjections({
    officeId: args.officeId,
    projectionTypes: ["company_context_v1"],
    scopeTypes: ["company"],
    scopeRefContains: `company=${encodeURIComponent(args.companyId)};`,
    compilerVersion: args.compilerVersion,
  });
}

export async function invalidateRoutedEmailThreadStateProjections(args: {
  officeId: string;
  companyId: string;
  threadId: string;
  compilerVersion?: string;
}, dependencies: RoutedEmailProjectionInvalidationDependencies = defaultRoutedEmailDependencies) {
  const messages = await dependencies.findThreadMessages({
    where: { threadId: args.threadId, thread: { officeId: args.officeId } },
    orderBy: [{ sentAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      externalId: true,
      gmailMessageId: true,
      rfcMessageId: true,
    },
  });
  const messageIdentities = new Set(messages.flatMap((message) => [
    message.id,
    message.externalId,
    message.gmailMessageId,
    message.rfcMessageId,
  ].filter((value): value is string => Boolean(value))));
  const candidates = await dependencies.findMany({
    where: {
      officeId: args.officeId,
      projectionType: { in: ["procurement_request_v1", "supplier_relationship_v1"] },
      scopeRef: { contains: `company=${encodeURIComponent(args.companyId)};` },
      compilerVersion: args.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION,
      dirtyAt: null,
    },
    select: { id: true, dependencyManifest: true },
  });
  const threadKey = `email.thread:${args.threadId}`;
  const affectedIds = candidates.flatMap((projection) => {
    if (!Array.isArray(projection.dependencyManifest)) return [];
    const linked = projection.dependencyManifest.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const dependency = entry as Record<string, unknown>;
      if (dependency.key === threadKey) return true;
      if (!Array.isArray(dependency.evidenceRefs)) return false;
      return dependency.evidenceRefs.some((reference) => {
        if (!reference || typeof reference !== "object" || Array.isArray(reference)) return false;
        const evidence = reference as Record<string, unknown>;
        return (evidence.kind === "email_message" || evidence.kind === "procurement_message")
          && ((typeof evidence.id === "string" && messageIdentities.has(evidence.id))
            || (typeof evidence.providerMessageId === "string"
              && messageIdentities.has(evidence.providerMessageId)));
      });
    });
    return linked ? [projection.id] : [];
  });
  if (!affectedIds.length) return { count: 0 };
  return dependencies.updateMany({
    where: { officeId: args.officeId, id: { in: affectedIds }, dirtyAt: null },
    data: { dirtyAt: dependencies.now() },
  });
}

export async function invalidateCompanyContextDocumentStateProjections(args: {
  officeId: string;
  companyId: string;
  documentId: string;
  compilerVersion?: string;
}, dependencies: ProjectionInvalidationDependencies = defaultDependencies) {
  const compilerVersion = args.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  const companyResult = await invalidateSupplyStateProjections({
    officeId: args.officeId,
    projectionTypes: ["company_context_v1"],
    scopeTypes: ["company"],
    scopeRefContains: `company=${encodeURIComponent(args.companyId)};`,
    compilerVersion,
  }, dependencies);
  const requestCandidates = await dependencies.findMany({
    where: {
      officeId: args.officeId,
      projectionType: "procurement_request_v1",
      scopeType: "procurement_request",
      scopeRef: { contains: `company=${encodeURIComponent(args.companyId)};` },
      compilerVersion,
      dirtyAt: null,
    },
    select: { id: true, dependencyManifest: true },
  });
  const dependencyKeys = new Set([
    `company.context_document:${args.companyId}:${args.documentId}`,
    // Retain recognition for projections built by an earlier compiler during rollout.
    `company.context_document:${args.documentId}`,
  ]);
  const affectedIds = requestCandidates.flatMap((projection) => (
    Array.isArray(projection.dependencyManifest)
      && projection.dependencyManifest.some((entry) => (
        entry && typeof entry === "object" && !Array.isArray(entry)
          && typeof (entry as Record<string, unknown>).key === "string"
          && dependencyKeys.has((entry as { key: string }).key)
      ))
      ? [projection.id]
      : []
  ));
  const requestResult = affectedIds.length
    ? await dependencies.updateMany({
        where: { officeId: args.officeId, id: { in: affectedIds }, dirtyAt: null },
        data: { dirtyAt: dependencies.now() },
      })
    : { count: 0 };
  return { count: companyResult.count + requestResult.count };
}

export function invalidateWorkspaceStateProjections(args: {
  officeId: string;
  workspaceId: string;
  compilerVersion?: string;
}) {
  return invalidateSupplyStateProjections({
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    projectionTypes: [
      "company_context_v1",
      "procurement_request_v1",
      "supplier_relationship_v1",
      "item_supply_v1",
      "workspace_supply_v1",
    ],
    compilerVersion: args.compilerVersion,
  });
}

// Decision, approval, execution-task, and execution-event writes affect only
// the workspace control projection. Item, supplier, company, and request
// projections keep their independent semantic fingerprints.
export function invalidateWorkspaceControlStateProjection(args: {
  officeId: string;
  workspaceId: string;
  compilerVersion?: string;
}, dependencies: ProjectionInvalidationDependencies = defaultDependencies) {
  return invalidateSupplyStateProjections({
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    projectionTypes: ["workspace_supply_v1"],
    scopeTypes: ["workspace"],
    compilerVersion: args.compilerVersion,
  }, dependencies);
}

export async function invalidateSupplyStateProjectionsByDependency(args: {
  officeId: string;
  workspaceId?: string | null;
  dependencyKeys: string[];
  projectionTypes?: SupplyStateProjectionType[];
  compilerVersion?: string;
}, dependencies: ProjectionInvalidationDependencies = defaultDependencies) {
  const dependencyKeys = [...new Set(args.dependencyKeys.filter(Boolean))];
  if (!dependencyKeys.length) return { count: 0 };
  const candidates = await dependencies.findMany({
    where: {
      officeId: args.officeId,
      ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
      ...(args.projectionTypes?.length ? { projectionType: { in: args.projectionTypes } } : {}),
      compilerVersion: args.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION,
      dirtyAt: null,
    },
    select: { id: true, dependencyManifest: true },
  });
  const keys = new Set(dependencyKeys);
  const affectedIds = candidates.flatMap((projection) => (
    Array.isArray(projection.dependencyManifest)
      && projection.dependencyManifest.some((entry) => (
        entry && typeof entry === "object" && !Array.isArray(entry)
          && typeof (entry as { key?: unknown }).key === "string"
          && keys.has((entry as { key: string }).key)
      ))
      ? [projection.id]
      : []
  ));
  if (!affectedIds.length) return { count: 0 };
  return dependencies.updateMany({
    where: { officeId: args.officeId, id: { in: affectedIds }, dirtyAt: null },
    data: { dirtyAt: dependencies.now() },
  });
}

export function invalidatePublishedSupplySnapshotStateProjections(args: {
  officeId: string;
  workspaceId: string;
  compilerVersion?: string;
}, dependencies: ProjectionInvalidationDependencies = defaultDependencies) {
  return invalidateSupplyStateProjections({
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    projectionTypes: ["item_supply_v1", "workspace_supply_v1"],
    scopeTypes: ["item", "workspace"],
    compilerVersion: args.compilerVersion,
  }, dependencies);
}

export function invalidateSupplierStateProjections(args: {
  officeId: string;
  supplierId?: string | null;
  supplierKey?: string | null;
  workspaceId?: string | null;
  compilerVersion?: string;
}) {
  const identity = args.supplierId
    ? `supplier=${encodeURIComponent(args.supplierId)};`
    : args.supplierKey ? `supplierKey=${encodeURIComponent(args.supplierKey)};` : null;
  if (!identity) throw new Error("Supplier projection invalidation requires an exact supplier identity.");
  return invalidateSupplyStateProjections({
    officeId: args.officeId,
    workspaceId: args.workspaceId,
    projectionTypes: ["supplier_relationship_v1"],
    scopeTypes: ["supplier"],
    scopeRefContains: identity,
    compilerVersion: args.compilerVersion,
  });
}

export function invalidateProcurementRequestStateProjection(scope: Extract<
  SupplyStateScope,
  { type: "procurement_request" }
>, options: { compilerVersion?: string } = {}) {
  return invalidateSupplyStateProjection(scope, options);
}
