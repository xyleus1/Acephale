import { NextRequest, NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { resolveCustomerContextAccessForWorkspace } from "@/lib/customer-context-access";
import {
  CompanyContextLimitError,
  reserveCustomerContextUploadRequest,
  uploadCompanyContextDocument,
  uploadCompanyContextDocumentChunk,
} from "@/lib/company-context";
import { CONTEXT_DOCUMENT_MAX_BYTES } from "@/lib/supply-os/context-documents";
import { supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > CONTEXT_DOCUMENT_MAX_BYTES + 64_000) {
    return NextResponse.json({ error: "Documents are limited to 10 MB." }, { status: 413 });
  }
  const { workspaceId } = await route.params;
  const access = await resolveCustomerContextAccessForWorkspace(principal, workspaceId);
  if (!access) return NextResponse.json({ error: "Context not found." }, { status: 404 });
  try {
    await reserveCustomerContextUploadRequest({ context: access, workspaceId });
  } catch (error) {
    if (error instanceof CompanyContextLimitError) {
      const status = error.code === "upload_rate" ? 429 : error.code === "document_storage" ? 413 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    return supplyErrorResponse(error);
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Document is required." }, { status: 400 });
  try {
    const uploadId = form?.get("uploadId");
    if (uploadId !== null && uploadId !== undefined) {
      const result = await uploadCompanyContextDocumentChunk({
        context: access,
        workspaceId,
        uploadId,
        chunkIndex: form?.get("chunkIndex"),
        chunkCount: form?.get("chunkCount"),
        fileName: form?.get("fileName"),
        fileType: form?.get("fileType"),
        fileSize: form?.get("fileSize"),
        chunk: file,
      });
      return NextResponse.json(result, { status: result.complete ? 201 : 202 });
    }
    const document = await uploadCompanyContextDocument({ context: access, workspaceId, file });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (error instanceof CompanyContextLimitError) {
      const status = error.code === "upload_rate" ? 429 : error.code === "document_storage" ? 413 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    return supplyErrorResponse(error);
  }
}
