import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ContextAgentError, chatWithCompanyContext } from "@/lib/supply-os/context-agent";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const result = await chatWithCompanyContext({
      context: supplyAccessContext(session),
      workspaceId,
      instruction: body?.instruction,
      threadId: body?.threadId,
    });
    return NextResponse.json({ result, messageSaved: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ContextAgentError) {
      return NextResponse.json(
        { error: error.message, messageSaved: error.messageSaved },
        { status: error.code === "invalid_input" ? 400 : 503 },
      );
    }
    return supplyErrorResponse(error);
  }
}
