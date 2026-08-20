import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readStoredDocument } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { requireSupplyWorkspace } from "@/lib/supply-os/persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { supplyContextEnabled } from "@/lib/supply-os/context-feature";

export async function GET(_request: Request, route: { params: Promise<{ documentId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supplyContextEnabled(session.officeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { documentId } = await route.params;
  try {
    const document = await prisma.supplyContextDocument.findFirst({ where: { id: documentId, officeId: session.officeId } });
    if (!document) return new NextResponse("Document not found", { status: 404 });
    await requireSupplyWorkspace(supplyAccessContext(session), document.workspaceId, "view");
    const stored = await readStoredDocument(document.storageUrl);
    if (!stored) return new NextResponse("Document unavailable", { status: 404 });
    return new NextResponse(new Uint8Array(stored.bytes), {
      headers: {
        "content-type": document.mimeType,
        "content-disposition": `attachment; filename="${document.name.replace(/["\\]/g, "")}"`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
