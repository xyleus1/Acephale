import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadCompanyContext } from "@/lib/company-context";
import { listCompanyContextProcurementActions } from "@/lib/supply-os/context-procurement";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(_request: Request, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  try {
    const access = supplyAccessContext(session);
    const [context, procurementActions] = await Promise.all([
      loadCompanyContext(access, workspaceId),
      listCompanyContextProcurementActions(access, workspaceId),
    ]);
    return NextResponse.json({
      context: { ...context, procurementActions },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
