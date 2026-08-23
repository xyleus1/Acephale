import { NextRequest, NextResponse } from "next/server";
import { getGmailAuthUrl } from "@/lib/gmail-oauth";
import { isDeryaLoadRfqInbox, isDeryaRfqSourceSender, normalizeEmailAddress } from "@/lib/derya-inboxes";
import { requireSession } from "@/lib/auth";
import { isEmailAccountAdminSession } from "@/lib/email-account-access";

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession();
    if (!(await isEmailAccountAdminSession(session))) {
      return new NextResponse("Admin access required.", { status: 403 });
    }
    const requestedEmail = normalizeEmailAddress(request.nextUrl.searchParams.get("email"));
    // Known mailboxes preselect the right Google account: the load/RFQ
    // inboxes and the rfq@ desk address (US lead replies land there).
    const loginHint = isDeryaLoadRfqInbox(requestedEmail) || isDeryaRfqSourceSender(requestedEmail)
      ? requestedEmail
      : null;
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
