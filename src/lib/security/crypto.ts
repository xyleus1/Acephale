import crypto from "node:crypto";

const ENCRYPTED_SECRET_PREFIX = "enc:v1:";
const TOKEN_AAD = Buffer.from("derya:oauth-token:v1", "utf8");

function tokenEncryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is required to encrypt or decrypt OAuth tokens. Generate one with: openssl rand -base64 32");
  }

  const candidates: Buffer[] = [];
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    candidates.push(Buffer.from(raw, "hex"));
  }
  candidates.push(Buffer.from(raw, "base64"));
  candidates.push(Buffer.from(raw, "utf8"));

  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes. Use: openssl rand -base64 32");
  }
  return key;
}

export function isSecretEncryptionConfigured() {
  try {
    tokenEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function isEncryptedSecret(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_SECRET_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = tokenEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_SECRET_PREFIX.slice(0, -1),
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) return stored;
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Encrypted secret has an invalid format.");
  }
  const [, , ivRaw, ciphertextRaw, tagRaw] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", tokenEncryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAAD(TOKEN_AAD);
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptOAuthTokenForStorage(token: string | null | undefined): string | null {
  if (!token) return null;
  return encryptSecret(token);
}

export function decryptOAuthTokenFromStorage(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return decryptSecret(stored);
}
