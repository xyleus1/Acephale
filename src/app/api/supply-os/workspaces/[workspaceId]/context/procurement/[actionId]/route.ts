import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ProcurementWorkflowError } from "@/lib/procurement-workflow";
import {
  confirmCompanyContextProcurementAction,
  dismissCompanyContextProcurementAction,
  hideCompanyContextProcurementAction,
} from "@/lib/supply-os/context-procurement";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 60;

function procurementErrorResponse(error: ProcurementWorkflowError) {
  const status = error.code === "forbidden"
    ? 403
    : error.code === "not_found"
      ? 404
      : error.code === "conflict" || error.code === "configuration"
        ? 409
        : 503;
  return NextResponse.json({ error: error.message }, { status });
}

export async function POST(
  request: NextRequest,
  route: { params: Promise<{ workspaceId: string; actionId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, actionId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const decision = body?.decision;
  if (decision !== "confirm" && decision !== "dismiss" && decision !== "hide") {
    return NextResponse.json({ error: "Choose confirm, dismiss, or hide." }, { status: 400 });
  }
  try {
    const access = supplyAccessContext(session);
    const action = decision === "confirm"
      ? await confirmCompanyContextProcurementAction({ context: access, workspaceId, actionId })
      : decision === "hide"
        ? await hideCompanyContextProcurementAction({ context: access, workspaceId, actionId })
        : await dismissCompanyContextProcurementAction({ context: access, workspaceId, actionId });
    return NextResponse.json({ action }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ProcurementWorkflowError) return procurementErrorResponse(error);
    return supplyErrorResponse(error);
  }
}
