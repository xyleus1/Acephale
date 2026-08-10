import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { listProcurementCases } from "@/lib/supply-os/procurement-case-persistence";
import { captureConnectedSupplierReplies } from "@/lib/supply-os/supplier-reply-persistence";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_request: Request, context: { params: Promise<{ quoteCycleId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { quoteCycleId } = await context.params;
    const access = supplyAccessContext(session);
    const result = await captureConnectedSupplierReplies({ context: access, quoteCycleId });
    const procurementCase = (await listProcurementCases(access)).find((entry) => entry.quoteCycle?.id === quoteCycleId) ?? null;
    return NextResponse.json({ ...result, procurementCase }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
