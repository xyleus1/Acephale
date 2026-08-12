import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getSupplyCompanyResearch,
  storeSupplyCompanyResearch,
} from "@/lib/supply-os/customer-workspace";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import {
  getSupplyWorkspace,
  requireSupplyWorkspace,
} from "@/lib/supply-os/persistence";
import { researchCompany } from "@/lib/supply-os-company-research";

export const runtime = "nodejs";
export const maxDuration = 120;

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

export async function POST(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const access = supplyAccessContext(session);
    await requireSupplyWorkspace(access, workspaceId, "edit");
    const workspace = await getSupplyWorkspace(access, workspaceId);
    const researchQuery = [
      workspace.company?.name || workspace.name,
      workspace.company?.website,
    ].filter(Boolean).join(", ");
    const research = await researchCompany(researchQuery);
    await storeSupplyCompanyResearch({ context: access, workspaceId, research });
    return NextResponse.json(
      { research, capturedAt: research.researchedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
