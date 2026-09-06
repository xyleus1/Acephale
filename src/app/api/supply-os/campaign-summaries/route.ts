import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  CAMPAIGN_STATUSES_ALL,
  listCampaignSummaries,
} from "@/lib/outreach-campaigns";
import { isSchemaNotReadyError, OUTREACH_SCHEMA_NOT_READY_MESSAGE } from "@/lib/outreach-readiness";

export async function GET() {
  const session = await getSession();
  if (!session || session.accessKind === "customer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const campaigns = await listCampaignSummaries(session.officeId, CAMPAIGN_STATUSES_ALL);
    return NextResponse.json({ campaigns }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (isSchemaNotReadyError(error)) {
      return NextResponse.json({ error: OUTREACH_SCHEMA_NOT_READY_MESSAGE }, { status: 503 });
    }
    throw error;
  }
}
