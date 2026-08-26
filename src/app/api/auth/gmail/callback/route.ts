import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { exchangeCodeForTokens, getUserEmail, verifyOAuthState } from "@/lib/gmail-oauth";
import { encryptOAuthTokenForStorage } from "@/lib/security/crypto";
import { isEmailAccountAdminSession } from "@/lib/email-account-access";

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!(await isEmailAccountAdminSession(session))) {
    return new NextResponse("Admin access required.", { status: 403 });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const settingsUrl = new URL("/dashboard/settings/email", url.origin);

  if (error) {
    settingsUrl.searchParams.set("oauth_error", error);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code || !state) {
    settingsUrl.searchParams.set("oauth_error", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  // Verify state via HMAC signature - no cookie required. The state was
  // signed with AUTH_SECRET on the start route and includes the officeId +
  // issuedAt timestamp. Falls back to the legacy cookie nonce check for
  // any in-flight OAuth flows started before this code shipped.
  const stateValid = verifyOAuthState(state, session.officeId);
  if (!stateValid) {
    const c = await cookies();
    const cookieNonce = c.get("gmail-oauth-nonce")?.value;
    const [legacyOffice, legacyNonce] = state.split(".");
    const legacyMatch = !!cookieNonce && cookieNonce === legacyNonce && legacyOffice === session.officeId;
    if (!legacyMatch) {
      settingsUrl.searchParams.set("oauth_error", "state_mismatch");
      return NextResponse.redirect(settingsUrl);
    }
  }
  // Best-effort cleanup of any cookie left behind.
  try { (await cookies()).delete("gmail-oauth-nonce"); } catch { /* ignore */ }

  try {
    const tokens = await exchangeCodeForTokens(code, { origin: url.origin });
    const email = await getUserEmail(tokens.access_token);
    const encryptedAccessToken = encryptOAuthTokenForStorage(tokens.access_token);

    // Mailboxes are one shared pool, so a mailbox exists once for the whole app.
    const existing = await prisma.emailAccount.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptOAuthTokenForStorage(tokens.refresh_token)
      : existing?.refreshToken ?? null;
    if (existing) {
      await prisma.emailAccount.update({
        where: { id: existing.id },
        data: {
          provider: "GMAIL",
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          isActive: true,
        },
      });
    } else {
      await prisma.emailAccount.create({
        data: {
          officeId: session.officeId,
          email,
          provider: "GMAIL",
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          isActive: true,
        },
      });
    }

    settingsUrl.searchParams.set("oauth_success", email);
    return NextResponse.redirect(settingsUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "exchange_failed";
    settingsUrl.searchParams.set("oauth_error", msg);
    return NextResponse.redirect(settingsUrl);
  }
}
