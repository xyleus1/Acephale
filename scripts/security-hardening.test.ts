import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  decryptOAuthTokenFromStorage,
  encryptOAuthTokenForStorage,
  encryptSecret,
  isEncryptedSecret,
} from "../src/lib/security/crypto";
import { getValidAccessToken } from "../src/lib/gmail-oauth";
import { escapeHtml } from "../src/lib/security/html";
import { createPortalToken, isPlausiblePortalToken } from "../src/lib/portal-token";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => unknown, message: string) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

async function main() {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const key = Buffer.alloc(32, 7).toString("base64");
  const plaintext = "ya29.test-token-<not-html>&not-plain";
  let encrypted: string | null = null;

  try {
    process.env.TOKEN_ENCRYPTION_KEY = key;
    encrypted = encryptOAuthTokenForStorage(plaintext);
    assert(encrypted, "Expected encrypted OAuth token.");
    assert(isEncryptedSecret(encrypted), "Encrypted OAuth token should use the encrypted storage prefix.");
    assert(encrypted !== plaintext, "Encrypted OAuth token should not equal plaintext.");
    assert(!encrypted.includes("test-token"), "Encrypted OAuth token should not contain plaintext token material.");
    assert(decryptOAuthTokenFromStorage(encrypted) === plaintext, "Encrypted OAuth token did not decrypt correctly.");
    assert(decryptOAuthTokenFromStorage("legacy-plaintext-token") === "legacy-plaintext-token", "Legacy plaintext token fallback failed.");

    process.env.TOKEN_ENCRYPTION_KEY = "";
    process.env.NODE_ENV = "production";
    assertThrows(() => encryptSecret("must-not-store-plaintext"), "Missing TOKEN_ENCRYPTION_KEY should fail before token storage.");
  } finally {
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }

  const dangerous = `<img src=x onerror="alert('x')"> ACME & Sons 'Quote'`;
  const escaped = escapeHtml(dangerous);
  assert(!escaped.includes("<img"), "HTML escape should remove raw tag openers.");
  assert(!escaped.includes("onerror=\""), "HTML escape should escape raw quoted attributes.");
  assert(escaped.includes("&lt;img"), "HTML escape should encode tag openers.");
  assert(escaped.includes("&amp;"), "HTML escape should encode ampersands.");
  assert(escaped.includes("&#39;Quote&#39;"), "HTML escape should encode apostrophes.");

  const runId = `security-hardening-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });
  try {
    const job = await prisma.job.create({
      data: {
        officeId: office.id,
        reference: `${runId}-JOB`,
        status: "INQUIRY",
      },
    });
    assert(!isPlausiblePortalToken(job.id), "A job id should not be accepted as a plausible portal token.");
  const jobIdFallbackLookup = await prisma.job.findUnique({ where: { portalToken: job.id } });
  assert(jobIdFallbackLookup === null, "Job id must not grant portal access through portalToken lookup.");

    const token = createPortalToken();
    assert(isPlausiblePortalToken(token), "Generated portal token should pass token format validation.");
    assert(token.length === 64, "New portal tokens should use 32 random bytes encoded as 64 hex chars.");
    await prisma.job.update({ where: { id: job.id }, data: { portalToken: token } });
    const tokenLookup = await prisma.job.findUnique({ where: { portalToken: token }, select: { id: true } });
    assert(tokenLookup?.id === job.id, "Real portal token should resolve the job.");

    const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const originalFetch = globalThis.fetch;
    const legacyRefresh = "legacy-refresh-token";
    try {
      process.env.TOKEN_ENCRYPTION_KEY = key;
      process.env.GOOGLE_CLIENT_ID = "test-client-id";
      process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        assert(url === "https://oauth2.googleapis.com/token", "Unexpected Gmail token refresh URL.");
        return new Response(JSON.stringify({
          access_token: "refreshed-access-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const legacyAccount = await prisma.emailAccount.create({
        data: {
          officeId: office.id,
          email: `${runId}@example.com`,
          provider: "GMAIL",
          accessToken: "legacy-access-token",
          refreshToken: legacyRefresh,
        },
      });
      const refreshed = await getValidAccessToken(legacyAccount.id);
      assert(refreshed === "refreshed-access-token", "Expected mocked Gmail access token refresh.");
      const migratedAccount = await prisma.emailAccount.findUnique({
        where: { id: legacyAccount.id },
        select: { accessToken: true, refreshToken: true },
      });
      assert(isEncryptedSecret(migratedAccount?.accessToken), "Refreshed access token should be stored encrypted.");
      assert(isEncryptedSecret(migratedAccount?.refreshToken), "Legacy plaintext refresh token should be re-encrypted after refresh.");
      assert(decryptOAuthTokenFromStorage(migratedAccount?.refreshToken) === legacyRefresh, "Re-encrypted legacy refresh token should decrypt.");

      const noTokenAccount = await prisma.emailAccount.create({
        data: {
          officeId: office.id,
          email: `${runId}-no-token@example.com`,
          provider: "GMAIL",
        },
      });
      await getValidAccessToken(noTokenAccount.id)
        .then(() => {
          throw new Error("Expected no-token Gmail account to require reconnect.");
        })
        .catch((error) => {
          assert(error instanceof Error && error.message === "Account has no refresh token (re-connect needed)", "Expected clear reconnect error for Gmail account without tokens.");
        });
    } finally {
      if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
      if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = originalClientId;
      if (originalClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
      globalThis.fetch = originalFetch;
    }

    console.log(JSON.stringify({
      ok: true,
      encryptedTokenStored: isEncryptedSecret(encrypted),
      legacyPlaintextReadFallback: true,
      legacyPlaintextReencryptedOnRefresh: true,
      missingKeyFails: true,
      noTokenReconnectError: true,
      quoteHtmlEscaped: true,
      jobIdPortalAccess: false,
      generatedPortalTokenLength: token.length,
    }, null, 2));
  } finally {
    await prisma.office.delete({ where: { id: office.id } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
