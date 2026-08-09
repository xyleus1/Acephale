import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  SUPPLY_CSV_KINDS,
  supplyCsvTemplate,
  type SupplyCsvKind,
} from "@/lib/supply-os/csv-import";

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { kind } = await context.params;
  if (!SUPPLY_CSV_KINDS.includes(kind as SupplyCsvKind)) {
    return NextResponse.json({ error: "Unknown Supply OS CSV template." }, { status: 404 });
  }
  return new NextResponse(supplyCsvTemplate(kind as SupplyCsvKind), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="supply-os-${kind}.csv"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
