import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadCompanyContext } from "@/lib/company-context";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(_request: Request, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  try {
    const context = await loadCompanyContext(supplyAccessContext(session), workspaceId);
    return NextResponse.json({ context }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
