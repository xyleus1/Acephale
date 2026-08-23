import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  CUSTOMER_PORTAL_SESSION_MAX_AGE_SECONDS,
  decodeCustomerPortalSession,
  encodeCustomerPortalSession,
  normalizeCustomerPortalEmail,
} from "@/lib/customer-portal-security";
import { loadCustomerPortalPrincipal } from "@/lib/customer-portal-password";
export { authenticateCustomerPortal } from "@/lib/customer-portal-password";

const CUSTOMER_PORTAL_COOKIE = "derya_customer_portal_session";

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing.");
  return secret;
}

export async function issueCustomerPortalSession(input: {
  userId: string;
  officeId: string;
  username: string;
  email: string;
  passwordVersion: number;
}) {
  const token = encodeCustomerPortalSession(authSecret(), {
    portalUserId: input.userId,
    officeId: input.officeId,
    username: input.username,
    email: normalizeCustomerPortalEmail(input.email),
    passwordVersion: input.passwordVersion,
  });
  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CUSTOMER_PORTAL_SESSION_MAX_AGE_SECONDS,
  });
  await prisma.customerPortalUser.updateMany({
    where: { id: input.userId, officeId: input.officeId, isActive: true },
    data: { lastLoginAt: new Date() },
  });
}

export async function getCustomerPortalPrincipal() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_PORTAL_COOKIE)?.value;
  if (!token) return null;
  const payload = decodeCustomerPortalSession(authSecret(), token);
  if (!payload) return null;

  return loadCustomerPortalPrincipal(payload);
}

export async function requireCustomerPortalPrincipal() {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) redirect("/portal");
  return principal;
}

export async function logoutCustomerPortal() {
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_PORTAL_COOKIE);
}
