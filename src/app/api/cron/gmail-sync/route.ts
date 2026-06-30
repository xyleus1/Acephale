import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncEmailAccountInternal } from "@/lib/gmail-sync";

export const maxDuration = 300; // 5 minutes — full sync of all active accounts

export async function GET(req: NextRequest) {
  // Vercel cron requests include `Authorization: Bearer $CRON_SECRET` automatically.
  // Also accept ?secret= and x-cron-secret for manual runs.
  const headerAuth = req.headers.get("authorization");
  const secret = req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.emailAccount.findMany({
    where: { isActive: true, provider: "GMAIL" },
    select: { id: true, officeId: true, email: true },
  });

  const results: Array<{ email: string; ok: boolean; created?: number; autoInquiries?: number; autoLinked?: number; error?: string }> = [];
  for (const acct of accounts) {
    try {
      const r = await syncEmailAccountInternal(acct.id, acct.officeId);
      if ("error" in r) {
        results.push({ email: acct.email, ok: false, error: r.error });
      } else {
        results.push({
          email: acct.email,
          ok: true,
          created: r.created,
          autoInquiries: r.autoInquiries,
          autoLinked: r.autoLinked,
        });
      }
    } catch (e) {
      results.push({ email: acct.email, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ran: new Date().toISOString(),
    accounts: results.length,
    results,
  });
}
