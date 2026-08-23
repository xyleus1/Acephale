import { NextRequest, NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { resolveCustomerContextAccessForWorkspace } from "@/lib/customer-context-access";
import { ProcurementWorkflowError } from "@/lib/procurement-workflow";
import {
  confirmCompanyContextProcurementAction,
  dismissCompanyContextProcurementAction,
  projectCompanyContextProcurementActionForCustomer,
} from "@/lib/supply-os/context-procurement";
import { supplyErrorResponse } from "@/lib/supply-os/http";

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
  const message = error.code === "configuration"
    ? "Procurement is not available. Contact your Derya operator."
    : error.code === "unavailable"
      ? "Procurement did not start. Try again."
      : error.message;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: NextRequest,
  route: { params: Promise<{ workspaceId: string; actionId: string }> },
) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, actionId } = await route.params;
  const access = await resolveCustomerContextAccessForWorkspace(principal, workspaceId);
  if (!access) return NextResponse.json({ error: "Procurement request not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const decision = body?.decision;
  if (decision !== "confirm" && decision !== "dismiss") {
    return NextResponse.json({ error: "Choose confirm or dismiss." }, { status: 400 });
  }
  try {
    const action = decision === "confirm"
      ? await confirmCompanyContextProcurementAction({ context: access, workspaceId, actionId })
      : await dismissCompanyContextProcurementAction({ context: access, workspaceId, actionId });
    return NextResponse.json(
      { action: projectCompanyContextProcurementActionForCustomer(action) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ProcurementWorkflowError) return procurementErrorResponse(error);
    return supplyErrorResponse(error);
  }
}
