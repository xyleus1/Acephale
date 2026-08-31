import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadCompanyContext } from "@/lib/company-context";
import { listCompanyContextProcurementActions } from "@/lib/supply-os/context-procurement";
import { listCompanyContextProspectingActions } from "@/lib/supply-os/context-prospecting";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(request: Request, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const threadParam = new URL(request.url).searchParams.get("thread");
  const threadId = threadParam === null ? undefined : threadParam === "general" ? null : threadParam;
  try {
    const access = supplyAccessContext(session);
    const [context, procurementActions, prospectingActions] = await Promise.all([
      loadCompanyContext(access, workspaceId, { threadId }),
      listCompanyContextProcurementActions(access, workspaceId),
      listCompanyContextProspectingActions(access, workspaceId),
    ]);
    return NextResponse.json({
      context: { ...context, procurementActions, prospectingActions },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
