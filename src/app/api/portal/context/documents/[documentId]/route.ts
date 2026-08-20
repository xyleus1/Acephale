import { NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { readStoredDocument } from "@/lib/document-storage";
import { prisma } from "@/lib/prisma";
import { supplyContextEnabled } from "@/lib/supply-os/context-feature";

export async function GET(_request: Request, route: { params: Promise<{ documentId: string }> }) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supplyContextEnabled(principal.officeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { documentId } = await route.params;
  const companyIds = principal.memberships.map((membership) => membership.companyId);
  const document = await prisma.supplyContextDocument.findFirst({
    where: {
      id: documentId,
      officeId: principal.officeId,
      visibility: "SHARED",
      workspace: { officeId: principal.officeId, companyId: { in: companyIds }, status: "ACTIVE" },
      node: { visibility: "SHARED", archivedAt: null },
    },
  });
  if (!document) return new NextResponse("Document not found", { status: 404 });
  const stored = await readStoredDocument(document.storageUrl).catch(() => null);
  if (!stored) return new NextResponse("Document unavailable", { status: 404 });
  return new NextResponse(new Uint8Array(stored.bytes), {
    headers: {
      "content-type": document.mimeType,
      "content-disposition": `attachment; filename="${document.name.replace(/["\\]/g, "")}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
