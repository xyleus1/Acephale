import { NextRequest, NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { resolveCustomerContextAccessForWorkspace } from "@/lib/customer-context-access";
import { createCompanyContextChatThread } from "@/lib/company-context";
import { supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const access = await resolveCustomerContextAccessForWorkspace(principal, workspaceId);
  if (!access) return NextResponse.json({ error: "Context not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const thread = await createCompanyContextChatThread({
      context: access,
      workspaceId,
      title: body?.title,
    });
    return NextResponse.json({ thread }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
