import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { loadResearchList, parseDelimitedRecords, upsertResearchRecords } from "@/lib/research-lists";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const session = await requireSession();
  if (session.accessKind === "customer") return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.text !== "string") return NextResponse.json({ error: "Import text is required." }, { status: 400 });
  if (body.text.length > 4_000_000) return NextResponse.json({ error: "Import text is too large." }, { status: 400 });
  try {
    const { slug } = await context.params;
    const list = await loadResearchList(session.officeId, slug.slice(0, 80));
    const parsed = parseDelimitedRecords(body.text, list.fields);
    if (parsed.rows.length > 2000) return NextResponse.json({ error: "At most 2000 rows can be imported at once." }, { status: 400 });
    const result = await upsertResearchRecords(session.officeId, slug, parsed.rows, {
      dedupeField: typeof body.dedupeField === "string" ? body.dedupeField.slice(0, 80) : undefined,
    });
    return NextResponse.json({ ...result, errors: [...parsed.errors, ...result.errors].slice(0, 50) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import could not be processed." }, { status: 400 });
  }
}
