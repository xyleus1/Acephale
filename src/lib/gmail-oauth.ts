import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "./prisma";
import { requireSession } from "./auth";
import { decryptOAuthTokenFromStorage, encryptOAuthTokenForStorage, isEncryptedSecret } from "./security/crypto";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function normalizeGoogleRedirectUri(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const withoutEnvKey = raw.startsWith("GOOGLE_REDIRECT_URI=")
    ? raw.slice("GOOGLE_REDIRECT_URI=".length).trim()
    : raw;
  return withoutEnvKey.replace(/^['"]|['"]$/g, "");
}

function getRedirectUri() {
  const base = normalizeGoogleRedirectUri(process.env.GOOGLE_REDIRECT_URI)
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/api/auth/gmail/callback` : "http://localhost:3000/api/auth/gmail/callback");
  return base;
}

export async function getGmailAuthUrl(args: { loginHint?: string | null } = {}): Promise<{ url: string; state: string }> {
  const session = await requireSession();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");

  // Stateless HMAC-signed state token: officeId + issuedAt + signature.
  // No cookie needed, so we don't lose state across OAuth redirects, sub-
  // domains, or browsers that drop cookies on cross-site GET navigations.
  // Verified on the callback by checking the signature with AUTH_SECRET.
  const state = signOAuthState(session.officeId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
  });
  const loginHint = args.loginHint?.trim().toLowerCase();
  if (loginHint) params.set("login_hint", loginHint);
  // Also drop a fallback cookie for older deployments still expecting one.
  // Harmless if the callback ignores it.
  try {
    const c = await cookies();
    c.set("gmail-oauth-nonce", state, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
    });
  } catch { /* ignore */ }
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
  };
}

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes — covers slow consent screens

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

export function signOAuthState(officeId: string): string {
  const issuedAt = Date.now();
  const payload = `${officeId}.${issuedAt}`;
  const sig = crypto.createHmac("sha256", getAuthSecret()).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${sig}`;
}

export function verifyOAuthState(state: string, officeId: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [stateOffice, issuedAtStr, sig] = parts;
  if (stateOffice !== officeId) return false;
  const issuedAt = parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > STATE_TTL_MS) return false;
  const expected = crypto.createHmac("sha256", getAuthSecret()).update(`${stateOffice}.${issuedAtStr}`).digest("hex").slice(0, 32);
  // Constant-time compare
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
};

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth client env vars not set");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth client env vars not set");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
  const data = await res.json();
  return data.email;
}

// Get a valid access token for an account, refreshing if needed.
export async function getValidAccessToken(accountId: string): Promise<string> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("EmailAccount not found");
  if (!account.refreshToken) throw new Error("Account has no refresh token (re-connect needed)");
  const refreshToken = decryptOAuthTokenFromStorage(account.refreshToken);
  if (!refreshToken) throw new Error("Account has no usable refresh token (re-connect needed)");

  // Always refresh — simpler and avoids tracking token expiry.
  const tokens = await refreshAccessToken(refreshToken);
  await prisma.emailAccount.updateMany({
    where: { id: accountId, officeId: account.officeId },
    data: {
      accessToken: encryptOAuthTokenForStorage(tokens.access_token),
      ...(isEncryptedSecret(account.refreshToken)
        ? {}
        : { refreshToken: encryptOAuthTokenForStorage(refreshToken) }),
    },
  });
  return tokens.access_token;
}
