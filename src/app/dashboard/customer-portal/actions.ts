"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { encryptCustomerPassword } from "@/lib/customer-password-vault";
import {
  customerPortalUsernameIsAllowed,
  managedCustomerEmail,
} from "@/lib/customer-portal-account";
import {
  CustomerPortalAccountAdminError,
  removeCustomerPortalAccountRecord,
  updateCustomerPortalAccountRecord,
} from "@/lib/customer-portal-account-admin";
import { requireCustomerManagementOperator } from "@/lib/customer-portal-admin-auth";
import {
  normalizeCustomerPortalEmail,
  normalizeCustomerPortalUsername,
} from "@/lib/customer-portal-security";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import { hashPassword } from "@/lib/password";
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
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

function customerSettingsUrl(notice: string, companyId?: string | null): Route {
  const params = new URLSearchParams({ notice });
  if (companyId) params.set("company", companyId);
  return `${CUSTOMER_SETTINGS_PATH}?${params.toString()}` as Route;
}

function hasPrismaCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function requirePortalManager() {
  const session = await requireSession();
  const currentUser = await requireCustomerManagementOperator(session, ["ADMIN", "MANAGER"]);
  return { ...session, ...currentUser };
}

async function requireCompanyAdmin() {
  const session = await requireSession();
  const currentUser = await requireCustomerManagementOperator(session, ["ADMIN"]);
  return { ...session, ...currentUser };
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
  let companyId: string | null = null;
  try {
    const result = await createSupplyCustomerWorkspace(supplyAccessContext(session), {
      name: String(formData.get("name") ?? ""),
      website: String(formData.get("website") ?? "") || null,
    });
    companyId = result.company.id;
  } catch (error) {
    notice = companyErrorNotice(error);
  }
  refreshCustomerManagement();
  redirect(customerSettingsUrl(notice, companyId));
}

export async function updateCustomerCompany(workspaceId: string, formData: FormData): Promise<void> {
  const session = await requireCompanyAdmin();
  const companyId = String(formData.get("companyId") ?? "").trim() || null;
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
  redirect(customerSettingsUrl(notice, companyId));
}

export async function archiveCustomerCompany(workspaceId: string, formData: FormData): Promise<void> {
  const session = await requireCompanyAdmin();
  const companyId = String(formData.get("companyId") ?? "").trim() || null;
  if (String(formData.get("confirmArchive") ?? "") !== "ARCHIVE") {
    redirect(customerSettingsUrl("confirm-company-archive", companyId));
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
  const session = await requireCompanyAdmin();
  const companyId = String(formData.get("companyId") ?? "").trim();
  const username = normalizeCustomerPortalUsername(String(formData.get("username") ?? ""));
  const providedEmail = normalizeCustomerPortalEmail(String(formData.get("email") ?? ""));
  const email = providedEmail || managedCustomerEmail(username);
  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 160) || null;
  const requestedRole = String(formData.get("role") ?? "MEMBER").toUpperCase();
  const role = PORTAL_ROLES.has(requestedRole) ? requestedRole : "MEMBER";
  const password = String(formData.get("password") ?? "");
  if (
    !companyId
    || !customerPortalUsernameIsAllowed(username)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    redirect(customerSettingsUrl("invalid-account", companyId));
  }
  if (password && (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH)) {
    redirect(customerSettingsUrl("invalid-password", companyId));
  }

  const passwordHash = password ? await hashPassword(password) : null;
  const passwordEncrypted = password ? encryptCustomerPassword(password) : null;
  let result;
  try {
    result = await grantSupplyCustomerPortalAccess({
      officeId: session.officeId,
      companyId,
      username,
      email,
      fullName,
      role,
      passwordHash,
      passwordEncrypted,
      existingUser: "reject",
    });
  } catch (error) {
    if (hasPrismaCode(error, "P2002") || (error instanceof SupplyPersistenceError && error.code === "conflict")) {
      redirect(customerSettingsUrl("account-exists", companyId));
    }
    throw error;
  }
  if (!result) redirect(customerSettingsUrl("company-not-found", companyId));

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
      username,
      role,
      passwordReset: Boolean(passwordHash),
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
  revalidatePath("/portal");
  revalidatePath("/portal/workspace");
  redirect(customerSettingsUrl(passwordHash ? "account-created" : "account-created-no-password", companyId));
}

export async function revokeCustomerPortalAccess(membershipId: string): Promise<void> {
  const session = await requirePortalManager();
  const membership = await prisma.customerPortalMembership.findFirst({
    where: { id: membershipId, officeId: session.officeId },
    select: {
      id: true,
      userId: true,
      companyId: true,
      user: { select: { email: true, internalUserId: true } },
      company: {
        select: {
          supplyWorkspaces: {
            where: { officeId: session.officeId, status: "ACTIVE" },
            select: { id: true },
          },
        },
      },
    },
  });
  if (!membership) return;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.customerPortalMembership.updateMany({
      where: { id: membership.id, officeId: session.officeId, isActive: true },
      data: { isActive: false },
    });
    if (updated.count > 0) {
      await tx.customerPortalUser.updateMany({
        where: { id: membership.userId, officeId: session.officeId },
        data: { passwordVersion: { increment: 1 } },
      });
      if (membership.user.internalUserId) {
        await tx.supplyWorkspaceMember.updateMany({
          where: {
            officeId: session.officeId,
            userId: membership.user.internalUserId,
            workspaceId: { in: membership.company.supplyWorkspaces.map((workspace) => workspace.id) },
          },
          data: { isActive: false },
        });
      }
    }
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

export async function updateCustomerPortalAccount(
  userId: string,
  companyId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireCompanyAdmin();
  const username = normalizeCustomerPortalUsername(String(formData.get("username") ?? ""));
  const providedEmail = normalizeCustomerPortalEmail(String(formData.get("email") ?? ""));
  const email = providedEmail || managedCustomerEmail(username);
  const requestedFullName = String(formData.get("fullName") ?? "").trim().slice(0, 160);
  const accountStatus = String(formData.get("accountStatus") ?? "").toUpperCase();
  const isActive = accountStatus === "ACTIVE";
  const password = String(formData.get("password") ?? "");
  if (
    !customerPortalUsernameIsAllowed(username)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !ENABLED_STATUSES.has(accountStatus)
  ) {
    redirect(customerSettingsUrl("invalid-account", companyId));
  }
  if (password && (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH)) {
    redirect(customerSettingsUrl("invalid-password", companyId));
  }

  const passwordHash = password ? await hashPassword(password) : null;
  const passwordEncrypted = password ? encryptCustomerPassword(password) : null;
  let result;
  try {
    result = await updateCustomerPortalAccountRecord({
      officeId: session.officeId,
      userId,
      companyId,
      username,
      email,
      fullName: requestedFullName || null,
      isActive,
      passwordHash,
      passwordEncrypted,
    });
  } catch (error) {
    if (hasPrismaCode(error, "P2002") || (error instanceof CustomerPortalAccountAdminError && error.code === "conflict")) {
      redirect(customerSettingsUrl("account-in-use", companyId));
    }
    if (error instanceof CustomerPortalAccountAdminError && error.code === "not_found") {
      redirect(customerSettingsUrl("account-not-found", companyId));
    }
    throw error;
  }

  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "CRM",
    sourceExternalId: `customer_portal_user:${result.userId}`,
    eventType: "customer_portal.account_updated",
    entityType: "customer_portal_user",
    entityId: result.userId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      portalUserId: result.userId,
      previousEmail: result.previousEmail,
      email: result.email,
      previousUsername: result.previousUsername,
      username: result.username,
      previousFullName: result.previousFullName,
      fullName: result.fullName,
      previousIsActive: result.previousIsActive,
      isActive: result.isActive,
      passwordReset: result.passwordReset,
    },
    provenance: {
      source: "customer_portal_admin",
      operation: "update_account",
      path: "src/app/dashboard/customer-portal/actions.ts",
      function: "updateCustomerPortalAccount",
      sourceRecordId: result.userId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `customer_portal_user:${result.userId}:update:${Date.now()}`,
  }).catch(() => null);

  refreshCustomerManagement();
  revalidatePath("/portal");
  revalidatePath("/portal/workspace");
  redirect(customerSettingsUrl("account-updated", companyId));
}

export async function removeCustomerPortalAccount(
  userId: string,
  companyId: string,
  formData: FormData,
): Promise<void> {
  const session = await requireCompanyAdmin();
  if (String(formData.get("confirmRemove") ?? "") !== "REMOVE") {
    redirect(customerSettingsUrl("confirm-account-remove", companyId));
  }

  let result;
  try {
    result = await removeCustomerPortalAccountRecord({
      officeId: session.officeId,
      userId,
      companyId,
    });
  } catch (error) {
    if (error instanceof CustomerPortalAccountAdminError && error.code === "not_found") {
      redirect(customerSettingsUrl("account-not-found", companyId));
    }
    throw error;
  }

  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "CRM",
    sourceExternalId: `customer_portal_user:${result.userId}`,
    eventType: "customer_portal.account_removed",
    entityType: "customer_portal_user",
    entityId: result.userId,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      portalUserId: result.userId,
      companyId,
      previousEmail: result.previousEmail,
      previousUsername: result.previousUsername,
    },
    provenance: {
      source: "customer_portal_admin",
      operation: "remove_account",
      path: "src/app/dashboard/customer-portal/actions.ts",
      function: "removeCustomerPortalAccount",
      sourceRecordId: result.userId,
      actorType: "user",
      actorId: session.userId,
    },
    idempotencyKey: `customer_portal_user:${result.userId}:remove:${Date.now()}`,
  }).catch(() => null);

  refreshCustomerManagement();
  revalidatePath("/portal");
  revalidatePath("/portal/workspace");
  redirect(customerSettingsUrl("account-removed", companyId));
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
      user: { select: { email: true, internalUserId: true } },
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
    redirect(customerSettingsUrl("archived-company-access", membership.companyId));
  }

  const accessChanged = membership.role !== role || membership.isActive !== isActive;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.customerPortalMembership.updateMany({
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
    if (result.count > 0 && accessChanged) {
      await tx.customerPortalUser.updateMany({
        where: { id: membership.userId, officeId: session.officeId },
        data: { passwordVersion: { increment: 1 } },
      });
      const internalUserId = membership.user.internalUserId;
      const workspaceId = membership.company.supplyWorkspaces[0]?.id;
      if (internalUserId && workspaceId) {
        const workspaceRole = role === "ADMIN" ? "OWNER" : role === "VIEWER" ? "VIEWER" : "EDITOR";
        await tx.supplyWorkspaceMember.upsert({
          where: { workspaceId_userId: { workspaceId, userId: internalUserId } },
          create: {
            officeId: session.officeId,
            workspaceId,
            userId: internalUserId,
            role: workspaceRole,
            isActive,
          },
          update: { role: workspaceRole, isActive },
        });
      }
    }
    return result;
  });
  if (updated.count === 0) redirect(customerSettingsUrl("archived-company-access", membership.companyId));
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
  redirect(customerSettingsUrl("access-updated", membership.companyId));
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
