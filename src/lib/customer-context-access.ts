import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireSupplyWorkspace,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "@/lib/supply-os/persistence";

export type CustomerContextMembership = {
  id: string;
  companyId: string;
  role: string;
};

export type CustomerContextPrincipal = {
  id: string;
  officeId: string;
  memberships: CustomerContextMembership[];
};

export type CustomerContextAccess = {
  actorType: "CUSTOMER";
  officeId: string;
  portalUserId: string;
  membershipId: string;
  companyId: string;
  membershipRole: string;
};

export type CompanyContextAccess = SupplyAccessContext | CustomerContextAccess;

export function isCustomerContextAccess(
  context: CompanyContextAccess,
): context is CustomerContextAccess {
  return "actorType" in context && context.actorType === "CUSTOMER";
}

export function customerContextCanEditRole(role: string) {
  return role === "ADMIN" || role === "MEMBER";
}

export function selectCustomerContextMembership(
  memberships: CustomerContextMembership[],
  requestedCompanyId?: string | null,
) {
  if (requestedCompanyId) {
    return memberships.find((membership) => membership.companyId === requestedCompanyId) ?? null;
  }
  return memberships[0] ?? null;
}

function accessFromMembership(
  principal: CustomerContextPrincipal,
  membership: CustomerContextMembership,
): CustomerContextAccess {
  return {
    actorType: "CUSTOMER",
    officeId: principal.officeId,
    portalUserId: principal.id,
    membershipId: membership.id,
    companyId: membership.companyId,
    membershipRole: membership.role,
  };
}

function membershipScope(access: CustomerContextAccess): Prisma.CustomerPortalMembershipWhereInput {
  return {
    id: access.membershipId,
    officeId: access.officeId,
    userId: access.portalUserId,
    companyId: access.companyId,
    isActive: true,
    user: { officeId: access.officeId, isActive: true },
    company: { officeId: access.officeId },
  };
}

export async function resolveCustomerContextWorkspace(
  principal: CustomerContextPrincipal,
  requestedCompanyId?: string | null,
) {
  const membership = selectCustomerContextMembership(principal.memberships, requestedCompanyId);
  if (!membership) return null;
  const access = accessFromMembership(principal, membership);
  const workspace = await prisma.supplyWorkspace.findFirst({
    where: {
      officeId: access.officeId,
      companyId: access.companyId,
      status: "ACTIVE",
      company: {
        officeId: access.officeId,
        customerPortalMemberships: { some: membershipScope(access) },
      },
    },
    select: { id: true, officeId: true, companyId: true, name: true },
  });
  return workspace ? { access, workspace } : null;
}

export async function resolveCustomerContextAccessForWorkspace(
  principal: CustomerContextPrincipal,
  workspaceId: string,
) {
  const workspace = await prisma.supplyWorkspace.findFirst({
    where: {
      id: workspaceId,
      officeId: principal.officeId,
      companyId: { not: null },
      status: "ACTIVE",
    },
    select: { companyId: true },
  });
  if (!workspace?.companyId) return null;
  const membership = selectCustomerContextMembership(principal.memberships, workspace.companyId);
  if (!membership) return null;
  const access = accessFromMembership(principal, membership);
  // tenant-scope:ignore membershipScope includes officeId, portal user, company, active user, and company office.
  const currentMembership = await prisma.customerPortalMembership.findFirst({
    where: membershipScope(access),
    select: { role: true },
  });
  return currentMembership ? { ...access, membershipRole: currentMembership.role } : null;
}

export async function requireCompanyContextWorkspace(
  context: CompanyContextAccess,
  workspaceId: string,
  mode: "view" | "edit",
) {
  if (!isCustomerContextAccess(context)) {
    return requireSupplyWorkspace(context, workspaceId, mode);
  }

  const membership = await prisma.customerPortalMembership.findFirst({
    where: membershipScope(context),
    select: { role: true },
  });
  if (!membership) {
    throw new SupplyPersistenceError("Supply workspace not found.", "not_found");
  }
  if (mode === "edit" && !customerContextCanEditRole(membership.role)) {
    throw new SupplyPersistenceError("You cannot edit this supply workspace.", "forbidden");
  }

  const workspace = await prisma.supplyWorkspace.findFirst({
    where: {
      id: workspaceId,
      officeId: context.officeId,
      companyId: context.companyId,
      status: "ACTIVE",
    },
  });
  if (!workspace) {
    throw new SupplyPersistenceError("Supply workspace not found.", "not_found");
  }
  return workspace;
}

export function companyContextVisibilityWhere(
  context: CompanyContextAccess,
): Prisma.CompanyContextWhereInput {
  return isCustomerContextAccess(context) ? { customerVisible: true } : {};
}

export function companyContextActorWhere(
  context: CompanyContextAccess,
): Prisma.CompanyContextWhereInput {
  return isCustomerContextAccess(context)
    ? { createdByPortalUserId: context.portalUserId }
    : { createdByUserId: context.userId };
}

export function companyContextActorData(context: CompanyContextAccess) {
  return isCustomerContextAccess(context)
    ? {
        createdByUserId: null,
        createdByPortalUserId: context.portalUserId,
        customerVisible: true,
      }
    : {
        createdByUserId: context.userId,
        createdByPortalUserId: null,
        customerVisible: false,
      };
}
