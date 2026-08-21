import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readCompanyContextDocument } from "@/lib/company-context";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

const DOWNLOAD_CHUNK_BYTES = 64 * 1024;

function streamDocument(bytes: Buffer) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + DOWNLOAD_CHUNK_BYTES, bytes.length);
      controller.enqueue(new Uint8Array(bytes.subarray(offset, end)));
      offset = end;
    },
  });
}

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
    return new NextResponse(streamDocument(document.bytes), {
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
