import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import {
  GUILD_SUPPLIER_CAMPAIGN_KEY,
  pollGuildSupplierResearchCampaign,
  startOrResumeGuildSupplierResearchCampaign,
  type SupplierResearchCampaignRequest,
  type SupplierResearchCampaignStatusResponse,
} from "@/lib/supply-os/supplier-research-campaign";

export const runtime = "nodejs";
export const maxDuration = 30;

const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function campaignRequest(value: unknown): SupplierResearchCampaignRequest | null {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const campaignKey = optionalText(raw.campaignKey, 80);
  if (Object.hasOwn(raw, "workspaceId") || campaignKey === null || (campaignKey && campaignKey !== GUILD_SUPPLIER_CAMPAIGN_KEY)) return null;
  return {
    campaignKey: GUILD_SUPPLIER_CAMPAIGN_KEY,
  };
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = campaignRequest(body);
  if (!parsed) return NextResponse.json({ error: "A valid supplier research campaign request is required." }, { status: 400 });
  try {
    const result = await startOrResumeGuildSupplierResearchCampaign({
      context: supplyAccessContext(session),
    });
    return NextResponse.json(result, {
      status: result.campaign.state === "COMPLETE" ? 200 : 202,
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = campaignRequest({
    campaignKey: request.nextUrl.searchParams.get("campaignKey") ?? undefined,
  });
  if (!parsed) return NextResponse.json({ error: "A valid supplier research campaign request is required." }, { status: 400 });
  try {
    const response: SupplierResearchCampaignStatusResponse = {
      campaign: await pollGuildSupplierResearchCampaign({
        context: supplyAccessContext(session),
      }),
    };
    return NextResponse.json(response, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
