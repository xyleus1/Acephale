import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listProcurementCases } from "@/lib/supply-os/procurement-case-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { requestSupplierEmailApproval } from "@/lib/supply-os/supplier-communication-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ draftId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const { draftId } = await context.params;
    const access = supplyAccessContext(session);
    await requestSupplierEmailApproval({ context: access, draftId, input: body });
    const procurementCase = (await listProcurementCases(access)).find((entry) => entry.supplierEmailDraft?.id === draftId);
    if (!procurementCase) throw new Error("The supplier email approval could not be reloaded.");
    return NextResponse.json({ procurementCase }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
