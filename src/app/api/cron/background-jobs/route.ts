import { NextRequest, NextResponse } from "next/server";
import { runDueBackgroundJobs } from "@/lib/background-jobs";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const headerAuth = req.headers.get("authorization");
  const secret = req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 25)));
  const result = await runDueBackgroundJobs({ limit });
  return NextResponse.json({
    ran: new Date().toISOString(),
    ...result,
  });
}
