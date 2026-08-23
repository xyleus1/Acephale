import { NextRequest, NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { resolveCustomerContextAccessForWorkspace } from "@/lib/customer-context-access";
import { ContextAgentError, chatWithCompanyContext } from "@/lib/supply-os/context-agent";
import { projectCompanyContextProcurementActionForCustomer } from "@/lib/supply-os/context-procurement";
import { supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const access = await resolveCustomerContextAccessForWorkspace(principal, workspaceId);
  if (!access) return NextResponse.json({ error: "Context not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const result = await chatWithCompanyContext({
      context: access,
      workspaceId,
      instruction: body?.instruction,
    });
    return NextResponse.json(
      {
        result: {
          ...result,
          procurementActions: result.procurementActions.map(projectCompanyContextProcurementActionForCustomer),
        },
        messageSaved: true,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ContextAgentError) {
      return NextResponse.json(
        { error: error.message, messageSaved: error.messageSaved },
        { status: error.code === "invalid_input" ? 400 : error.code === "rate_limited" ? 429 : 503 },
      );
    }
    return supplyErrorResponse(error);
  }
}
