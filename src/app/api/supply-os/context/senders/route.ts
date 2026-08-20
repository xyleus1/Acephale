import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supplyContextEnabled } from "@/lib/supply-os/context-feature";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supplyContextEnabled(session.officeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const accounts = await prisma.emailAccount.findMany({
    where: {
      officeId: session.officeId,
      provider: "GMAIL",
      isActive: true,
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    orderBy: { email: "asc" },
    select: { id: true, email: true, provider: true },
  });
  return NextResponse.json({ accounts }, { headers: { "cache-control": "no-store" } });
}
