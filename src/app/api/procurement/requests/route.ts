import { NextRequest } from "next/server";
import {
  handleProcurementList,
  handleProcurementPost,
} from "@/lib/procurement-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleProcurementPost(request);
}

export async function GET(request: NextRequest) {
  const activeOnly = request.nextUrl.searchParams.get("activeOnly");
  if (activeOnly !== null && activeOnly !== "true" && activeOnly !== "false") {
    return Response.json({ error: "Invalid active-only filter." }, {
      status: 400,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  return handleProcurementList(undefined, {
    sourceCampaign: request.nextUrl.searchParams.get("sourceCampaign"),
    sourceWorkspaceId: request.nextUrl.searchParams.get("sourceWorkspaceId"),
    sourceCompanyName: request.nextUrl.searchParams.get("sourceCompanyName"),
    activeOnly: activeOnly === "true",
  });
}
