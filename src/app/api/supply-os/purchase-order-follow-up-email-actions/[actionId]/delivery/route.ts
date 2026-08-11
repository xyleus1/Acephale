import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProcurementCaseByRelatedTaskId } from "@/lib/supply-os/procurement-case-persistence";
import {
  reconcilePurchaseOrderFollowUpAction,
  resetPurchaseOrderFollowUpForRetry,
  sendPurchaseOrderFollowUpAction,
} from "@/lib/supply-os/purchase-order-followup-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ actionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const { actionId } = await context.params;
    const access = supplyAccessContext(session);
    if (body?.operation === "SEND") await sendPurchaseOrderFollowUpAction({ context: access, actionId });
    else if (body?.operation === "RECONCILE") await reconcilePurchaseOrderFollowUpAction({ context: access, actionId });
    else if (body?.operation === "RESET") await resetPurchaseOrderFollowUpForRetry({ context: access, actionId, input: body });
    else return NextResponse.json({ error: "Operation must be SEND, RECONCILE, or RESET." }, { status: 400 });
    const procurementCase = await findProcurementCaseByRelatedTaskId(access, actionId);
    if (!procurementCase) throw new Error("The supplier follow-up delivery state could not be reloaded.");
    return NextResponse.json({ procurementCase }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
