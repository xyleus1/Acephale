import "server-only";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/gmail-oauth";
import { isManagedDocumentUrl, readStoredJobDocument } from "@/lib/document-storage";

type StreamableJobDocument = {
  name: string;
  url: string | null;
};

function inlineHeaders(name: string, contentType: string) {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="${name.replace(/["\\]/g, "")}"`,
    "Cache-Control": "private, max-age=300",
  };
}

export async function streamJobDocument(
  doc: StreamableJobDocument,
  officeId: string,
): Promise<NextResponse> {
  if (!doc.url) return new NextResponse("Document not found", { status: 404 });

  if (isManagedDocumentUrl(doc.url)) {
    try {
      const stored = await readStoredJobDocument(doc.url);
      if (!stored) return new NextResponse("Managed document missing", { status: 404 });
      return new NextResponse(new Uint8Array(stored.bytes), {
        status: 200,
        headers: inlineHeaders(doc.name, stored.contentType),
      });
    } catch {
      return new NextResponse("Managed document unavailable", { status: 404 });
    }
  }

  if (doc.url.startsWith("/api/gmail/attachment")) {
    const url = new URL(doc.url, "http://localhost");
    const messageDbId = url.searchParams.get("messageDbId");
    const attachmentId = url.searchParams.get("attachmentId");
    if (!messageDbId || !attachmentId) {
      return new NextResponse("Bad attachment URL", { status: 400 });
    }
    const message = await prisma.emailMessage.findFirst({
      where: { id: messageDbId, account: { officeId } },
      select: {
        gmailMessageId: true,
        attachments: true,
        account: { select: { id: true, provider: true } },
      },
    });
    if (!message?.account || message.account.provider !== "GMAIL" || !message.gmailMessageId) {
      return new NextResponse("Attachment unavailable", { status: 404 });
    }
    let contentType = "application/pdf";
    try {
      const attachments = JSON.parse(message.attachments ?? "[]") as Array<{
        attachmentId: string;
        mimeType: string;
      }>;
      contentType = attachments.find((item) => item.attachmentId === attachmentId)?.mimeType
        ?? contentType;
    } catch {}

    const accessToken = await getValidAccessToken(message.account.id);
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.gmailMessageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      return new NextResponse(`Gmail fetch failed (${response.status})`, { status: 502 });
    }
    const payload = await response.json() as { data?: string };
    if (!payload.data) return new NextResponse("Empty", { status: 502 });
    const bytes = Buffer.from(payload.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: inlineHeaders(doc.name, contentType),
    });
  }

  if (doc.url.startsWith("data:")) {
    const match = doc.url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return new NextResponse("Malformed data URL", { status: 400 });
    return new NextResponse(new Uint8Array(Buffer.from(match[2], "base64")), {
      status: 200,
      headers: inlineHeaders(doc.name, match[1]),
    });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(doc.url);
  } catch {
    return new NextResponse("Malformed document URL", { status: 400 });
  }
  if (!["https:", "http:"].includes(upstreamUrl.protocol)) {
    return new NextResponse("Unsupported document URL", { status: 400 });
  }
  const response = await fetch(upstreamUrl);
  if (!response.ok) {
    return new NextResponse(`Upstream fetch failed (${response.status})`, { status: 502 });
  }
  return new NextResponse(new Uint8Array(await response.arrayBuffer()), {
    status: 200,
    headers: inlineHeaders(
      doc.name,
      response.headers.get("content-type") ?? "application/pdf",
    ),
  });
}
