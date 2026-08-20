import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { reconcileSupplyContextOutboundDraft } from "@/lib/supply-os/context-outbound";

export const runtime = "nodejs";

export async function POST(_request: Request, route: { params: Promise<{ draftId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { draftId } = await route.params;
  try {
    const draft = await reconcileSupplyContextOutboundDraft({ context: supplyAccessContext(session), draftId });
    return NextResponse.json({ draft }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
