import "server-only";

import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/gmail-oauth";
import {
  CUSTOMER_PORTAL_SESSION_MAX_AGE_SECONDS,
  decodeCustomerPortalSession,
  encodeCustomerPortalSession,
  generateCustomerPortalCode,
  hashCustomerPortalCode,
  normalizeCustomerPortalEmail,
} from "@/lib/customer-portal-security";

const CUSTOMER_PORTAL_COOKIE = "derya_customer_portal_session";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing.");
  return secret;
}

function encodeGmailRaw(raw: string) {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendCustomerCodeEmail(accountId: string, from: string, to: string, code: string) {
  const token = await getValidAccessToken(accountId);
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: Your Derya shipment portal code`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
  ];
  const body = [
    `Your Derya shipment portal sign-in code is: ${code}`,
    ``,
    `It expires in 10 minutes.`,
    `If you did not request this code, ignore this email.`,
  ].join("\r\n");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeGmailRaw(headers.join("\r\n") + "\r\n\r\n" + body) }),
  });
  if (!response.ok) throw new Error(`Customer portal code send failed (${response.status}).`);
}

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
    select: { id: true, officeId: true, email: true },
    take: 2,
  });
  return users.length === 1 ? users[0] : null;
}

async function pickSenderAccount(officeId: string) {
  const rfqDesk = await prisma.emailAccount.findFirst({
    where: { officeId, email: "rfq@usederya.com", provider: "GMAIL", isActive: true },
  });
  if (rfqDesk) return rfqDesk;
  return prisma.emailAccount.findFirst({
    where: { officeId, provider: "GMAIL", isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

export type RequestCustomerPortalCodeResult =
  | { ok: true }
  | { ok: false; error: "rate_limited" | "send_failed" };

export async function requestCustomerPortalCode(
  rawEmail: string,
  officeId?: string | null,
): Promise<RequestCustomerPortalCodeResult> {
  const email = normalizeCustomerPortalEmail(rawEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: true };

  const user = await findPortalUser(email, officeId);
  // Do not reveal whether an external account exists.
  if (!user) return { ok: true };

  const windowStart = new Date(Date.now() - REQUEST_WINDOW_MS);
  const recent = await prisma.customerPortalLoginCode.count({
    where: { userId: user.id, createdAt: { gte: windowStart } },
  });
  // Keep the response generic so rate-limit state cannot reveal whether a
  // customer account exists.
  if (recent >= MAX_REQUESTS_PER_WINDOW) return { ok: true };

  const sender = await pickSenderAccount(user.officeId);
  if (!sender) return { ok: true };

  const code = generateCustomerPortalCode();
  try {
    await sendCustomerCodeEmail(sender.id, sender.email, email, code);
  } catch (error) {
    console.warn("customer portal code send failed", error);
    return { ok: true };
  }

  await prisma.$transaction([
    prisma.customerPortalLoginCode.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.customerPortalLoginCode.create({
      data: {
        officeId: user.officeId,
        userId: user.id,
        email,
        codeHash: hashCustomerPortalCode(authSecret(), user.officeId, email, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    }),
  ]);
  return { ok: true };
}

export type VerifyCustomerPortalCodeResult =
  | { ok: true; userId: string; officeId: string; email: string }
  | { ok: false; error: "invalid" };

export async function verifyCustomerPortalCode(
  rawEmail: string,
  rawCode: string,
  officeId?: string | null,
): Promise<VerifyCustomerPortalCodeResult> {
  const email = normalizeCustomerPortalEmail(rawEmail);
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "invalid" };

  const user = await findPortalUser(email, officeId);
  if (!user) return { ok: false, error: "invalid" };

  const record = await prisma.customerPortalLoginCode.findFirst({
    where: {
      userId: user.id,
      officeId: user.officeId,
      email,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return { ok: false, error: "invalid" };

  const claimed = await prisma.customerPortalLoginCode.updateMany({
    where: { id: record.id, consumedAt: null, attempts: { lt: MAX_VERIFY_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { ok: false, error: "invalid" };

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashCustomerPortalCode(authSecret(), user.officeId, email, code), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, error: "invalid" };
  }

  const consumed = await prisma.customerPortalLoginCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) return { ok: false, error: "invalid" };

  return { ok: true, userId: user.id, officeId: user.officeId, email };
}

export async function issueCustomerPortalSession(input: {
  userId: string;
  officeId: string;
  email: string;
}) {
  const token = encodeCustomerPortalSession(authSecret(), {
    portalUserId: input.userId,
    officeId: input.officeId,
    email: normalizeCustomerPortalEmail(input.email),
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

  const user = await prisma.customerPortalUser.findFirst({
    where: {
      id: payload.portalUserId,
      officeId: payload.officeId,
      email: payload.email,
      isActive: true,
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

export async function requireCustomerPortalPrincipal() {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) redirect("/portal");
  return principal;
}

export async function logoutCustomerPortal() {
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_PORTAL_COOKIE);
}
