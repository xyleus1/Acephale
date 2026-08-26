import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Operator command endpoints are driven from the shell rather than a browser
// session, so they authenticate with the same shared operator secret the
// procurement RFQ command already uses.
function suppliedSecret(req: NextRequest) {
  const headerAuth = req.headers.get("authorization");
  return req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
}

function sameSecret(expected: string, supplied: string) {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}

export function operatorSecretAuthorized(req: NextRequest) {
  const supplied = suppliedSecret(req);
  if (!supplied) return false;
  const expected = [process.env.PROCUREMENT_BULK_RFQ_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length >= 16));
  return expected.some((value) => sameSecret(value, supplied));
}
