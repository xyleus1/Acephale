import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { findProcurementCaseByRelatedTaskId } from "@/lib/supply-os/procurement-case-persistence";
import { ResearchRateLimiter } from "@/lib/supply-os/research";
import { extractConnectedSupplierQuoteTerms } from "@/lib/supply-os/supplier-quote-extraction-persistence";

export const runtime = "nodejs";
export const maxDuration = 120;

const limiter = new ResearchRateLimiter(60, 60 * 60 * 1_000);

export async function POST(
  _request: Request,
  context: { params: Promise<{ quoteCycleId: string; evidenceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!limiter.consume(`${session.officeId}:${session.userId}`)) {
    return NextResponse.json({ error: "Supplier quote extraction rate limit reached." }, { status: 429 });
  }
  try {
    const { quoteCycleId, evidenceId } = await context.params;
    const access = supplyAccessContext(session);
    const extractionRun = await extractConnectedSupplierQuoteTerms({
      context: access,
      quoteCycleId,
      sourceEvidenceId: evidenceId,
    });
    const procurementCase = await findProcurementCaseByRelatedTaskId(access, quoteCycleId);
    if (!procurementCase) return NextResponse.json({ error: "Procurement case was not found." }, { status: 404 });
    return NextResponse.json({ extractionRun, procurementCase }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
