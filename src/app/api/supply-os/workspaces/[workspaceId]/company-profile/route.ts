import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSupplyCompanyResearch } from "@/lib/supply-os/customer-workspace";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const profile = await getSupplyCompanyResearch(supplyAccessContext(session), workspaceId);
    return NextResponse.json(
      { research: profile?.payload ?? null, capturedAt: profile?.capturedAt ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
