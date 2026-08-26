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

export async function GET(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The supplier draft preview failed." },
      { status: 500 },
    );
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
  if (!orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The supplier draft run failed." },
      { status: 500 },
    );
  }
}
