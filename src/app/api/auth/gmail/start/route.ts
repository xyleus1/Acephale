import { NextRequest, NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/gmail-oauth";
import { isDeryaLoadRfqInbox, normalizeEmailAddress } from "@/lib/derya-inboxes";

export async function GET(request: NextRequest) {
  try {
    const requestedEmail = normalizeEmailAddress(request.nextUrl.searchParams.get("email"));
    const loginHint = isDeryaLoadRfqInbox(requestedEmail) ? requestedEmail : null;
    const { url } = await getGmailAuthUrl({ loginHint, origin: request.nextUrl.origin });
    return NextResponse.redirect(url);
  } catch (e) {
    const digest = typeof (e as { digest?: unknown })?.digest === "string" ? (e as { digest: string }).digest : "";
    if ((e instanceof Error && e.message === "NEXT_REDIRECT") || digest.startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : "Failed to start OAuth";
    return new NextResponse(`OAuth start failed: ${msg}`, { status: 500 });
  }
}
