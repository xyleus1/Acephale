import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createResearchList } from "@/lib/research-lists";

export async function POST(request: Request) {
  const session = await requireSession();
  if (session.accessKind === "customer") return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "A list definition is required." }, { status: 400 });
  try {
    const list = await createResearchList(session.officeId, {
      name: typeof body.name === "string" ? body.name.slice(0, 160) : "",
      slug: typeof body.slug === "string" ? body.slug.slice(0, 80) : undefined,
      description: typeof body.description === "string" ? body.description.slice(0, 1000) : undefined,
      fields: body.fields,
    });
    return NextResponse.json({ list }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "List could not be created." }, { status: 400 });
  }
}
