import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listWorkspacesAcrossOffices } from "@/lib/office-workspaces";
import { supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.accessKind === "customer" || session.role === "CUSTOMER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const offices = await listWorkspacesAcrossOffices(session);
    return NextResponse.json(
      { offices },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
