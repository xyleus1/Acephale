import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { createResearchProject, listResearchProjects } from "@/lib/research-projects";

export async function GET() {
  const session = await requireSession();
  if (session.accessKind === "customer") {
    return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  }
  return NextResponse.json(
    { projects: await listResearchProjects(session.officeId) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (session.accessKind === "customer") {
    return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "A project definition is required." }, { status: 400 });
  }
  try {
    const project = await createResearchProject(session.officeId, {
      name: typeof body.name === "string" ? body.name.slice(0, 160) : "",
      description: typeof body.description === "string" ? body.description.slice(0, 1000) : undefined,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Project could not be created." }, { status: 400 });
  }
}
