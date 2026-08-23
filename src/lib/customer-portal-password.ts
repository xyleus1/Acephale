import "server-only";

import {
  normalizeCustomerPortalEmail,
  type CustomerPortalSessionPayload,
} from "@/lib/customer-portal-security";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

const DUMMY_CUSTOMER_PASSWORD_HASH = "customer-portal-dummy-salt:1bf0e717add5182c457e2d3939058aa1e2db742d82ee44201b25f7eb62fd64ba9a43908e4b978823fe74ccc3e01a938975de1e8a078df4b9ac3b78eeeac99698";
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

async function findPortalUser(email: string, officeId?: string | null) {
  const users = await prisma.customerPortalUser.findMany({
    where: {
      email,
      isActive: true,
      ...(officeId ? { officeId } : {}),
      memberships: {
        some: {
          isActive: true,
          ...(officeId ? { officeId } : {}),
          company: {
            crmStage: { not: "archived" },
            ...(officeId ? { officeId } : {}),
            supplyWorkspaces: {
              some: {
                status: "ACTIVE",
                ...(officeId ? { officeId } : {}),
              },
            },
          },
        },
      },
    },
    select: {
      id: true,
      officeId: true,
      email: true,
      passwordHash: true,
      passwordVersion: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
    take: 2,
  });
  return users.length === 1 ? users[0] : null;
}

export type AuthenticateCustomerPortalResult =
  | {
      ok: true;
      userId: string;
      officeId: string;
      email: string;
      passwordVersion: number;
    }
  | { ok: false; error: "invalid" };

export async function authenticateCustomerPortal(
  rawEmail: string,
  rawPassword: string,
  officeId?: string | null,
): Promise<AuthenticateCustomerPortalResult> {
  const email = normalizeCustomerPortalEmail(rawEmail);
  const password = rawPassword.slice(0, 128);
  const validInput = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && rawPassword.length >= 12
    && rawPassword.length <= 128;

  const user = validInput ? await findPortalUser(email, officeId) : null;
  const now = new Date();
  const accountLocked = Boolean(user?.lockedUntil && user.lockedUntil > now);
  const passwordMatches = accountLocked
    ? false
    : await verifyPassword(password, user?.passwordHash ?? DUMMY_CUSTOMER_PASSWORD_HASH);
  if (!validInput || !user?.passwordHash || !passwordMatches || accountLocked) {
    if (validInput && user?.passwordHash && !passwordMatches && !accountLocked) {
      await prisma.$transaction(async (tx) => {
        await tx.customerPortalUser.updateMany({
          where: {
            id: user.id,
            officeId: user.officeId,
            isActive: true,
            passwordVersion: user.passwordVersion,
          },
          data: {
            failedLoginAttempts: { increment: 1 },
            lastFailedLoginAt: now,
          },
        });
        await tx.customerPortalUser.updateMany({
          where: {
            id: user.id,
            officeId: user.officeId,
            passwordVersion: user.passwordVersion,
            failedLoginAttempts: { gte: MAX_FAILED_LOGIN_ATTEMPTS },
          },
          data: { lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MS) },
        });
      });
    }
    return { ok: false, error: "invalid" };
  }

  await prisma.customerPortalUser.updateMany({
    where: { id: user.id, officeId: user.officeId, passwordVersion: user.passwordVersion },
    data: { failedLoginAttempts: 0, lastFailedLoginAt: null, lockedUntil: null },
  });

  return {
    ok: true,
    userId: user.id,
    officeId: user.officeId,
    email: user.email,
    passwordVersion: user.passwordVersion,
  };
}

export async function loadCustomerPortalPrincipal(payload: CustomerPortalSessionPayload) {
  const user = await prisma.customerPortalUser.findFirst({
    where: {
      id: payload.portalUserId,
      officeId: payload.officeId,
      email: payload.email,
      isActive: true,
      passwordHash: { not: null },
      passwordVersion: payload.passwordVersion,
    },
    select: {
      id: true,
      officeId: true,
      email: true,
      fullName: true,
      memberships: {
        where: {
          officeId: payload.officeId,
          isActive: true,
          company: {
            officeId: payload.officeId,
            crmStage: { not: "archived" },
            supplyWorkspaces: {
              some: { officeId: payload.officeId, status: "ACTIVE" },
            },
          },
        },
        select: {
          id: true,
          companyId: true,
          role: true,
          company: { select: { id: true, name: true } },
        },
        orderBy: { company: { name: "asc" } },
      },
    },
  });
  if (!user || user.memberships.length === 0) return null;
  return user;
}
