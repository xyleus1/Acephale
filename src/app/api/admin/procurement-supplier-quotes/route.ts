import { NextRequest, NextResponse } from "next/server";
import { operatorSecretAuthorized } from "@/lib/admin-operator-secret";
import { procurementOrderIdError } from "@/lib/procurement-order-id";
import {
  QUOTE_CAPTURE_MAX_PER_RUN,
  QUOTE_CAPTURE_MAX_READS_PER_RUN,
  listSupplierQuoteCandidates,
  runSupplierQuoteCapture,
} from "@/lib/procurement-supplier-quote";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// Left absent, the pass reads every respondent it can afford and still writes
// at most one batch, so a large reply set is worked through instead of reread.
function boundedLimit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(QUOTE_CAPTURE_MAX_PER_RUN, Math.max(1, Math.trunc(value)))
    : undefined;
}

// Reading carries its own budget, so asking for a small write batch does not
// shrink how much of the reply set a pass looks at.
function boundedReads(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(QUOTE_CAPTURE_MAX_READS_PER_RUN, Math.max(1, Math.trunc(value)))
    : undefined;
}

function cursor(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// Reading a reply changes nothing, so the plan shows what each answer carries
// and which answers fall short of a price plus a lead time.
export async function GET(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return badRequest(invalid);
  const readsParam = req.nextUrl.searchParams.get("reads") ?? req.nextUrl.searchParams.get("limit");
  try {
    const plan = await listSupplierQuoteCandidates({
      orderId,
      reads: boundedReads(readsParam === null ? undefined : Number(readsParam)),
      after: cursor(req.nextUrl.searchParams.get("after")),
    });
    if (!plan) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    return NextResponse.json({
      orderId: plan.orderId,
      material: plan.material,
      complete: plan.candidates.filter((candidate) => candidate.state === "COMPLETE").length,
      partial: plan.candidates.filter((candidate) => candidate.state === "PARTIAL").length,
      candidates: plan.candidates,
      nextCursor: plan.nextCursor,
    });
  } catch (error) {
    console.error("procurement supplier quote plan failed", error);
    return NextResponse.json({ error: "The supplier quote plan failed." }, { status: 500 });
  }
}

// Recording a quote writes only supplier stated facts onto rows that hold none,
// so it needs no send confirmation and mails nobody.
export async function POST(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as {
    orderId?: unknown;
    limit?: unknown;
    reads?: unknown;
    after?: unknown;
  };
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return badRequest(invalid);
  try {
    const result = await runSupplierQuoteCapture({
      orderId,
      limit: boundedLimit(payload.limit),
      reads: boundedReads(payload.reads),
      after: cursor(payload.after),
    });
    if (!result) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("procurement supplier quote capture failed", error);
    return NextResponse.json({ error: "The supplier quote capture failed." }, { status: 500 });
  }
}
