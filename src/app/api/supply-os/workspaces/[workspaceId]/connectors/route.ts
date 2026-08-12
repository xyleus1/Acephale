import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createConnectorInstallation, listConnectorInstallations } from "@/lib/supply-os/connectors";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const connectors = await listConnectorInstallations(supplyAccessContext(session), workspaceId);
    return NextResponse.json({ connectors }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Connector configuration is required." }, { status: 400 });
  const { workspaceId } = await context.params;
  try {
    const connector = await createConnectorInstallation(supplyAccessContext(session), workspaceId, {
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      secretRef: typeof body.secretRef === "string" ? body.secretRef : "",
      adapterKey: typeof body.adapterKey === "string" ? body.adapterKey : undefined,
      scheduleMinutes: typeof body.scheduleMinutes === "number" ? body.scheduleMinutes : undefined,
      config: body.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config as Record<string, unknown> : undefined,
    });
    return NextResponse.json({ connector }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
