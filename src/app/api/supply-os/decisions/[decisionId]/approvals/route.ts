import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  requestSupplyDecisionApproval,
  type RequestSupplyApprovalInput,
} from "@/lib/supply-os/execution";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ decisionId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Approval request JSON is required." }, { status: 400 });
  }
  const { decisionId } = await context.params;
  try {
    const approval = await requestSupplyDecisionApproval(
      supplyAccessContext(session),
      decisionId,
      body as RequestSupplyApprovalInput,
    );
    return NextResponse.json({ approval }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
