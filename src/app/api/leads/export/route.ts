import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { loadLeadExportRows } from "@/lib/leads-directory";

const HEADERS = [
  "company",
  "website",
  "city",
  "fit_score",
  "fit_tier",
  "segments",
  "source",
  "contact_name",
  "email",
  "phone",
  "email_verdict",
  "email_confidence",
  "evidence",
] as const;

function csvCell(value: string) {
  // Harvested text reaches this export unchanged, so a cell that a spreadsheet
  // would evaluate as a formula gets a literal apostrophe prefix.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const escaped = safe.replace(/"/g, '""');
  return /[",\n\r]/.test(safe) ? `"${escaped}"` : escaped;
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (session.accessKind === "customer") {
    return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const rows = await loadLeadExportRows(session.officeId, {
    query: params.get("q")?.slice(0, 120) ?? undefined,
    source: params.get("source")?.slice(0, 120) ?? undefined,
    priority: params.get("priority")?.slice(0, 20) ?? undefined,
  });

  const lines = [HEADERS.join(",")];
  for (const row of rows) {
    lines.push([
      row.company,
      row.website,
      row.city,
      row.fitScore,
      row.fitTier,
      row.segments,
      row.source,
      row.contactName,
      row.email,
      row.phone,
      row.emailVerdict,
      row.emailConfidence,
      row.evidence,
    ].map(csvCell).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
