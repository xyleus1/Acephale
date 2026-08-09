import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { proposeSupplyDecision } from "@/lib/supply-os/execution";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ decisionId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { decisionId } = await context.params;
  try {
    const decision = await proposeSupplyDecision(supplyAccessContext(session), decisionId);
    return NextResponse.json({ decision });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
