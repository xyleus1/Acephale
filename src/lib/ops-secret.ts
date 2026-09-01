import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function opsSecretMatches(
  supplied: string | null | undefined,
  expected: string | undefined,
): boolean {
  const suppliedValue = supplied?.trim();
  const expectedValue = expected?.trim();
  if (!suppliedValue || !expectedValue || expectedValue.length < 32) return false;

  const suppliedDigest = createHash("sha256").update(suppliedValue).digest();
  const expectedDigest = createHash("sha256").update(expectedValue).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

export function opsSecretAuthorized(req: NextRequest): boolean {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  return opsSecretMatches(authorization.slice("Bearer ".length), process.env.OPS_PROVISIONING_SECRET);
}
