import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestWhatsAppWebhook } from "@/lib/whatsapp";
import { greenApiToMetaPayload, type GreenApiNotification } from "@/lib/whatsapp-greenapi";

export const runtime = "nodejs";
export const maxDuration = 60;

// Green API delivers the instance's webhookUrlToken in the Authorization
// header. Fail closed in production when no token is configured (F3), same
// stance as the Meta webhook's signature check. Accepts both the bare token
// and a "Bearer " prefix since the header format is not pinned by their docs.
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.GREEN_API_WEBHOOK_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notification = (await req.json().catch(() => null)) as GreenApiNotification | null;
  if (!notification) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ownDigits = process.env.WHATSAPP_PHONE_NUMBER_ID?.replace(/\D/g, "") || null;
  const payload = greenApiToMetaPayload(notification, ownDigits);
  // Status updates, state changes, group chats, unusable payloads: ack with
  // 200 so Green API doesn't retry them forever.
  if (!payload) {
    return NextResponse.json({ ok: true, ignored: notification.typeWebhook ?? "unknown" });
  }

  const result = await ingestWhatsAppWebhook(payload);
  if ("error" in result) {
    // Non-2xx keeps the notification in Green API's queue for a retry.
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
