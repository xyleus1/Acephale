import { logout, loginWithCredentials, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { resolveLoginIdentifier } from "@/lib/login-code";
import {
  AUTH_SESSION_RESPONSE_HEADERS,
  handleAuthSessionPost,
} from "@/lib/auth-session-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleAuthSessionPost(request, {
    resolveIdentifier: resolveLoginIdentifier,
    login: loginWithCredentials,
    sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
  });
}

export async function DELETE() {
  await logout();
  return new Response(null, { status: 204, headers: AUTH_SESSION_RESPONSE_HEADERS });
}
