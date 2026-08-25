import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { loadResearchList, upsertResearchRecords } from "@/lib/research-lists";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const session = await requireSession();
  if (session.accessKind === "customer") {
    return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  }
  try {
    const { slug } = await context.params;
    const params = new URL(request.url).searchParams;
    const list = await loadResearchList(session.officeId, slug.slice(0, 80), {
      query: params.get("q")?.slice(0, 120) || undefined,
      status: params.get("status")?.slice(0, 40) || undefined,
      page: Number.parseInt(params.get("page") || "1", 10) || 1,
    });
    return NextResponse.json(list, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Records could not be loaded." },
      { status: 404 },
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const session = await requireSession();
  if (session.accessKind === "customer") return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !Array.isArray(body.rows)) return NextResponse.json({ error: "Rows are required." }, { status: 400 });
  if (body.rows.length > 2000) return NextResponse.json({ error: "At most 2000 rows can be imported at once." }, { status: 400 });
  try {
    const { slug } = await context.params;
    const result = await upsertResearchRecords(session.officeId, slug.slice(0, 80), body.rows, {
      dedupeField: typeof body.dedupeField === "string" ? body.dedupeField.slice(0, 80) : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rows could not be imported." }, { status: 400 });
  }
}
