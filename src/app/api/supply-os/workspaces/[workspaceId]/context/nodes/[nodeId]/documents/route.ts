import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { uploadSupplyContextDocument } from "@/lib/supply-os/context-persistence";
import { CONTEXT_DOCUMENT_MAX_BYTES } from "@/lib/supply-os/context-documents";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string; nodeId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > CONTEXT_DOCUMENT_MAX_BYTES + 64_000) {
    return NextResponse.json({ error: "Documents are limited to 10 MB." }, { status: 413 });
  }
  const { workspaceId, nodeId } = await route.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Document is required." }, { status: 400 });
  try {
    const document = await uploadSupplyContextDocument({
      context: supplyAccessContext(session),
      workspaceId,
      nodeId,
      file,
      visibility: form?.get("visibility"),
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
