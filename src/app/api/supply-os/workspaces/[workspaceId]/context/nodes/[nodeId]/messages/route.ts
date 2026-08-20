import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { appendSupplyContextMessage } from "@/lib/supply-os/context-persistence";

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string; nodeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, nodeId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const message = await appendSupplyContextMessage({
      context: supplyAccessContext(session),
      workspaceId,
      nodeId,
      body: body?.body,
      visibility: body?.visibility,
      publish: body?.publish === true,
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
