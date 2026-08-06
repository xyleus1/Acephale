import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { streamJobDocument } from "@/lib/job-document-response";

// Streams a JobDocument's bytes back to the browser so the operator can
// view the PDF inline (browser native viewer in an <iframe>) without
// downloading. Resolves Gmail attachment URLs server-side and proxies the
// bytes; passes through data: URLs; HEAD-fetches public URLs.
//
// All requests require an active session and ownership of the office.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try { session = await requireSession(); } catch { return new NextResponse("Unauthorized", { status: 401 }); }
  const { id } = await params;
  const doc = await prisma.jobDocument.findFirst({
    where: { id, officeId: session.officeId },
    select: { name: true, url: true },
  });
  if (!doc?.url) return new NextResponse("Document not found", { status: 404 });
  return streamJobDocument(doc, session.officeId);
}
