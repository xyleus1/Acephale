import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateResearchStatus } from "@/lib/research-lists";

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string; recordId: string }> },
) {
  const session = await requireSession();
  if (session.accessKind === "customer") {
    return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  try {
    const status = validateResearchStatus(body && typeof body === "object" ? body.status : null);
    const { slug, recordId } = await context.params;
    const list = await prisma.researchList.findUnique({
      where: { officeId_slug: { officeId: session.officeId, slug: slug.slice(0, 80) } },
      select: { id: true },
    });
    if (!list) {
      return NextResponse.json({ error: "Research list not found." }, { status: 404 });
    }
    const result = await prisma.researchRecord.updateMany({
      where: { id: recordId, officeId: session.officeId, listId: list.id },
      data: { status },
    });
    if (result.count !== 1) {
      return NextResponse.json({ error: "Research record not found." }, { status: 404 });
    }
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status could not be updated." },
      { status: 400 },
    );
  }
}
