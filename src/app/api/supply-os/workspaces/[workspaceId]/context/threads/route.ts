import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CompanyContextLimitError, createCompanyContextChatThread } from "@/lib/company-context";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const thread = await createCompanyContextChatThread({
      context: supplyAccessContext(session),
      workspaceId,
      title: body?.title,
    });
    return NextResponse.json({ thread }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof CompanyContextLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return supplyErrorResponse(error);
  }
}
