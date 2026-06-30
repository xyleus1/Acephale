import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/gmail-oauth";
import { isManagedDocumentUrl, readStoredJobDocument } from "@/lib/document-storage";

// Streams a JobDocument's bytes back to the browser so the operator can
// view the PDF inline (browser native viewer in an <iframe>) without
// downloading. Resolves Gmail attachment URLs server-side and proxies the
// bytes; passes through data: URLs; HEAD-fetches public URLs.
//
// All requests require an active session and ownership of the office.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return new NextResponse("Unauthorized", { status: 401 }); }
  const { id } = await params;
  const doc = await prisma.jobDocument.findFirst({
    where: { id, officeId: session.officeId },
    select: { name: true, url: true },
  });
  if (!doc?.url) return new NextResponse("Document not found", { status: 404 });

  if (isManagedDocumentUrl(doc.url)) {
    try {
      const stored = await readStoredJobDocument(doc.url);
      if (!stored) return new NextResponse("Managed document missing", { status: 404 });
      return new NextResponse(new Uint8Array(stored.bytes), {
        status: 200,
        headers: {
          "Content-Type": stored.contentType,
          "Content-Disposition": `inline; filename="${doc.name.replace(/["\\]/g, "")}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch {
      return new NextResponse("Managed document unavailable", { status: 404 });
    }
  }

  // Gmail attachment URLs (we control them — re-fetch via stored OAuth token)
  if (doc.url.startsWith("/api/gmail/attachment")) {
    const u = new URL(doc.url, "http://localhost");
    const messageDbId = u.searchParams.get("messageDbId");
    const attachmentId = u.searchParams.get("attachmentId");
    if (!messageDbId || !attachmentId) return new NextResponse("Bad attachment URL", { status: 400 });
    const msg = await prisma.emailMessage.findFirst({
      where: { id: messageDbId, account: { officeId: session.officeId } },
      select: { gmailMessageId: true, attachments: true, account: { select: { id: true, provider: true } } },
    });
    if (!msg?.account || msg.account.provider !== "GMAIL" || !msg.gmailMessageId) {
      return new NextResponse("Attachment unavailable", { status: 404 });
    }
    let mimeType = "application/pdf";
    try {
      const list = JSON.parse(msg.attachments ?? "[]") as { attachmentId: string; mimeType: string }[];
      const found = list.find((a) => a.attachmentId === attachmentId);
      if (found?.mimeType) mimeType = found.mimeType;
    } catch {}
    const token = await getValidAccessToken(msg.account.id);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.gmailMessageId}/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return new NextResponse(`Gmail fetch failed (${res.status})`, { status: 502 });
    const j: { data?: string } = await res.json();
    if (!j.data) return new NextResponse("Empty", { status: 502 });
    const buf = Buffer.from(j.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${doc.name.replace(/["\\]/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // data: URL — strip header, return bytes inline
  if (doc.url.startsWith("data:")) {
    const m = doc.url.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return new NextResponse("Malformed data URL", { status: 400 });
    const buf = Buffer.from(m[2], "base64");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": m[1],
        "Content-Disposition": `inline; filename="${doc.name.replace(/["\\]/g, "")}"`,
      },
    });
  }

  // Public URL — proxy through to handle CORS for the iframe.
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(doc.url);
  } catch {
    return new NextResponse("Malformed document URL", { status: 400 });
  }
  if (upstreamUrl.protocol !== "https:" && upstreamUrl.protocol !== "http:") {
    return new NextResponse("Unsupported document URL", { status: 400 });
  }
  const res = await fetch(upstreamUrl);
  if (!res.ok) return new NextResponse(`Upstream fetch failed (${res.status})`, { status: 502 });
  const buf = Buffer.from(await res.arrayBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/pdf",
      "Content-Disposition": `inline; filename="${doc.name.replace(/["\\]/g, "")}"`,
    },
  });
}
