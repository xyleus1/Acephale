import { NextResponse } from "next/server";
import { sharedSecretMatches } from "@/lib/procurement-research-security";
import { runOutreachCampaignAutoReplies } from "@/lib/outreach-campaign-auto-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Cron secret is not configured." }, { status: 503 });
  const authorization = request.headers.get("authorization");
  const suppliedSecret = request.headers.get("x-cron-secret")
    ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (!sharedSecretMatches(suppliedSecret, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runOutreachCampaignAutoReplies({ limit: 25 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown outreach cron failure.";
    console.error("outreach cron failed", { route: "outreach-replies", message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
