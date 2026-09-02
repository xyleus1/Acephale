import { NextRequest, NextResponse } from "next/server";
import { runProspectingBackgroundTick } from "@/lib/supply-os/context-prospecting";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron secret is not configured." }, { status: 503 });
  }
  const header = request.headers.get("authorization");
  const secret = request.headers.get("x-cron-secret")
    ?? (header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const counters = await runProspectingBackgroundTick({ budgetMs: 240_000 });
  return NextResponse.json(counters, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
