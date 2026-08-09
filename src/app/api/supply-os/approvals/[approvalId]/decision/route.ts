import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { decideSupplyApproval } from "@/lib/supply-os/execution";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ approvalId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { decision?: unknown; note?: unknown } | null;
  if (body?.decision !== "APPROVE" && body?.decision !== "REJECT") {
    return NextResponse.json({ error: "Decision must be APPROVE or REJECT." }, { status: 400 });
  }
  const { approvalId } = await context.params;
  try {
    const approval = await decideSupplyApproval(supplyAccessContext(session), approvalId, {
      decision: body.decision,
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json({ approval });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
