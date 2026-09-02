import "server-only";

import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const DEFAULT_LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

type ThrottleClient = Prisma.TransactionClient | typeof prisma;

function throttleKey(identity: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing.");
  return createHmac("sha256", secret).update(identity).digest("hex");
}

/**
 * Sign-in attempt counter shared by every login surface. The identity is
 * hashed, so a client address never lands in the table. Callers prefix their
 * own surface so the surfaces cannot consume each other's budget.
 */
export async function consumeLoginAttempt(input: {
  identity: string;
  maxAttempts: number;
  windowMs?: number;
  now?: Date;
}) {
  const { identity, maxAttempts } = input;
  const windowMs = input.windowMs ?? DEFAULT_LOGIN_THROTTLE_WINDOW_MS;
  const now = input.now ?? new Date();
  const keyHash = throttleKey(identity);
  const expiresAt = new Date(now.getTime() + windowMs);
  const resetBefore = new Date(now.getTime() - windowMs);
  return prisma.$transaction(async (tx: ThrottleClient) => {
    await tx.$executeRaw`
      DELETE FROM "CustomerPortalLoginThrottle"
      WHERE "keyHash" IN (
        SELECT "keyHash"
        FROM "CustomerPortalLoginThrottle"
        WHERE "expiresAt" < ${now}
        ORDER BY "expiresAt" ASC
        LIMIT 100
      )
    `;
    const rows = await tx.$queryRaw<Array<{ attemptCount: number }>>`
      INSERT INTO "CustomerPortalLoginThrottle" (
        "keyHash",
        "windowStartedAt",
        "attemptCount",
        "expiresAt",
        "updatedAt"
      ) VALUES (${keyHash}, ${now}, 1, ${expiresAt}, ${now})
      ON CONFLICT ("keyHash") DO UPDATE SET
        "windowStartedAt" = CASE
          WHEN "CustomerPortalLoginThrottle"."windowStartedAt" <= ${resetBefore}
            THEN EXCLUDED."windowStartedAt"
          ELSE "CustomerPortalLoginThrottle"."windowStartedAt"
        END,
        "attemptCount" = CASE
          WHEN "CustomerPortalLoginThrottle"."windowStartedAt" <= ${resetBefore}
            THEN 1
          ELSE "CustomerPortalLoginThrottle"."attemptCount" + 1
        END,
        "expiresAt" = CASE
          WHEN "CustomerPortalLoginThrottle"."windowStartedAt" <= ${resetBefore}
            THEN EXCLUDED."expiresAt"
          ELSE "CustomerPortalLoginThrottle"."expiresAt"
        END,
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING "attemptCount"
    `;
    return (rows[0]?.attemptCount ?? maxAttempts + 1) <= maxAttempts;
  });
}

/**
 * Reads a budget without spending it, for limits that should only count
 * failures and therefore cannot be consumed before the attempt is judged.
 */
export async function loginAttemptsExhausted(identity: string, maxAttempts: number, now = new Date()) {
  const keyHash = throttleKey(identity);
  const rows = await prisma.$queryRaw<Array<{ attemptCount: number }>>`
    SELECT "attemptCount"
    FROM "CustomerPortalLoginThrottle"
    WHERE "keyHash" = ${keyHash} AND "expiresAt" > ${now}
  `;
  return (rows[0]?.attemptCount ?? 0) >= maxAttempts;
}

/**
 * Vercel sets `x-vercel-forwarded-for` itself and it is preferred because a
 * caller can put anything in `x-forwarded-for`. Address budgets are best
 * effort for that reason: identifier-scoped budgets are what actually bound
 * brute force when a caller rotates addresses.
 */
export function clientAddressFromHeaders(requestHeaders: {
  get: (name: string) => string | null;
}) {
  return requestHeaders.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || requestHeaders.get("x-real-ip")
    || requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}
