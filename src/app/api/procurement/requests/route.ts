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
  return handleProcurementList(undefined, {
    sourceCampaign: request.nextUrl.searchParams.get("sourceCampaign"),
  });
}
