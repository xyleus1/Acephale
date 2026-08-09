import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { createSupplyWorkspace, listSupplyWorkspaces } from "@/lib/supply-os/persistence";

export const runtime = "nodejs";

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
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can create company workspaces." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as {
    name?: unknown;
    companyId?: unknown;
    externalKey?: unknown;
  } | null;
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "Workspace name is required." }, { status: 400 });
  }
  try {
    const workspace = await createSupplyWorkspace(supplyAccessContext(session), {
      name: body.name,
      companyId: typeof body.companyId === "string" ? body.companyId : null,
      externalKey: typeof body.externalKey === "string" ? body.externalKey : null,
    });
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
