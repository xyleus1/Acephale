import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { researchCompany } from "@/lib/supply-os-company-research";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { query?: unknown } | null;
  if (typeof body?.query !== "string" || body.query.trim().length < 2 || body.query.length > 4_000) {
    return NextResponse.json({ error: "Add a company name, website, or operating description." }, { status: 400 });
  }

  try {
    const research = await researchCompany(body.query);
    return NextResponse.json({ research });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Company research failed.";
    const status = message === "Company research is not configured." ? 503 : 502;
    return NextResponse.json({ error: message.slice(0, 240) }, { status });
  }
}
