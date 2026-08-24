import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import {
  getSupplyWorkspaceManagement,
  updateSupplyWorkspaceManagement,
  updateSupplyWorkspaceWebsite,
} from "@/lib/supply-os/workspace-management";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    return NextResponse.json({ settings: await getSupplyWorkspaceManagement(supplyAccessContext(session), workspaceId) });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  const body = await request.json().catch(() => null) as { action?: unknown; website?: unknown; base?: Record<string, unknown> } | null;
  if (body?.action !== "base" && body?.action !== "website") {
    return NextResponse.json({ error: "A settings action is required." }, { status: 400 });
  }
  if (body.action === "base" && !body.base) {
    return NextResponse.json({ error: "Logistics base is required." }, { status: 400 });
  }
  const base = body.base;
  try {
    const access = supplyAccessContext(session);
    const settings = body.action === "website"
      ? await updateSupplyWorkspaceWebsite(access, workspaceId, {
          website: typeof body.website === "string" ? body.website : null,
        })
      : await updateSupplyWorkspaceManagement(access, workspaceId, { base: {
        name: typeof base?.name === "string" ? base.name : "",
        addressLine: typeof base?.addressLine === "string" ? base.addressLine : "",
        city: typeof base?.city === "string" ? base.city : "",
        region: typeof base?.region === "string" ? base.region : null,
        postalCode: typeof base?.postalCode === "string" ? base.postalCode : null,
        countryCode: typeof base?.countryCode === "string" ? base.countryCode : "",
      } });
    return NextResponse.json({ settings });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
