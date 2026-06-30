import assert from "node:assert/strict";
import {
  getGoogleRedirectUri,
  googleOAuthCallbackUriForOrigin,
  normalizeGoogleRedirectUri,
} from "../src/lib/gmail-oauth";

assert.equal(
  normalizeGoogleRedirectUri("GOOGLE_REDIRECT_URI=https://www.derya.ai/api/auth/gmail/callback"),
  "https://www.derya.ai/api/auth/gmail/callback",
);
assert.equal(
  normalizeGoogleRedirectUri('"GOOGLE_REDIRECT_URI=https://www.derya.ai/api/auth/gmail/callback"'),
  "https://www.derya.ai/api/auth/gmail/callback",
);
assert.equal(
  normalizeGoogleRedirectUri('"https://www.derya.ai/api/auth/gmail/callback"'),
  "https://www.derya.ai/api/auth/gmail/callback",
);
assert.equal(normalizeGoogleRedirectUri(""), null);

assert.equal(
  googleOAuthCallbackUriForOrigin("https://www.derya.ai"),
  "https://www.derya.ai/api/auth/gmail/callback",
);
assert.equal(
  googleOAuthCallbackUriForOrigin("http://localhost:3000"),
  "http://localhost:3000/api/auth/gmail/callback",
);

const originalRedirectUri = process.env.GOOGLE_REDIRECT_URI;
try {
  process.env.GOOGLE_REDIRECT_URI = "GOOGLE_REDIRECT_URI=https://derya.ai/api/auth/gmail/callback";
  assert.equal(
    getGoogleRedirectUri("https://www.derya.ai"),
    "https://www.derya.ai/api/auth/gmail/callback",
  );
  assert.equal(
    getGoogleRedirectUri(),
    "https://derya.ai/api/auth/gmail/callback",
  );
} finally {
  if (originalRedirectUri === undefined) {
    delete process.env.GOOGLE_REDIRECT_URI;
  } else {
    process.env.GOOGLE_REDIRECT_URI = originalRedirectUri;
  }
}

console.log("gmail-oauth-config ok");
