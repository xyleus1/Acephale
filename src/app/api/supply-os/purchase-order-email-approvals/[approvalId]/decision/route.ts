import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findProcurementCaseByRelatedTaskId } from "@/lib/supply-os/procurement-case-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { decidePurchaseOrderEmailApproval } from "@/lib/supply-os/purchase-order-communication-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ approvalId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const { approvalId } = await context.params;
    const access = supplyAccessContext(session);
    const result = await decidePurchaseOrderEmailApproval({ context: access, approvalId, input: body });
    const procurementCase = await findProcurementCaseByRelatedTaskId(access, result.action.id);
    if (!procurementCase) throw new Error("The purchase order email decision could not be reloaded.");
    return NextResponse.json({ procurementCase }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
