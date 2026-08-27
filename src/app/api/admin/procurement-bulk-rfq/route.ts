import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  BULK_RFQ_MAX_PER_RUN,
  buildBulkRfqBody,
  buildBulkRfqSubject,
  listBulkRfqTargets,
  loadBulkRfqOrder,
  reconcileProcurementBulkRfq,
  runProcurementBulkRfq,
} from "@/lib/procurement-bulk-rfq";
import {
  EMPTY_RFQ_ATTACHMENT_PACKAGE,
  loadProcurementRfqAttachmentPackage,
} from "@/lib/procurement-rfq-attachments";

export const maxDuration = 300;

function operatorSecret(req: NextRequest) {
  const headerAuth = req.headers.get("authorization");
  return req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function sameSecret(expected: string, supplied: string) {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}

function authorized(req: NextRequest) {
  const supplied = operatorSecret(req);
  if (!supplied) return false;
  const expected = [process.env.PROCUREMENT_BULK_RFQ_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length >= 16));
  return expected.some((value) => sameSecret(value, supplied));
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  const withDrafts = req.nextUrl.searchParams.get("drafts") === "1";
  try {
    const order = await loadBulkRfqOrder(orderId);
    if (!order) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    const targets = await listBulkRfqTargets(order, BULK_RFQ_MAX_PER_RUN);
    // The preview resolves the same package the send would, so the operator sees
    // the exact files each RFQ carries before any of them go out.
    const files = await loadProcurementRfqAttachmentPackage({
      orderId: order.orderId,
      customerId: order.customerId,
      officeId: order.officeId,
    }).catch(() => EMPTY_RFQ_ATTACHMENT_PACKAGE);
    return NextResponse.json({
      order: {
        orderId: order.orderId,
        officeId: order.officeId,
        companyName: order.companyName,
        material: order.material,
        quantity: order.quantity,
        unit: order.unit,
      },
      pending: targets.length,
      attachments: files.names,
      withheldFiles: files.withheld,
      recipients: targets.map((target) => target.contactEmail),
      drafts: withDrafts
        ? targets.map((target) => ({
          vendorId: target.vendorId,
          vendorName: target.name,
          website: target.website,
          recipient: target.contactEmail,
          subject: buildBulkRfqSubject(order),
          body: buildBulkRfqBody(order, target, files),
          attachments: files.names,
        }))
        : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The bulk RFQ preview failed." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as {
    orderId?: unknown;
    limit?: unknown;
    mode?: unknown;
    pauseMs?: unknown;
  };
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  if (!orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  const mode = payload.mode === "reconcile" ? "reconcile" : "send";
  try {
    if (mode === "reconcile") {
      const reconcileLimit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? Math.max(1, Math.trunc(payload.limit))
        : undefined;
      return NextResponse.json(await reconcileProcurementBulkRfq({ orderId, limit: reconcileLimit }));
    }
    const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
      ? Math.min(BULK_RFQ_MAX_PER_RUN, Math.max(1, Math.trunc(payload.limit)))
      : 25;
    const pauseMs = typeof payload.pauseMs === "number" && Number.isFinite(payload.pauseMs)
      ? Math.min(5_000, Math.max(0, Math.trunc(payload.pauseMs)))
      : undefined;
    return NextResponse.json(await runProcurementBulkRfq({ orderId, limit, pauseMs }));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The bulk RFQ run failed." },
      { status: 500 },
    );
  }
}
