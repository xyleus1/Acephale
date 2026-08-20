import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSupplyContextFactProposal } from "@/lib/supply-os/context-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string; nodeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, nodeId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const fact = await createSupplyContextFactProposal({
      context: supplyAccessContext(session), workspaceId, nodeId,
      key: body?.key, value: body?.value, evidence: body?.evidence,
      visibility: body?.visibility, proposedBy: "OPERATOR",
      supersedesFactId: typeof body?.supersedesFactId === "string" ? body.supersedesFactId : null,
    });
    return NextResponse.json({ fact }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
