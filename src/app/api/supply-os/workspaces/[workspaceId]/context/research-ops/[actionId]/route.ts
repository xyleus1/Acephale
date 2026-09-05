import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  dismissCompanyContextResearchOperation,
  runCompanyContextResearchOperation,
} from "@/lib/supply-os/context-research-ops";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  route: { params: Promise<{ workspaceId: string; actionId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.accessKind === "customer" || session.role === "CUSTOMER") {
    return NextResponse.json({ error: "Research operations are not available for customer access." }, { status: 403 });
  }
  const { workspaceId, actionId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const decision = body?.decision;
  if (decision !== "run" && decision !== "dismiss") {
    return NextResponse.json({ error: "Choose run or dismiss." }, { status: 400 });
  }
  try {
    const context = supplyAccessContext(session);
    const operation = decision === "run"
      ? await runCompanyContextResearchOperation({ context, workspaceId, actionId })
      : await dismissCompanyContextResearchOperation({ context, workspaceId, actionId });
    return NextResponse.json({ operation }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
