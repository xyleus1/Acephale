import "server-only";

import {
  isRemovedCustomerUsername,
  removedCustomerEmail,
  removedCustomerUsername,
} from "@/lib/customer-portal-account";
import { prisma } from "@/lib/prisma";

export type CustomerPortalAccountAdminErrorCode = "not_found" | "conflict";

export class CustomerPortalAccountAdminError extends Error {
  constructor(
    message: string,
    readonly code: CustomerPortalAccountAdminErrorCode,
  ) {
    super(message);
    this.name = "CustomerPortalAccountAdminError";
  }
}

export function customerPortalAccountAdminLockKey(officeId: string, userId: string) {
  return `customer-portal-account-admin:${officeId}:${userId}`;
}

export async function updateCustomerPortalAccountRecord(args: {
  officeId: string;
  userId: string;
  companyId: string;
  username: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
  passwordHash: string | null;
  passwordEncrypted: string | null;
  now?: Date;
}) {
  const passwordReset = Boolean(args.passwordHash && args.passwordEncrypted);
  if (Boolean(args.passwordHash) !== Boolean(args.passwordEncrypted)) {
    throw new CustomerPortalAccountAdminError("Password data is incomplete.", "conflict");
  }
  const now = args.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${customerPortalAccountAdminLockKey(args.officeId, args.userId)}, 0))
    `;
    const [user, company, emailOwner, usernameOwner] = await Promise.all([
      tx.customerPortalUser.findFirst({
        where: {
          id: args.userId,
          officeId: args.officeId,
          memberships: { some: { companyId: args.companyId, officeId: args.officeId } },
        },
        select: {
          id: true,
          internalUserId: true,
          username: true,
          email: true,
          fullName: true,
          isActive: true,
        },
      }),
      tx.company.findFirst({
        where: {
          id: args.companyId,
          officeId: args.officeId,
          crmStage: { not: "archived" },
        },
        select: { id: true, name: true },
      }),
      tx.customerPortalUser.findFirst({
        where: { officeId: args.officeId, email: args.email, id: { not: args.userId } },
        select: { id: true },
      }),
      tx.customerPortalUser.findFirst({
        where: { officeId: args.officeId, username: args.username, id: { not: args.userId } },
        select: { id: true },
      }),
    ]);
    if (!user || !company || isRemovedCustomerUsername(user.username)) {
      throw new CustomerPortalAccountAdminError("Customer account was not found.", "not_found");
    }
    if (emailOwner || usernameOwner) {
      throw new CustomerPortalAccountAdminError("Customer account identity is already in use.", "conflict");
    }

    const fullName = args.fullName || company.name;
    const identityChanged = user.username !== args.username || user.email !== args.email;
    const revokeSessions = passwordReset || identityChanged || user.isActive !== args.isActive;
    const updated = await tx.customerPortalUser.updateMany({
      where: {
        id: user.id,
        officeId: args.officeId,
        memberships: { some: { companyId: args.companyId, officeId: args.officeId } },
      },
      data: {
        username: args.username,
        email: args.email,
        fullName,
        isActive: args.isActive,
        ...(revokeSessions ? { passwordVersion: { increment: 1 } } : {}),
        ...(passwordReset ? {
          passwordHash: args.passwordHash,
          passwordEncrypted: args.passwordEncrypted,
          passwordUpdatedAt: now,
          failedLoginAttempts: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
        } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new CustomerPortalAccountAdminError("Customer account was not found.", "not_found");
    }
    if (user.internalUserId) {
      await tx.user.updateMany({
        where: { id: user.internalUserId, officeId: args.officeId },
        data: { fullName, isActive: args.isActive },
      });
    }
    if (
      user.username !== args.username
      || user.email !== args.email
      || user.isActive !== args.isActive
      || passwordReset
    ) {
      await tx.customerPortalLoginCode.updateMany({
        where: {
          userId: user.id,
          officeId: args.officeId,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
    }

    return {
      userId: user.id,
      previousEmail: user.email,
      previousUsername: user.username,
      previousFullName: user.fullName,
      previousIsActive: user.isActive,
      email: args.email,
      username: args.username,
      fullName,
      isActive: args.isActive,
      passwordReset,
    };
  });
}

export async function removeCustomerPortalAccountRecord(args: {
  officeId: string;
  userId: string;
  companyId: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${customerPortalAccountAdminLockKey(args.officeId, args.userId)}, 0))
    `;
    const user = await tx.customerPortalUser.findFirst({
      where: {
        id: args.userId,
        officeId: args.officeId,
        memberships: { some: { companyId: args.companyId, officeId: args.officeId } },
      },
      select: {
        id: true,
        internalUserId: true,
        email: true,
        username: true,
        memberships: {
          where: { officeId: args.officeId },
          select: {
            company: {
              select: {
                supplyWorkspaces: {
                  where: { officeId: args.officeId },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user || isRemovedCustomerUsername(user.username)) {
      throw new CustomerPortalAccountAdminError("Customer account was not found.", "not_found");
    }

    const workspaceIds = [...new Set(user.memberships.flatMap((membership) => (
      membership.company.supplyWorkspaces.map((workspace) => workspace.id)
    )))];
    await tx.customerPortalMembership.updateMany({
      where: { officeId: args.officeId, userId: user.id },
      data: { isActive: false },
    });
    if (user.internalUserId && workspaceIds.length > 0) {
      await tx.supplyWorkspaceMember.updateMany({
        where: {
          officeId: args.officeId,
          userId: user.internalUserId,
          workspaceId: { in: workspaceIds },
        },
        data: { isActive: false },
      });
    }
    if (user.internalUserId) {
      await tx.user.updateMany({
        where: { id: user.internalUserId, officeId: args.officeId },
        data: { isActive: false, fullName: "Removed customer user" },
      });
    }
    await tx.customerPortalLoginCode.updateMany({
      where: { officeId: args.officeId, userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    });
    const removed = await tx.customerPortalUser.updateMany({
      where: { id: user.id, officeId: args.officeId },
      data: {
        username: removedCustomerUsername(user.id),
        email: removedCustomerEmail(user.id),
        fullName: "Removed customer user",
        isActive: false,
        passwordHash: null,
        passwordEncrypted: null,
        passwordVersion: { increment: 1 },
        passwordUpdatedAt: null,
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
      },
    });
    if (removed.count !== 1) {
      throw new CustomerPortalAccountAdminError("Customer account was not found.", "not_found");
    }

    return {
      userId: user.id,
      previousEmail: user.email,
      previousUsername: user.username,
      workspaceIds,
    };
  });
}
