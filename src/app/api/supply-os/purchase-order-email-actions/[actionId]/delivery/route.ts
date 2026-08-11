import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProcurementCaseByRelatedTaskId } from "@/lib/supply-os/procurement-case-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import {
  reconcilePurchaseOrderEmailAction,
  resetPurchaseOrderEmailForRetry,
  sendPurchaseOrderEmailAction,
} from "@/lib/supply-os/purchase-order-communication-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ actionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const { actionId } = await context.params;
    const access = supplyAccessContext(session);
    if (body?.operation === "SEND") await sendPurchaseOrderEmailAction({ context: access, actionId });
    else if (body?.operation === "RECONCILE") await reconcilePurchaseOrderEmailAction({ context: access, actionId });
    else if (body?.operation === "RESET") await resetPurchaseOrderEmailForRetry({ context: access, actionId, input: body });
    else return NextResponse.json({ error: "Operation must be SEND, RECONCILE, or RESET." }, { status: 400 });
    const procurementCase = await findProcurementCaseByRelatedTaskId(access, actionId);
    if (!procurementCase) throw new Error("The purchase order email delivery state could not be reloaded.");
    return NextResponse.json({ procurementCase }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
