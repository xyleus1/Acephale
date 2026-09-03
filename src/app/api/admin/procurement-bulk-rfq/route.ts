import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  recipientQualityLines,
  spotCheckLabel,
  spotCheckSample,
  summarizeRecipientQuality,
} from "@/lib/batch-review";
import {
  BULK_RFQ_MAX_PER_RUN,
  BulkRfqBatchChangedError,
  buildBulkRfqBody,
  buildBulkRfqSubject,
  listBulkRfqTargets,
  loadBulkRfqOrder,
  reconcileProcurementBulkRfq,
  runProcurementBulkRfq,
} from "@/lib/procurement-bulk-rfq";
import { loadProcurementRfqAttachmentPackage } from "@/lib/procurement-rfq-attachments";

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

function boundedLimit(value: unknown, fallback: number) {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric)
    ? Math.min(BULK_RFQ_MAX_PER_RUN, Math.max(1, Math.trunc(numeric)))
    : fallback;
}

function vendorIdList(value: unknown): string[] {
  const items = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  return [...new Set(
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[a-z0-9-]{1,64}$/.test(item)),
  )];
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
  // A preview with a limit and exclusions is a reviewable batch: its hash pins
  // the exact suppliers, and a POST that carries the hash sends nothing else.
  const limit = boundedLimit(req.nextUrl.searchParams.get("limit"), BULK_RFQ_MAX_PER_RUN);
  const excludeVendorIds = vendorIdList(req.nextUrl.searchParams.get("excludeVendorIds"));
  try {
    const order = await loadBulkRfqOrder(orderId);
    if (!order) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    // The preview resolves the same package the send would, so the operator sees
    // the exact files each RFQ carries before any of them go out. A loader
    // failure is a failed preview, not a preview of an RFQ without files.
    const files = await loadProcurementRfqAttachmentPackage({
      orderId: order.orderId,
      customerId: order.customerId,
      officeId: order.officeId,
    }).catch(() => null);
    if (!files) return NextResponse.json({ error: "The request files could not be resolved. Try the preview again." }, { status: 503 });
    // Same suppression and limit policy as the send, so a later POST with any
    // limit up to the maximum only reaches suppliers listed here, and the hash
    // covers the files and copy shown below.
    const { sendable: targets, blocked, batchHash } = await listBulkRfqTargets(order, limit, null, { excludeVendorIds, files });
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
      batch: bulkRfqBatchReview({ order, targets, files, limit, excludeVendorIds, batchHash }),
      blocked: blocked.map((outcome) => ({
        vendorId: outcome.vendorId,
        vendorName: outcome.vendorName,
        recipient: outcome.recipient,
        reason: outcome.error,
      })),
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

function bulkRfqBatchReview(input: {
  order: NonNullable<Awaited<ReturnType<typeof loadBulkRfqOrder>>>;
  targets: Awaited<ReturnType<typeof listBulkRfqTargets>>["sendable"];
  files: Awaited<ReturnType<typeof loadProcurementRfqAttachmentPackage>>;
  limit: number;
  excludeVendorIds: string[];
  batchHash: string;
}) {
  const quality = summarizeRecipientQuality(input.targets.map((target) => ({ email: target.contactEmail })));
  const subject = buildBulkRfqSubject(input.order);
  return {
    hash: input.batchHash,
    limit: input.limit,
    sendable: input.targets.length,
    excludeVendorIds: input.excludeVendorIds,
    quality,
    summary: recipientQualityLines(quality),
    spotCheck: spotCheckSample(input.targets, { seed: input.batchHash }).map((pick) => ({
      label: spotCheckLabel(pick, input.targets.length),
      vendorId: pick.item.vendorId,
      vendorName: pick.item.name,
      website: pick.item.website,
      recipient: pick.item.contactEmail,
      subject,
      body: buildBulkRfqBody(input.order, pick.item, input.files),
    })),
    send: {
      method: "POST",
      body: { orderId: input.order.orderId, limit: input.limit, excludeVendorIds: input.excludeVendorIds, expectedBatchHash: input.batchHash },
    },
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as {
    orderId?: unknown;
    limit?: unknown;
    mode?: unknown;
    pauseMs?: unknown;
    excludeVendorIds?: unknown;
    expectedBatchHash?: unknown;
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
    const limit = boundedLimit(payload.limit, 25);
    const pauseMs = typeof payload.pauseMs === "number" && Number.isFinite(payload.pauseMs)
      ? Math.min(5_000, Math.max(0, Math.trunc(payload.pauseMs)))
      : undefined;
    const expectedBatchHash = typeof payload.expectedBatchHash === "string" && /^[a-f0-9]{64}$/.test(payload.expectedBatchHash)
      ? payload.expectedBatchHash
      : null;
    if (payload.expectedBatchHash !== undefined && !expectedBatchHash) {
      return NextResponse.json({ error: "expectedBatchHash must be the hash from a preview." }, { status: 400 });
    }
    return NextResponse.json(await runProcurementBulkRfq({
      orderId,
      limit,
      pauseMs,
      excludeVendorIds: vendorIdList(payload.excludeVendorIds),
      expectedBatchHash,
    }));
  } catch (error) {
    if (error instanceof BulkRfqBatchChangedError) {
      return NextResponse.json(
        { error: error.message, code: error.code, expectedBatchHash: error.expectedHash, currentBatchHash: error.currentHash },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The bulk RFQ run failed." },
      { status: 500 },
    );
  }
}
