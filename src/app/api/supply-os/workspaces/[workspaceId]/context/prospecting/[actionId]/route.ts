import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  dismissCompanyContextProspectingAction,
  hideCompanyContextProspectingAction,
  runCompanyContextProspectingAction,
} from "@/lib/supply-os/context-prospecting";
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
    return NextResponse.json({ error: "Prospecting is not available for customer access." }, { status: 403 });
  }
  const { workspaceId, actionId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const decision = body?.decision;
  if (decision !== "run" && decision !== "dismiss" && decision !== "hide") {
    return NextResponse.json({ error: "Choose run, dismiss, or hide." }, { status: 400 });
  }
  try {
    const context = supplyAccessContext(session);
    const action = decision === "run"
      ? await runCompanyContextProspectingAction({ context, workspaceId, actionId })
      : decision === "hide"
        ? await hideCompanyContextProspectingAction({ context, workspaceId, actionId })
        : await dismissCompanyContextProspectingAction({ context, workspaceId, actionId });
    return NextResponse.json({ action }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
