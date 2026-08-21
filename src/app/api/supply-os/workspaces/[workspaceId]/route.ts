import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { getSupplyWorkspace } from "@/lib/supply-os/persistence";
import {
  archiveSupplyCustomerWorkspace,
  updateSupplyCustomerWorkspace,
} from "@/lib/supply-os/customer-workspace";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const workspace = await getSupplyWorkspace(supplyAccessContext(session), workspaceId);
    return NextResponse.json({ workspace }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  const body = await request.json().catch(() => null) as {
    name?: unknown;
    website?: unknown;
  } | null;
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }
  try {
    const result = await updateSupplyCustomerWorkspace(
      supplyAccessContext(session),
      workspaceId,
      {
        name: body.name,
        website: typeof body.website === "string" ? body.website : null,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const archived = await archiveSupplyCustomerWorkspace(supplyAccessContext(session), workspaceId);
    return NextResponse.json({ archived });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
