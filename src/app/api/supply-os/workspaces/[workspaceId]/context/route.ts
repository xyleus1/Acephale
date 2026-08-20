import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { assembleSupplyContext, createSupplyContextNode } from "@/lib/supply-os/context-persistence";

export const runtime = "nodejs";

export async function GET(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  try {
    const context = await assembleSupplyContext({
      context: supplyAccessContext(session),
      workspaceId,
      nodeId: request.nextUrl.searchParams.get("node"),
    });
    return NextResponse.json({ context }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const node = await createSupplyContextNode({
      context: supplyAccessContext(session),
      workspaceId,
      parentId: String(body?.parentId ?? ""),
      scopeType: body?.scopeType,
      name: body?.name,
      description: body?.description,
      visibility: body?.visibility,
    });
    return NextResponse.json({ node }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
