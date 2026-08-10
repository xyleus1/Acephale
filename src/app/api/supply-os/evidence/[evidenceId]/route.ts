import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { procurementEvidenceSource } from "@/lib/supply-os/procurement-case-persistence";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ evidenceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { evidenceId } = await context.params;
    const evidence = await procurementEvidenceSource(supplyAccessContext(session), evidenceId);
    const response = NextResponse.redirect(new URL(evidence.url), 307);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
