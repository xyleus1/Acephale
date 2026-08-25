import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

function operatorSecret(req: NextRequest) {
  const headerAuth = req.headers.get("authorization");
  return req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
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

function replyKind(subject: string, body: string) {
  const text = `${subject}\n${body}`.toLowerCase();
  if (/mail delivery|delivery status notification|undeliverable|address not found|failure notice/.test(text)) {
    return "BOUNCE";
  }
  if (/out of (the )?office|automatic reply|autoreply|on vacation|annual leave/.test(text)) {
    return "AUTO_REPLY";
  }
  if (/wrong (email|address|person)|not the right|no longer with/.test(text)) return "WRONG_RECIPIENT";
  return "REPLY";
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  if (!orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  try {
    const order = await loadBulkRfqOrder(orderId);
    if (!order) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    const reference = order.orderId.slice(0, 8);
    const threads = await prisma.emailThread.findMany({
      where: { officeId: order.officeId, subject: { contains: `[RFQ ${reference}]` } },
      select: {
        id: true,
        messages: {
          orderBy: { sentAt: "asc" },
          select: {
            direction: true,
            subject: true,
            bodyText: true,
            fromEmail: true,
            sentAt: true,
            account: { select: { email: true } },
          },
        },
      },
    });
    const inbound = threads.flatMap((thread) => thread.messages
      .filter((message) => message.direction === "INBOUND")
      .map((message) => ({
        from: message.fromEmail,
        mailbox: message.account?.email ?? null,
        subject: message.subject ?? "",
        kind: replyKind(message.subject ?? "", message.bodyText ?? ""),
        receivedAt: message.sentAt,
        preview: (message.bodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
      })));
    const counts = inbound.reduce<Record<string, number>>((totals, entry) => {
      totals[entry.kind] = (totals[entry.kind] ?? 0) + 1;
      return totals;
    }, {});
    return NextResponse.json({
      orderId: order.orderId,
      material: order.material,
      outbound: threads.reduce(
        (total, thread) => total + thread.messages.filter((message) => message.direction === "OUTBOUND").length,
        0,
      ),
      inbound: inbound.length,
      counts,
      messages: inbound,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The reply summary failed." },
      { status: 500 },
    );
  }
}
