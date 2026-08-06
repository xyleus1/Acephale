"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { normalizeCustomerPortalEmail } from "@/lib/customer-portal-security";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import { prisma } from "@/lib/prisma";

const PORTAL_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER"]);
const ACTION_STATUSES = new Set(["ACKNOWLEDGED", "RESOLVED", "REJECTED"]);

async function requirePortalManager() {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    throw new Error("Not authorized.");
  }
  return session;
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

  const company = await prisma.company.findFirst({
    where: { id: companyId, officeId: session.officeId },
    select: { id: true, name: true },
  });
  if (!company) return;

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.customerPortalUser.upsert({
      where: { officeId_email: { officeId: session.officeId, email } },
      create: {
        officeId: session.officeId,
        email,
        fullName,
      },
      update: {
        isActive: true,
        ...(fullName ? { fullName } : {}),
      },
      select: { id: true },
    });
    const membership = await tx.customerPortalMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      create: {
        officeId: session.officeId,
        userId: user.id,
        companyId: company.id,
        role,
      },
      update: {
        officeId: session.officeId,
        role,
        isActive: true,
      },
      select: { id: true },
    });
    return { userId: user.id, membershipId: membership.id };
  });

  await recordMemoryEvent({
    officeId: session.officeId,
    sourceType: "CRM",
    sourceExternalId: `customer_portal_membership:${result.membershipId}`,
    eventType: "customer_portal.access_granted",
    entityType: "company",
    entityId: company.id,
    actorType: "user",
    actorId: session.userId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      companyId: company.id,
      companyName: company.name,
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

  revalidatePath("/dashboard/customer-portal");
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
  revalidatePath("/dashboard/customer-portal");
  revalidatePath("/portal/workspace");
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
  revalidatePath("/dashboard/customer-portal");
  revalidatePath("/portal/workspace");
  if (action.jobId) revalidatePath(`/dashboard/jobs/${action.jobId}`);
}
