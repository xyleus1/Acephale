import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sendSupplyContextOutboundDraft } from "@/lib/supply-os/context-outbound";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export async function POST(_request: Request, route: { params: Promise<{ draftId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { draftId } = await route.params;
  try {
    const draft = await sendSupplyContextOutboundDraft({ context: supplyAccessContext(session), draftId });
    return NextResponse.json({ draft });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
