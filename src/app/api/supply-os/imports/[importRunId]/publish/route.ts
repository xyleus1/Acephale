import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { publishSupplyImport } from "@/lib/supply-os/persistence";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ importRunId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { importRunId } = await context.params;
  try {
    const importRun = await publishSupplyImport(supplyAccessContext(session), importRunId);
    return NextResponse.json({ importRun });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
