import { NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { resolveCustomerContextAccessForWorkspace } from "@/lib/customer-context-access";
import { loadCompanyContext } from "@/lib/company-context";
import {
  listCompanyContextProcurementActions,
  projectCompanyContextProcurementActionForCustomer,
} from "@/lib/supply-os/context-procurement";
import { supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(request: Request, route: { params: Promise<{ workspaceId: string }> }) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const threadParam = new URL(request.url).searchParams.get("thread");
  const threadId = threadParam === null ? undefined : threadParam === "general" ? null : threadParam;
  const access = await resolveCustomerContextAccessForWorkspace(principal, workspaceId);
  if (!access) return NextResponse.json({ error: "Context not found." }, { status: 404 });
  try {
    const [context, procurementActions] = await Promise.all([
      loadCompanyContext(access, workspaceId, { threadId }),
      listCompanyContextProcurementActions(access, workspaceId),
    ]);
    return NextResponse.json(
      {
        context: {
          ...context,
          procurementActions: procurementActions.map(projectCompanyContextProcurementActionForCustomer),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
