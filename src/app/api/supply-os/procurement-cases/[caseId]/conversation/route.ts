import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { historicalProcurementConversation } from "@/lib/procurement-conversation";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { caseId } = await context.params;
    const conversation = await historicalProcurementConversation(
      supplyAccessContext(session),
      caseId,
    );
    return NextResponse.json({ conversation }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
