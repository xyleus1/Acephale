import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { loadProjectStatusFacts } from "@/lib/supply-os/project-status";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.accessKind === "customer") {
    return NextResponse.json({ error: "Operator access required" }, { status: 403 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const key = url.searchParams.get("key")?.trim() ?? "";
  if (kind !== "sourcing" && kind !== "prospecting") {
    return NextResponse.json({ error: "Invalid project kind" }, { status: 400 });
  }
  if (!key) return NextResponse.json({ error: "Project key is required" }, { status: 400 });
  try {
    const facts = await loadProjectStatusFacts({ officeId: session.officeId, kind, key });
    if (!facts) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(facts, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[supply-os] project status failed", {
      kind,
      key,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ error: "Project status is unavailable" }, { status: 500 });
  }
}
