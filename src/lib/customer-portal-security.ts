import crypto from "crypto";

export const CUSTOMER_PORTAL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type CustomerPortalSessionPayload = {
  portalUserId: string;
  officeId: string;
  email: string;
  expiresAt: number;
};

export function normalizeCustomerPortalEmail(email: string) {
  return email.trim().toLowerCase();
}

export function generateCustomerPortalCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function isCustomerPortalDocumentSource(url: string) {
  if (
    url.startsWith("local-upload://job-documents/")
    || url.startsWith("local-upload://context-documents/")
    || url.startsWith("s3://")
  ) {
    return true;
  }
  if (/^data:[^;]+;base64,/.test(url)) return true;
  if (!url.startsWith("/")) return false;

  try {
    const parsed = new URL(url, "http://portal.internal");
    return parsed.origin === "http://portal.internal"
      && parsed.pathname === "/api/gmail/attachment";
  } catch {
    return false;
  }
}

export function hashCustomerPortalCode(secret: string, officeId: string, email: string, code: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${officeId}:${normalizeCustomerPortalEmail(email)}:${code}`)
    .digest("hex");
}

function signSession(secret: string, base: string) {
  return crypto.createHmac("sha256", secret).update(base).digest("hex");
}

export function encodeCustomerPortalSession(
  secret: string,
  input: Omit<CustomerPortalSessionPayload, "expiresAt">,
  now = Date.now(),
) {
  const payload: CustomerPortalSessionPayload = {
    ...input,
    expiresAt: now + CUSTOMER_PORTAL_SESSION_MAX_AGE_SECONDS * 1000,
  };
  const base = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${base}.${signSession(secret, base)}`;
}

export function decodeCustomerPortalSession(
  secret: string,
  token: string,
  now = Date.now(),
): CustomerPortalSessionPayload | null {
  const [base, signature] = token.split(".");
  if (!base || !signature) return null;
  const expected = Buffer.from(signSession(secret, base), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(base, "base64url").toString("utf-8")) as CustomerPortalSessionPayload;
    if (
      typeof payload.portalUserId !== "string"
      || typeof payload.officeId !== "string"
      || typeof payload.email !== "string"
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt <= now
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
