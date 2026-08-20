import { NextRequest, NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import type { CustomerPortalPrincipal } from "@/lib/customer-portal-data";
import { uploadCustomerSupplyContextDocument } from "@/lib/supply-os/context-persistence";
import { CONTEXT_DOCUMENT_MAX_BYTES } from "@/lib/supply-os/context-documents";
import { supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > CONTEXT_DOCUMENT_MAX_BYTES + 64_000) {
    return NextResponse.json({ error: "Documents are limited to 10 MB." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Document is required." }, { status: 400 });
  try {
    const document = await uploadCustomerSupplyContextDocument({
      principal: principal as CustomerPortalPrincipal,
      companyId: String(form?.get("companyId") ?? ""),
      nodeId: String(form?.get("nodeId") ?? ""),
      file,
    });
    return NextResponse.json({
      document: {
        id: document.id,
        nodeId: document.nodeId,
        name: document.name,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        contentHash: document.contentHash,
        processingState: document.processingState,
        extractionError: document.extractionError,
        createdAt: document.createdAt,
      },
    }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
