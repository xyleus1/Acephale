import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { publishSupplyContextAgentMessage } from "@/lib/supply-os/context-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export async function POST(_request: Request, route: { params: Promise<{ workspaceId: string; messageId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, messageId } = await route.params;
  try {
    const message = await publishSupplyContextAgentMessage({ context: supplyAccessContext(session), workspaceId, messageId });
    return NextResponse.json({ message });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
