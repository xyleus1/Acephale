import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadCompanyContextActivity } from "@/lib/company-context";
import { listCompanyContextProcurementActions } from "@/lib/supply-os/context-procurement";
import { listCompanyContextProspectingActions } from "@/lib/supply-os/context-prospecting";
import { listCompanyContextResearchOperations } from "@/lib/supply-os/context-research-ops";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(_request: Request, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  try {
    const access = supplyAccessContext(session);
    const [activity, procurementActions, prospectingActions, researchOperations] = await Promise.all([
      loadCompanyContextActivity(access, workspaceId),
      listCompanyContextProcurementActions(access, workspaceId),
      listCompanyContextProspectingActions(access, workspaceId),
      listCompanyContextResearchOperations(access, workspaceId),
    ]);
    const pendingActions = procurementActions.filter((action) => action.status === "PENDING").length
      + prospectingActions.filter((action) => action.status === "PENDING").length
      + researchOperations.filter((action) => action.status === "PENDING").length;
    return NextResponse.json({
      activity: {
        lastAgentMessageAt: activity.lastAgentMessageAt,
        openQuestions: activity.openQuestions,
        pendingActions,
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
