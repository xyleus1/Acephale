import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { promoteSupplyContextFact } from "@/lib/supply-os/context-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string; factId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, factId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const fact = await promoteSupplyContextFact({ context: supplyAccessContext(session), workspaceId, factId, targetNodeId: String(body?.targetNodeId ?? "") });
    return NextResponse.json({ fact }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
