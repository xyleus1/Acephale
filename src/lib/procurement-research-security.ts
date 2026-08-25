import { timingSafeEqual } from "node:crypto";

export function sharedSecretMatches(supplied: string | null, expected: string) {
  if (!supplied) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length
    && timingSafeEqual(suppliedBytes, expectedBytes);
}
