import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/gmail-oauth";

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const messageDbId = req.nextUrl.searchParams.get("messageDbId");
  const attachmentId = req.nextUrl.searchParams.get("attachmentId");
  const filename = req.nextUrl.searchParams.get("filename") ?? "attachment";
  if (!messageDbId || !attachmentId) {
    return new NextResponse("Missing messageDbId or attachmentId", { status: 400 });
  }

  // Look up the message and verify it belongs to the caller's office.
  const msg = await prisma.emailMessage.findFirst({
    where: { id: messageDbId, account: { officeId: session.officeId } },
    select: {
      gmailMessageId: true,
      attachments: true,
      account: { select: { id: true, provider: true } },
    },
  });
  if (!msg || !msg.account) return new NextResponse("Not found", { status: 404 });
  if (msg.account.provider !== "GMAIL" || !msg.gmailMessageId) {
    return new NextResponse("Unsupported provider", { status: 400 });
  }

  // Find attachment metadata for mimeType.
  let mimeType = "application/octet-stream";
  try {
    const list: { attachmentId: string; mimeType: string }[] = JSON.parse(msg.attachments ?? "[]");
    const m = list.find((a) => a.attachmentId === attachmentId);
    if (m) mimeType = m.mimeType;
  } catch {}

  let token: string;
  try {
    token = await getValidAccessToken(msg.account.id);
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "token error", { status: 500 });
  }

  const apiUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.gmailMessageId}/attachments/${attachmentId}`;
  const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    return new NextResponse(`Gmail attachment fetch failed: ${res.status} ${body.slice(0, 200)}`, { status: 502 });
  }
  const json: { data?: string; size?: number } = await res.json();
  if (!json.data) return new NextResponse("Empty attachment", { status: 502 });

  const buf = Buffer.from(json.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const safeName = filename.replace(/["\\]/g, "");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
