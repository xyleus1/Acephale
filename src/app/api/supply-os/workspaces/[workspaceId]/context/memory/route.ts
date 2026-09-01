import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteCompanyContextMemory, saveCompanyContextMemory } from "@/lib/company-context";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const saved = await saveCompanyContextMemory({
      context: supplyAccessContext(session),
      workspaceId,
      notes: typeof body?.note === "string" ? [body.note] : body?.notes,
    });
    return NextResponse.json({ memory: saved }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, route: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await route.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    await deleteCompanyContextMemory({
      context: supplyAccessContext(session),
      workspaceId,
      memoryId: body?.memoryId,
    });
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
