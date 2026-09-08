import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getProcurementRequest,
  getProcurementWorkflowAccount,
  procurementCustomerIdFromServerMetadata,
  type ProcurementWorkflowAccountLookup,
} from "@/lib/procurement-workflow";
import type { SupplyStateScope } from "@/lib/supply-os/state-runtime/types";

type ScopeOwnershipDependencies = {
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findCompany: typeof prisma.company.findFirst;
  findItem: typeof prisma.item.findFirst;
  findWorkflowAccount: ProcurementWorkflowAccountLookup;
  resolveCustomerId: typeof procurementCustomerIdFromServerMetadata;
  getRequest: typeof getProcurementRequest;
};

const defaultDependencies: ScopeOwnershipDependencies = {
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findCompany: (args) => prisma.company.findFirst(args),
  findItem: (args) => prisma.item.findFirst(args),
  findWorkflowAccount: getProcurementWorkflowAccount,
  resolveCustomerId: procurementCustomerIdFromServerMetadata,
  getRequest: getProcurementRequest,
};

export class SupplyStateScopeOwnershipError extends Error {
  readonly code = "scope_ownership_mismatch" as const;

  constructor(message: string) {
    super(message);
    this.name = "SupplyStateScopeOwnershipError";
  }
}

function scopedWorkspaceId(scope: SupplyStateScope) {
  if (scope.type === "workspace" || scope.type === "item") return scope.workspaceId;
  return "workspaceId" in scope ? scope.workspaceId ?? null : null;
}

function scopedCompanyId(scope: SupplyStateScope) {
  if (scope.type === "company" || scope.type === "procurement_request" || scope.type === "item") {
    return scope.companyId;
  }
  return scope.type === "supplier" ? scope.companyId ?? null : null;
}

// This guard runs before projection lookup as well as live compilation. It reads
// app-owned workspace and workflow-account ownership. Full order/vendor
// consistency remains enforced through the workflow access boundary reader.
export async function assertSupplyStateScopeOwnership(
  scope: SupplyStateScope,
  dependencies: ScopeOwnershipDependencies = defaultDependencies,
) {
  const workspaceId = scopedWorkspaceId(scope);
  const companyId = scopedCompanyId(scope);
  const [workspace, company, item] = await Promise.all([
    workspaceId ? dependencies.findWorkspace({
        where: { id: workspaceId, officeId: scope.officeId },
        select: { id: true, companyId: true },
      }) : Promise.resolve(null),
    companyId ? dependencies.findCompany({
        where: { id: companyId, officeId: scope.officeId },
        select: { id: true },
      }) : Promise.resolve(null),
    scope.type === "item" && scope.itemId ? dependencies.findItem({
        where: {
          id: scope.itemId,
          officeId: scope.officeId,
          companyId: scope.companyId,
        },
        select: { id: true },
      }) : Promise.resolve(null),
  ]);
  if (workspaceId && !workspace) {
    throw new SupplyStateScopeOwnershipError("Supply state scope workspace does not belong to its office.");
  }
  if (companyId && !company) {
    throw new SupplyStateScopeOwnershipError("Supply state scope company does not belong to its office.");
  }
  if (workspace && companyId && workspace.companyId !== companyId) {
    throw new SupplyStateScopeOwnershipError("Supply state scope workspace ownership does not match its company.");
  }
  if (scope.type === "item" && scope.itemId && !item) {
    throw new SupplyStateScopeOwnershipError("Supply state scope item does not belong to its office and company.");
  }
  if (scope.type === "procurement_request") {
    const account = await dependencies.findWorkflowAccount({
      customerId: scope.customerId,
      officeId: scope.officeId,
      companyId: scope.companyId,
    });
    if (
      !account
      || account.id !== scope.customerId
      || account.officeId !== scope.officeId
      || account.companyId !== scope.companyId
    ) {
      throw new SupplyStateScopeOwnershipError("Supply state scope workflow customer ownership does not match its company.");
    }
  }
  if (scope.type === "supplier" && scope.orderId && scope.vendorId) {
    const customerId = dependencies.resolveCustomerId(scope.officeId);
    const account = await dependencies.findWorkflowAccount({
      customerId,
      officeId: scope.officeId,
      companyId: companyId ?? workspace?.companyId ?? null,
    });
    const expectedCompanyId = companyId ?? workspace?.companyId ?? null;
    if (
      !account
      || account.id !== customerId
      || account.officeId !== scope.officeId
      || (expectedCompanyId && account.companyId !== expectedCompanyId)
    ) {
      throw new SupplyStateScopeOwnershipError("Supply state supplier workflow ownership does not match its app scope.");
    }
    if (scope.supplierId) {
      const request = await dependencies.getRequest(customerId, scope.orderId);
      const vendor = request?.vendors.find((candidate) => candidate.id === scope.vendorId) ?? null;
      if (!vendor || vendor.supplierRegistryId !== scope.supplierId) {
        throw new SupplyStateScopeOwnershipError(
          "Supply state request vendor is not linked to its scoped canonical supplier.",
        );
      }
    }
  }
}
