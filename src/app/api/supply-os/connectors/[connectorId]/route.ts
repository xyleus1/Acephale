import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setConnectorEnabled } from "@/lib/supply-os/connectors";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ connectorId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "Enabled must be true or false." }, { status: 400 });
  const { connectorId } = await context.params;
  try {
    const connector = await setConnectorEnabled(supplyAccessContext(session), connectorId, body.enabled);
    return NextResponse.json({ connector });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
