import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sharedSecretMatches } from "@/lib/procurement-research-security";
import { runOutreachCampaignBatch } from "@/lib/outreach-campaign-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Cron secret is not configured." },
      { status: 503, headers: responseHeaders },
    );
  }
  const authorization = request.headers.get("authorization");
  const suppliedSecret = request.headers.get("x-cron-secret")
    ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : null);
  if (!sharedSecretMatches(suppliedSecret, cronSecret)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: responseHeaders },
    );
  }
  const campaigns = await prisma.outreachCampaign.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ lastRunAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: 5,
    select: { id: true, officeId: true, dailyCap: true },
  });
  const results = [];
  const startedAt = Date.now();
  for (const campaign of campaigns) {
    if (Date.now() - startedAt >= 240_000) break;
    results.push({
      ...campaign,
      result: await runOutreachCampaignBatch({
        officeId: campaign.officeId,
        campaignId: campaign.id,
        limit: Math.min(campaign.dailyCap, 50),
        pauseMs: 250,
      }),
    });
  }
  return NextResponse.json(
    { ranAt: new Date().toISOString(), campaigns: results },
    { status: 200, headers: responseHeaders },
  );
}
