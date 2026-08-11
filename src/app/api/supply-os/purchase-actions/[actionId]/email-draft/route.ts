import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProcurementCaseByRelatedTaskId } from "@/lib/supply-os/procurement-case-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { savePurchaseOrderEmailDraft } from "@/lib/supply-os/purchase-order-communication-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ actionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const { actionId } = await context.params;
    const access = supplyAccessContext(session);
    await savePurchaseOrderEmailDraft({ context: access, purchaseActionId: actionId, input: body });
    const procurementCase = await findProcurementCaseByRelatedTaskId(access, actionId);
    if (!procurementCase) throw new Error("The saved purchase order email draft could not be reloaded.");
    return NextResponse.json({ procurementCase }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
