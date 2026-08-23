import "server-only";

import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 30;

function addressKey(clientAddress: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is missing.");
  return createHmac("sha256", secret).update(clientAddress).digest("hex");
}

export async function consumeCustomerPortalLoginAttempt(clientAddress: string, now = new Date()) {
  const keyHash = addressKey(clientAddress);
  const expiresAt = new Date(now.getTime() + WINDOW_MS);
  const resetBefore = new Date(now.getTime() - WINDOW_MS);
  return prisma.$transaction(async (tx) => {
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
    return (rows[0]?.attemptCount ?? MAX_ATTEMPTS + 1) <= MAX_ATTEMPTS;
  });
}
