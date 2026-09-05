import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  CAMPAIGN_STATUSES_ALL,
  listCampaignSummaries,
} from "@/lib/outreach-campaigns";

export async function GET() {
  const session = await getSession();
  if (!session || session.accessKind === "customer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const campaigns = await listCampaignSummaries(session.officeId, CAMPAIGN_STATUSES_ALL);
  return NextResponse.json({ campaigns }, { headers: { "cache-control": "no-store" } });
}
