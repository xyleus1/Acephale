import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readCompanyContextDocument } from "@/lib/company-context";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  route: { params: Promise<{ workspaceId: string; documentId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, documentId } = await route.params;
  try {
    const document = await readCompanyContextDocument({
      context: supplyAccessContext(session),
      workspaceId,
      documentId,
    });
    return new NextResponse(new Uint8Array(document.bytes), {
      headers: {
        "content-type": document.mimeType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
