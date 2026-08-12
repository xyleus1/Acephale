import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { listSupplyWorkspaces } from "@/lib/supply-os/persistence";
import {
  createSupplyCustomerWorkspace,
  storeSupplyCompanyResearch,
} from "@/lib/supply-os/customer-workspace";
import { researchCompany } from "@/lib/supply-os-company-research";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const workspaces = await listSupplyWorkspaces(supplyAccessContext(session));
    return NextResponse.json({ workspaces }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    name?: unknown;
    website?: unknown;
  } | null;
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }
  try {
    const context = supplyAccessContext(session);
    const result = await createSupplyCustomerWorkspace(context, {
      name: body.name,
      website: typeof body.website === "string" ? body.website : null,
    });
    let warning: string | null = null;
    if (result.normalized.website) {
      try {
        const research = await researchCompany(`${result.company.name}, ${result.normalized.website}`);
        await storeSupplyCompanyResearch({ context, workspaceId: result.workspace.id, research });
      } catch {
        warning = "The company was created, but its public profile could not be built. Retry with the official website later.";
      }
    }
    return NextResponse.json(
      { workspace: result.workspace, company: result.company, created: result.created, warning },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
