import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { linkSupplyContextSource } from "@/lib/supply-os/context-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string; nodeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, nodeId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const link = await linkSupplyContextSource({
      context: supplyAccessContext(session), workspaceId, nodeId,
      sourceType: body?.sourceType, sourceId: body?.sourceId, label: body?.label, visibility: body?.visibility,
    });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
