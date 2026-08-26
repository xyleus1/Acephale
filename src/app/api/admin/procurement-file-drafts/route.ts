import { NextRequest, NextResponse } from "next/server";
import { operatorSecretAuthorized } from "@/lib/admin-operator-secret";
import {
  FILE_DRAFT_MAX_PER_RUN,
  listProcurementFileDraftTargets,
  runProcurementFileDraftBatch,
} from "@/lib/procurement-file-draft-batch";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

// Sourcing request ids are stored as uuid columns, so a malformed id would
// otherwise surface as a database error instead of a request error.
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function orderIdError(orderId: string) {
  if (!orderId) return "orderId is required.";
  if (!ORDER_ID_PATTERN.test(orderId)) return "orderId must be a sourcing request id.";
  return null;
}

export async function GET(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const invalid = orderIdError(orderId);
  if (invalid) return badRequest(invalid);
  try {
    const listed = await listProcurementFileDraftTargets(orderId);
    if (!listed) return notFound();
    return NextResponse.json({
      orderId: listed.order.orderId,
      material: listed.order.material,
      replied: listed.targets.length,
      pending: listed.targets.filter((target) => !target.skipReason && !target.hasDraft).length,
      drafted: listed.targets.filter((target) => target.hasDraft).length,
      skipped: listed.targets.filter((target) => target.skipReason).length,
      targets: listed.targets,
    });
  } catch (error) {
    console.error("procurement file draft preview failed", error);
    return serverError("The supplier draft preview failed.");
  }
}

export async function POST(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as {
    orderId?: unknown;
    limit?: unknown;
    redraft?: unknown;
  };
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const invalid = orderIdError(orderId);
  if (invalid) return badRequest(invalid);
  const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
    ? Math.min(FILE_DRAFT_MAX_PER_RUN, Math.max(1, Math.trunc(payload.limit)))
    : FILE_DRAFT_MAX_PER_RUN;
  try {
    const result = await runProcurementFileDraftBatch({
      orderId,
      limit,
      redraft: payload.redraft === true,
    });
    if (!result) return notFound();
    return NextResponse.json(result);
  } catch (error) {
    console.error("procurement file draft run failed", error);
    return serverError("The supplier draft run failed.");
  }
}
