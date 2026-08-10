import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { findProcurementCaseById, saveSupplierQuoteRequest } from "@/lib/supply-os/procurement-case-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const { caseId } = await context.params;
    const access = supplyAccessContext(session);
    const result = await saveSupplierQuoteRequest({
      context: access,
      caseId,
      input: body,
    });
    const procurementCase = await findProcurementCaseById(access, caseId) ?? result.procurementCase;
    return NextResponse.json({ ...result, procurementCase }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
