import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { csvCell } from "@/lib/csv";
import { exportResearchRecords } from "@/lib/research-lists";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const session = await requireSession();
  if (session.accessKind === "customer") return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  try {
    const { slug } = await context.params;
    const params = new URL(request.url).searchParams;
    const list = await exportResearchRecords(session.officeId, slug.slice(0, 80), {
      query: params.get("q")?.slice(0, 120) || undefined,
      status: params.get("status")?.slice(0, 40) || undefined,
    });
    const lines = [
      list.fields.map((field) => csvCell(field.key)).join(","),
      ...list.rows.map((row) => list.fields.map((field) => csvCell(String(row.data[field.key] ?? ""))).join(",")),
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${list.slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
        "x-research-export-truncated": String(list.truncated),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Export could not be created." }, { status: 404 });
  }
}
