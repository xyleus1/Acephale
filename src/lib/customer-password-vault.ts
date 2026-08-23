import "server-only";

import crypto from "node:crypto";

const VERSION = "v1";
const KEY_CONTEXT = "derya-customer-password-vault";

function vaultKey(secret: string) {
  if (!secret) throw new Error("AUTH_SECRET is missing.");
  return crypto.createHash("sha256").update(`${KEY_CONTEXT}:${secret}`).digest();
}

export function encryptCustomerPassword(password: string, secret = process.env.AUTH_SECRET ?? "") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", vaultKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptCustomerPassword(
  value: string | null | undefined,
  secret = process.env.AUTH_SECRET ?? "",
) {
  if (!value) return null;
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      vaultKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
