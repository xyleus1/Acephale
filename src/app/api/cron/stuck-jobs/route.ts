import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findStuckJobs } from "@/lib/stuck-jobs";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const headerAuth = req.headers.get("authorization");
  const secret = req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const offices = await prisma.office.findMany({ select: { id: true, name: true } });
  const out: Record<string, number> = {};
  for (const office of offices) {
    try {
      const stuck = await findStuckJobs(office.id, { daysThreshold: 5, max: 20 });
      out[office.name] = stuck.length;
    } catch (e) {
      out[office.name] = -1;
    }
  }
  return NextResponse.json({ ran: new Date().toISOString(), offices: out });
}
