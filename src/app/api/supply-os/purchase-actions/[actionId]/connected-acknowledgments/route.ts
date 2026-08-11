import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProcurementCaseByRelatedTaskId } from "@/lib/supply-os/procurement-case-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { captureConnectedPurchaseOrderReplies } from "@/lib/supply-os/supplier-reply-persistence";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, context: { params: Promise<{ actionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { actionId } = await context.params;
    const access = supplyAccessContext(session);
    await captureConnectedPurchaseOrderReplies({ context: access, purchaseActionId: actionId });
    const procurementCase = await findProcurementCaseByRelatedTaskId(access, actionId);
    if (!procurementCase) throw new Error("The connected purchase order replies could not be reloaded.");
    return NextResponse.json({ procurementCase }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
