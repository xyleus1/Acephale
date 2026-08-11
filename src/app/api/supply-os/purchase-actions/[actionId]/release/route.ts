import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { recordPurchaseOrderRelease } from "@/lib/supply-os/procurement-case-persistence";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ actionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const { actionId } = await context.params;
    const result = await recordPurchaseOrderRelease({
      context: supplyAccessContext(session),
      actionId,
      input: body,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
