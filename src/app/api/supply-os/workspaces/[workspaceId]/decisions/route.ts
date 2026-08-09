import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSupplyDecision, type CreateSupplyDecisionInput } from "@/lib/supply-os/execution";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 192_000;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Decision request is too large." }, { status: 413 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Decision JSON is required." }, { status: 400 });
  }
  const { workspaceId } = await context.params;
  try {
    const decision = await createSupplyDecision(
      supplyAccessContext(session),
      workspaceId,
      body as CreateSupplyDecisionInput,
    );
    return NextResponse.json({ decision }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
