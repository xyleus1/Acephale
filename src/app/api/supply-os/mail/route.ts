import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listOfficeMailThreads } from "@/lib/supply-os/office-mail";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const researchProjectId = params.get("researchProjectId")?.trim() || undefined;
  const rawLimit = params.get("limit");
  let limit: number | undefined;
  if (rawLimit !== null) {
    const parsedLimit = Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return NextResponse.json({ error: "Limit must be an integer between 1 and 100." }, { status: 400 });
    }
    limit = parsedLimit;
  }
  try {
    const result = await listOfficeMailThreads(supplyAccessContext(session), {
      cursor: params.get("cursor"),
      limit,
      search: params.get("search"),
      researchProjectId,
    });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
