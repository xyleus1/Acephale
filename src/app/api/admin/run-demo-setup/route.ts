import { NextResponse, NextRequest } from "next/server";

// Deprecated: this route used to run the older Black Sea/steel demo setup.
// That seed created stale fake loads that polluted the Inbox/Jobs demo flow.
// Use `npm run demo:video-loads -- --apply` from the repo for the current
// two-load Inbox video demo reset.
async function run(mode: string) {
  return NextResponse.json({
    ok: false,
    mode,
    error: "Legacy demo setup is disabled. Run `npm run demo:video-loads -- --apply` to reset the two Inbox video demo loads.",
  }, { status: 410 });
}

export async function GET(req: NextRequest) { return run(req.nextUrl.searchParams.get("mode") ?? "setup"); }
export async function POST(req: NextRequest) { return run(req.nextUrl.searchParams.get("mode") ?? "setup"); }
