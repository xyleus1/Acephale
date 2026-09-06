import { NextResponse } from "next/server";
import { sharedSecretMatches } from "@/lib/procurement-research-security";
import { runOutreachCampaignAutoReplies } from "@/lib/outreach-campaign-auto-reply";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Cron secret is not configured." }, { status: 503 });
  const authorization = request.headers.get("authorization");
  const suppliedSecret = request.headers.get("x-cron-secret")
    ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (!sharedSecretMatches(suppliedSecret, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runOutreachCampaignAutoReplies({ limit: 25 }));
}
