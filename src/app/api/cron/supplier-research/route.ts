import { NextRequest, NextResponse } from "next/server";
import { advanceSupplierResearchCampaigns } from "@/lib/supply-os/supplier-research-campaign";
import { runQueuedSourcingResearchWorkers } from "@/lib/supply-os/supplier-research-worker";

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

  try {
    const campaigns = await advanceSupplierResearchCampaigns();
    const result = await runQueuedSourcingResearchWorkers({ limit: 2 });
    const reconciledCampaigns = await advanceSupplierResearchCampaigns();
    return NextResponse.json({ ranAt: new Date().toISOString(), campaigns, reconciledCampaigns, ...result }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "Supplier research queue failed." }, {
      status: 500,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
}
