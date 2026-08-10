import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { requestProcurementApproval } from "@/lib/supply-os/procurement-case-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const { caseId } = await context.params;
    const result = await requestProcurementApproval({
      context: supplyAccessContext(session),
      caseId,
      input: body,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
