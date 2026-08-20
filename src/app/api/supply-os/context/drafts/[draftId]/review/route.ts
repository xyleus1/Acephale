import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reviewSupplyContextOutboundDraft } from "@/lib/supply-os/context-outbound";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export async function POST(request: NextRequest, route: { params: Promise<{ draftId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { draftId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const draft = await reviewSupplyContextOutboundDraft({ context: supplyAccessContext(session), draftId, decision: body?.decision });
    return NextResponse.json({ draft });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
