import { NextRequest, NextResponse } from "next/server";
import { operatorSecretAuthorized } from "@/lib/admin-operator-secret";
import { procurementOrderIdError } from "@/lib/procurement-order-id";
import {
  NUDGE_CONFIRMATION,
  NUDGE_MAX_PER_RUN,
  listSupplierNudgeTargets,
  reconcileProcurementSupplierNudges,
  runProcurementSupplierNudges,
} from "@/lib/procurement-supplier-nudge";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function boundedLimit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(NUDGE_MAX_PER_RUN, Math.max(1, Math.trunc(value)))
    : NUDGE_MAX_PER_RUN;
}

// A dry run shows who is eligible and why the rest is not, so an operator can
// read the follow up plan before any supplier hears from us again.
export async function GET(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return badRequest(invalid);
  try {
    const order = await loadBulkRfqOrder(orderId);
    if (!order) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    // An absent limit means the whole run, so the plan an operator approves
    // covers as many suppliers as a send would.
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = boundedLimit(limitParam === null ? undefined : Number(limitParam));
    const { targets, skipped, blocked } = await listSupplierNudgeTargets({ order, limit });
    return NextResponse.json({
      orderId: order.orderId,
      material: order.material,
      eligible: targets.length,
      targets: targets.map((target) => ({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        recipient: target.recipient,
        round: target.round,
      })),
      blocked,
      skipped,
    });
  } catch (error) {
    console.error("procurement supplier nudge plan failed", error);
    return NextResponse.json({ error: "The supplier follow up plan failed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as {
    orderId?: unknown;
    limit?: unknown;
    confirm?: unknown;
    action?: unknown;
  };
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return badRequest(invalid);
  // Settling unknown deliveries mails nobody, so it needs no confirmation and is
  // available on its own for a supplier whose last follow up is unresolved.
  if (payload.action === "reconcile") {
    try {
      const reconciled = await reconcileProcurementSupplierNudges({
        orderId,
        limit: boundedLimit(payload.limit),
      });
      if (!reconciled) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
      return NextResponse.json(reconciled);
    } catch (error) {
      console.error("procurement supplier nudge reconcile failed", error);
      return NextResponse.json({ error: "The supplier follow up reconcile failed." }, { status: 500 });
    }
  }
  // Mailing suppliers again is irreversible, so the confirmation phrase has to
  // be present in the body rather than implied by calling the route.
  if (payload.confirm !== NUDGE_CONFIRMATION) {
    return badRequest("This send needs an explicit confirmation.");
  }
  try {
    const result = await runProcurementSupplierNudges({
      orderId,
      limit: boundedLimit(payload.limit),
    });
    if (!result) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("procurement supplier nudge run failed", error);
    return NextResponse.json({ error: "The supplier follow up run failed." }, { status: 500 });
  }
}
