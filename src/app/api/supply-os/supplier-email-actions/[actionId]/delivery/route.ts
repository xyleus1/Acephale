import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProcurementCaseByRelatedTaskId } from "@/lib/supply-os/procurement-case-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import {
  reconcileSupplierEmailAction,
  resetSupplierEmailForRetry,
  sendSupplierEmailAction,
} from "@/lib/supply-os/supplier-communication-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ actionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const { actionId } = await context.params;
    const access = supplyAccessContext(session);
    if (body?.operation === "SEND") await sendSupplierEmailAction({ context: access, actionId });
    else if (body?.operation === "RECONCILE") await reconcileSupplierEmailAction({ context: access, actionId });
    else if (body?.operation === "RESET") await resetSupplierEmailForRetry({ context: access, actionId, input: body });
    else return NextResponse.json({ error: "Operation must be SEND, RECONCILE, or RESET." }, { status: 400 });
    const procurementCase = await findProcurementCaseByRelatedTaskId(access, actionId);
    if (!procurementCase) throw new Error("The supplier email delivery state could not be reloaded.");
    return NextResponse.json({ procurementCase }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
