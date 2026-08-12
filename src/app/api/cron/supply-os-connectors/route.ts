import { NextRequest, NextResponse } from "next/server";
import { runDueConnectorSyncs } from "@/lib/supply-os/connectors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Cron secret is not configured." }, { status: 503 });
  const header = request.headers.get("authorization");
  const secret = request.headers.get("x-cron-secret")
    ?? (header?.startsWith("Bearer ") ? header.slice(7) : null);
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Math.min(25, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 10)));
  const result = await runDueConnectorSyncs({ limit });
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result });
}
