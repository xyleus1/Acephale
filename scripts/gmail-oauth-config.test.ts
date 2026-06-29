import assert from "node:assert/strict";
import { normalizeGoogleRedirectUri } from "../src/lib/gmail-oauth";

assert.equal(
  normalizeGoogleRedirectUri("GOOGLE_REDIRECT_URI=https://www.derya.ai/api/auth/gmail/callback"),
  "https://www.derya.ai/api/auth/gmail/callback",
);
assert.equal(
  normalizeGoogleRedirectUri('"https://www.derya.ai/api/auth/gmail/callback"'),
  "https://www.derya.ai/api/auth/gmail/callback",
);
assert.equal(normalizeGoogleRedirectUri(""), null);

console.log("gmail-oauth-config ok");
