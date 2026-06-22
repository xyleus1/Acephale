import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runScheduledMarketIngestion } from "@/lib/market-intelligence/scheduled-ingestion";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron secret is not configured" }, { status: 503 });
  }
  const headerAuth = req.headers.get("authorization");
  const secret = req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = ["1", "true", "yes"].includes((req.nextUrl.searchParams.get("dryRun") ?? "").toLowerCase());
  const force = ["1", "true", "yes"].includes((req.nextUrl.searchParams.get("force") ?? "").toLowerCase());
  const source = req.nextUrl.searchParams.get("source");
  const maxSources = Number(req.nextUrl.searchParams.get("maxSources") ?? "");
  const offices = await prisma.office.findMany({ select: { id: true, name: true } });
  const results = [];
  for (const office of offices) {
    results.push({
      office,
      result: await runScheduledMarketIngestion({
        officeId: office.id,
        dryRun,
        force,
        sourceIds: source ? [source] : undefined,
        allowDisabled: Boolean(source),
        maxSources: Number.isFinite(maxSources) ? maxSources : undefined,
      }),
    });
  }
  return NextResponse.json({ ran: new Date().toISOString(), dryRun, offices: results });
}
