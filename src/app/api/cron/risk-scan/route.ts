import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshRiskAlerts } from "@/lib/risk";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const offices = await prisma.office.findMany({ select: { id: true, name: true } });
  const results: Record<string, string> = {};

  for (const office of offices) {
    try {
      await refreshRiskAlerts(office.id);
      results[office.name] = "ok";
    } catch (e) {
      results[office.name] = String(e);
    }
  }

  return NextResponse.json({ ran: new Date().toISOString(), offices: results });
}
