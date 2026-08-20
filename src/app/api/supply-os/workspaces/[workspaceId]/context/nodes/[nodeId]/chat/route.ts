import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ContextAgentError, chatWithSupplyContext } from "@/lib/supply-os/context-agent";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string; nodeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, nodeId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const result = await chatWithSupplyContext({ context: supplyAccessContext(session), workspaceId, nodeId, instruction: body?.instruction });
    return NextResponse.json({ result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ContextAgentError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "invalid_input" ? 400 : 503 });
    }
    return supplyErrorResponse(error);
  }
}
