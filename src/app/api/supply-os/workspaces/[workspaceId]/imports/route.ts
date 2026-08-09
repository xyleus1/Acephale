import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  SUPPLY_CSV_KINDS,
  type SupplyCsvBundle,
  type SupplyCsvColumnMappings,
} from "@/lib/supply-os/csv-import";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { stageSupplyCsvImport } from "@/lib/supply-os/persistence";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_REQUEST_BYTES = 6_000_000;
const MAX_FILE_CHARACTERS = 2_000_000;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "CSV import is too large." }, { status: 413 });
  }
  const body = await request.json().catch(() => null) as {
    sourceName?: unknown;
    files?: unknown;
    columnMappings?: unknown;
  } | null;
  if (!body?.files || typeof body.files !== "object" || Array.isArray(body.files)) {
    return NextResponse.json({ error: "CSV files are required." }, { status: 400 });
  }

  const files: SupplyCsvBundle = {};
  for (const kind of SUPPLY_CSV_KINDS) {
    const value = (body.files as Record<string, unknown>)[kind];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || value.length > MAX_FILE_CHARACTERS) {
      return NextResponse.json({ error: `${kind} must be a CSV string under 2 MB.` }, { status: 400 });
    }
    files[kind] = value;
  }

  const columnMappings: SupplyCsvColumnMappings = {};
  if (body.columnMappings !== undefined) {
    if (!body.columnMappings || typeof body.columnMappings !== "object" || Array.isArray(body.columnMappings)) {
      return NextResponse.json({ error: "Column mappings must be an object." }, { status: 400 });
    }
    for (const kind of SUPPLY_CSV_KINDS) {
      const rawMapping = (body.columnMappings as Record<string, unknown>)[kind];
      if (rawMapping === undefined) continue;
      if (!rawMapping || typeof rawMapping !== "object" || Array.isArray(rawMapping)) {
        return NextResponse.json({ error: `${kind} column mapping must be an object.` }, { status: 400 });
      }
      const entries = Object.entries(rawMapping as Record<string, unknown>);
      if (entries.length > 40 || entries.some(([key, value]) => !key || typeof value !== "string" || value.length > 100)) {
        return NextResponse.json({ error: `${kind} column mapping is invalid.` }, { status: 400 });
      }
      columnMappings[kind] = Object.fromEntries(entries) as Record<string, string>;
    }
  }

  const { workspaceId } = await context.params;
  try {
    const importRun = await stageSupplyCsvImport(supplyAccessContext(session), workspaceId, {
      sourceName: typeof body.sourceName === "string" ? body.sourceName : null,
      files,
      columnMappings,
    });
    return NextResponse.json({ importRun }, { status: 201 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
