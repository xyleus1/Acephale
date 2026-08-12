import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { syncConnectorInstallation } from "@/lib/supply-os/connectors";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ connectorId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { connectorId } = await context.params;
  try {
    const result = await syncConnectorInstallation(supplyAccessContext(session), connectorId);
    return NextResponse.json({ result });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
