"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { normalizeCustomerPortalEmail } from "@/lib/customer-portal-security";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import { prisma } from "@/lib/prisma";
import {
  archiveSupplyCustomerWorkspace,
  createSupplyCustomerWorkspace,
  grantSupplyCustomerPortalAccess,
  updateSupplyCustomerWorkspace,
} from "@/lib/supply-os/customer-workspace";
import { supplyAccessContext } from "@/lib/supply-os/http";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";

const PORTAL_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER"]);
const ACTION_STATUSES = new Set(["ACKNOWLEDGED", "RESOLVED", "REJECTED"]);
const ENABLED_STATUSES = new Set(["ACTIVE", "DISABLED"]);
const CUSTOMER_SETTINGS_PATH = "/dashboard/settings/customers";

function customerSettingsUrl(notice: string): Route {
  return `${CUSTOMER_SETTINGS_PATH}?notice=${encodeURIComponent(notice)}` as Route;
}

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function requirePortalManager() {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    throw new Error("Not authorized.");
  }
  return session;
}

async function requireCompanyAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new Error("Not authorized.");
  return session;
}

function companyErrorNotice(error: unknown) {
  if (!(error instanceof SupplyPersistenceError)) return "company-error";
  if (error.code === "conflict") return "company-conflict";
  if (error.code === "not_found") return "company-not-found";
  return "invalid-company";
}

function refreshCustomerManagement() {
  revalidatePath(CUSTOMER_SETTINGS_PATH);
  revalidatePath("/dashboard/customer-portal");
  revalidatePath("/dashboard/supply-os");
}

export async function createCustomerCompany(formData: FormData): Promise<void> {
  const session = await requireCompanyAdmin();
  let notice = "company-created";
  try {
    await createSupplyCustomerWorkspace(supplyAccessContext(session), {
      name: String(formData.get("name") ?? ""),
      website: String(formData.get("website") ?? "") || null,
    });
  } catch (error) {
    notice = companyErrorNotice(error);
  }
  refreshCustomerManagement();
  redirect(customerSettingsUrl(notice));
}

export async function updateCustomerCompany(workspaceId: string, formData: FormData): Promise<void> {
  const session = await requireCompanyAdmin();
  let notice = "company-updated";
  try {
    await updateSupplyCustomerWorkspace(supplyAccessContext(session), workspaceId, {
      name: String(formData.get("name") ?? ""),
      website: String(formData.get("website") ?? "") || null,
    });
  } catch (error) {
    notice = companyErrorNotice(error);
  }
  refreshCustomerManagement();
  redirect(customerSettingsUrl(notice));
}

export async function archiveCustomerCompany(workspaceId: string, formData: FormData): Promise<void> {
  const session = await requireCompanyAdmin();
  if (String(formData.get("confirmArchive") ?? "") !== "ARCHIVE") {
    redirect(customerSettingsUrl("confirm-company-archive"));
  }
  let notice = "company-archived";
  try {
    await archiveSupplyCustomerWorkspace(supplyAccessContext(session), workspaceId);
  } catch (error) {
    notice = companyErrorNotice(error);
  }
  refreshCustomerManagement();
  revalidatePath("/portal/workspace");
  redirect(customerSettingsUrl(notice));
}

export async function grantCustomerPortalAccess(formData: FormData): Promise<void> {
  const session = await requirePortalManager();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const email = normalizeCustomerPortalEmail(String(formData.get("email") ?? ""));
  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 160) || null;
  const requestedRole = String(formData.get("role") ?? "MEMBER").toUpperCase();
  const role = PORTAL_ROLES.has(requestedRole) ? requestedRole : "MEMBER";
  if (!companyId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return;
  }

  const result = await grantSupplyCustomerPortalAccess({
    officeId: session.officeId,
    companyId,
    email,
    fullName,
    role,
  });
  if (!result) return;

  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "CRM",
    sourceExternalId: `customer_portal_membership:${result.membershipId}`,
    eventType: "customer_portal.access_granted",
    entityType: "company",
    entityId: result.company.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      companyId: result.company.id,
      companyName: result.company.name,
      portalUserId: result.userId,
      membershipId: result.membershipId,
      email,
      role,
    },
    provenance: {
      source: "customer_portal_admin",
      operation: "grant_access",
      path: "src/app/dashboard/customer-portal/actions.ts",
      function: "grantCustomerPortalAccess",
      sourceRecordId: result.membershipId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `customer_portal_membership:${result.membershipId}:grant:${Date.now()}`,
  }).catch(() => null);

  refreshCustomerManagement();
}

export async function revokeCustomerPortalAccess(membershipId: string): Promise<void> {
  const session = await requirePortalManager();
  const membership = await prisma.customerPortalMembership.findFirst({
    where: { id: membershipId, officeId: session.officeId },
    select: {
      id: true,
      userId: true,
      companyId: true,
      user: { select: { email: true } },
    },
  });
  if (!membership) return;

  await prisma.customerPortalMembership.updateMany({
    where: { id: membership.id, officeId: session.officeId },
    data: { isActive: false },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "CRM",
    sourceExternalId: `customer_portal_membership:${membership.id}`,
    eventType: "customer_portal.access_revoked",
    entityType: "company",
    entityId: membership.companyId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      companyId: membership.companyId,
      portalUserId: membership.userId,
      membershipId: membership.id,
      email: membership.user.email,
    },
    provenance: {
      source: "customer_portal_admin",
      operation: "revoke_access",
      path: "src/app/dashboard/customer-portal/actions.ts",
      function: "revokeCustomerPortalAccess",
      sourceRecordId: membership.id,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `customer_portal_membership:${membership.id}:revoke:${Date.now()}`,
  }).catch(() => null);
  refreshCustomerManagement();
  revalidatePath("/portal/workspace");
}

export async function updateCustomerPortalAccount(userId: string, formData: FormData): Promise<void> {
  const session = await requirePortalManager();
  const email = normalizeCustomerPortalEmail(String(formData.get("email") ?? ""));
  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 160) || null;
  const accountStatus = String(formData.get("accountStatus") ?? "").toUpperCase();
  const isActive = accountStatus === "ACTIVE";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !ENABLED_STATUSES.has(accountStatus)) {
    redirect(customerSettingsUrl("invalid-account"));
  }

  const [user, emailOwner] = await Promise.all([
    prisma.customerPortalUser.findFirst({
      where: { id: userId, officeId: session.officeId },
      select: { id: true, email: true, fullName: true, isActive: true },
    }),
    prisma.customerPortalUser.findFirst({
      where: { officeId: session.officeId, email, id: { not: userId } },
      select: { id: true },
    }),
  ]);
  if (!user) redirect(customerSettingsUrl("account-not-found"));
  if (emailOwner) redirect(customerSettingsUrl("email-in-use"));

  const updateAccount = prisma.customerPortalUser.updateMany({
    where: { id: user.id, officeId: session.officeId },
    data: { email, fullName, isActive },
  });
  try {
    if (user.email !== email || user.isActive !== isActive) {
      await prisma.$transaction([
        updateAccount,
        prisma.customerPortalLoginCode.updateMany({
          where: {
            userId: user.id,
            officeId: session.officeId,
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        }),
      ]);
    } else {
      await updateAccount;
    }
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) {
      redirect(customerSettingsUrl("email-in-use"));
    }
    throw error;
  }

  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "CRM",
    sourceExternalId: `customer_portal_user:${user.id}`,
    eventType: "customer_portal.account_updated",
    entityType: "customer_portal_user",
    entityId: user.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      portalUserId: user.id,
      previousEmail: user.email,
      email,
      previousFullName: user.fullName,
      fullName,
      previousIsActive: user.isActive,
      isActive,
    },
    provenance: {
      source: "customer_portal_admin",
      operation: "update_account",
      path: "src/app/dashboard/customer-portal/actions.ts",
      function: "updateCustomerPortalAccount",
      sourceRecordId: user.id,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `customer_portal_user:${user.id}:update:${Date.now()}`,
  }).catch(() => null);

  refreshCustomerManagement();
  revalidatePath("/portal");
  revalidatePath("/portal/workspace");
  redirect(customerSettingsUrl("account-updated"));
}

export async function updateCustomerPortalMembership(
  membershipId: string,
  formData: FormData,
): Promise<void> {
  const session = await requirePortalManager();
  const requestedRole = String(formData.get("role") ?? "MEMBER").toUpperCase();
  const accessStatus = String(formData.get("accessStatus") ?? "").toUpperCase();
  if (!PORTAL_ROLES.has(requestedRole) || !ENABLED_STATUSES.has(accessStatus)) {
    redirect(customerSettingsUrl("invalid-access"));
  }
  const role = requestedRole;
  const isActive = accessStatus === "ACTIVE";
  const membership = await prisma.customerPortalMembership.findFirst({
    where: { id: membershipId, officeId: session.officeId },
    select: {
      id: true,
      userId: true,
      companyId: true,
      role: true,
      isActive: true,
      user: { select: { email: true } },
      company: {
        select: {
          name: true,
          crmStage: true,
          supplyWorkspaces: {
            where: { officeId: session.officeId, status: "ACTIVE" },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!membership) redirect(customerSettingsUrl("access-not-found"));
  if (
    isActive
    && (membership.company.crmStage === "archived" || membership.company.supplyWorkspaces.length === 0)
  ) {
    redirect(customerSettingsUrl("archived-company-access"));
  }

  const updated = await prisma.customerPortalMembership.updateMany({
    where: {
      id: membership.id,
      officeId: session.officeId,
      ...(isActive ? {
        company: {
          officeId: session.officeId,
          crmStage: { not: "archived" },
          supplyWorkspaces: {
            some: { officeId: session.officeId, status: "ACTIVE" },
          },
        },
      } : {}),
    },
    data: { role, isActive },
  });
  if (updated.count === 0) redirect(customerSettingsUrl("archived-company-access"));
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "CRM",
    sourceExternalId: `customer_portal_membership:${membership.id}`,
    eventType: "customer_portal.access_updated",
    entityType: "company",
    entityId: membership.companyId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      companyId: membership.companyId,
      companyName: membership.company.name,
      portalUserId: membership.userId,
      membershipId: membership.id,
      email: membership.user.email,
      previousRole: membership.role,
      role,
      previousIsActive: membership.isActive,
      isActive,
    },
    provenance: {
      source: "customer_portal_admin",
      operation: "update_access",
      path: "src/app/dashboard/customer-portal/actions.ts",
      function: "updateCustomerPortalMembership",
      sourceRecordId: membership.id,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `customer_portal_membership:${membership.id}:update:${Date.now()}`,
  }).catch(() => null);

  refreshCustomerManagement();
  revalidatePath("/portal/workspace");
  redirect(customerSettingsUrl("access-updated"));
}

export async function reviewCustomerPortalAction(actionId: string, nextStatus: string): Promise<void> {
  const session = await requirePortalManager();
  if (!ACTION_STATUSES.has(nextStatus)) return;
  const action = await prisma.customerPortalAction.findFirst({
    where: { id: actionId, officeId: session.officeId },
    select: {
      id: true,
      companyId: true,
      jobId: true,
      inquiryId: true,
      portalUserId: true,
      type: true,
      status: true,
    },
  });
  if (!action) return;

  await prisma.customerPortalAction.updateMany({
    where: { id: action.id, officeId: session.officeId },
    data: { status: nextStatus },
  });
  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: action.jobId ? "JOB" : action.inquiryId ? "INQUIRY" : "CRM",
    sourceExternalId: `customer_portal_action:${action.id}`,
    eventType: "customer_portal.action_reviewed",
    entityType: action.jobId ? "job" : action.inquiryId ? "rfq" : "company",
    entityId: action.jobId ?? action.inquiryId ?? action.companyId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      actionId: action.id,
      actionType: action.type,
      portalUserId: action.portalUserId,
      previousStatus: action.status,
      nextStatus,
      operationalStatusChanged: false,
    },
    provenance: {
      source: "customer_portal_admin",
      operation: "review_action",
      path: "src/app/dashboard/customer-portal/actions.ts",
      function: "reviewCustomerPortalAction",
      sourceRecordId: action.id,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `customer_portal_action:${action.id}:review:${nextStatus}:${Date.now()}`,
  }).catch(() => null);
  refreshCustomerManagement();
  revalidatePath("/portal/workspace");
  if (action.jobId) revalidatePath(`/dashboard/jobs/${action.jobId}`);
}
