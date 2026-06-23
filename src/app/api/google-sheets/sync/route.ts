import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncDeryaGoogleSheetForOffice } from "@/lib/google-sheets-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await syncDeryaGoogleSheetForOffice(session.officeId);
  return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
}

export async function GET(req: NextRequest) {
  const headerAuth = req.headers.get("authorization");
  const secret = req.headers.get("x-cron-secret")
    ?? req.nextUrl.searchParams.get("secret")
    ?? (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : null);
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const officeId = process.env.DERYA_GOOGLE_SHEET_OFFICE_ID
    ?? process.env.WHATSAPP_OFFICE_ID
    ?? (await prisma.office.findFirst({ select: { id: true } }))?.id;
  if (!officeId) return NextResponse.json({ error: "No office found for sync." }, { status: 400 });

  const result = await syncDeryaGoogleSheetForOffice(officeId);
  return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
}
