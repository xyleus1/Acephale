import crypto from "node:crypto";

const CURRENT_TOKEN_BYTES = 32;
const LEGACY_HEX_LENGTH = 32;
const CURRENT_HEX_LENGTH = CURRENT_TOKEN_BYTES * 2;

export function createPortalToken() {
  return crypto.randomBytes(CURRENT_TOKEN_BYTES).toString("hex");
}

export function isPlausiblePortalToken(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[a-f0-9]+$/i.test(value) && (value.length === LEGACY_HEX_LENGTH || value.length === CURRENT_HEX_LENGTH);
}
