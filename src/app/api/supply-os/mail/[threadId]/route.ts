import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOfficeMailThread } from "@/lib/supply-os/office-mail";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  route: { params: Promise<{ threadId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { threadId } = await route.params;
    const thread = await getOfficeMailThread(supplyAccessContext(session), threadId);
    return NextResponse.json(thread, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
