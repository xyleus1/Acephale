import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  searchSteelSuppliers,
  SteelSupplierSearchError,
} from "@/lib/steel-supplier-search";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 12_000) {
    return NextResponse.json({ error: "Supplier search brief is too large." }, { status: 413 });
  }
  const body = await request.json().catch(() => null);
  try {
    const result = await searchSteelSuppliers(body);
    return NextResponse.json({ result }, {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const known = error instanceof SteelSupplierSearchError ? error : null;
    const status = known?.code === "invalid_input" ? 400 : 503;
    return NextResponse.json({
      error: known?.message ?? "Supplier research failed.",
    }, { status });
  }
}
