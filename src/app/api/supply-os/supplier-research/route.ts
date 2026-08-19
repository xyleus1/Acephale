import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listProcurementCasesForResearchRuns } from "@/lib/supply-os/procurement-case-persistence";
import { listSupplierSenderAccounts } from "@/lib/supply-os/supplier-communication-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { supplyIntelligenceProfile } from "@/lib/supply-os/supply-intelligence-persistence";
import {
  getSourcingResearchRun,
  listSourcingResearchPage,
} from "@/lib/supply-os/sourcing-research-persistence";

export const runtime = "nodejs";
export const maxDuration = 120;

function requiredText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const context = supplyAccessContext(session);
    const rawRunId = request.nextUrl.searchParams.get("runId");
    const rawIncludeRunIds = request.nextUrl.searchParams.getAll("includeRunId");
    const workspaceId = requiredText(request.nextUrl.searchParams.get("workspaceId"), 220) ?? undefined;
    if (rawRunId !== null) {
      const runId = requiredText(rawRunId, 220);
      if (!runId) return NextResponse.json({ error: "A valid supplier research run is required." }, { status: 400 });
      const run = await getSourcingResearchRun(context, runId, workspaceId);
      return NextResponse.json({ run }, {
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    }
    if (rawIncludeRunIds.length) {
      if (rawIncludeRunIds.length > 40) {
        return NextResponse.json({ error: "Valid workspace-scoped research run IDs are required." }, { status: 400 });
      }
      const parsedRunIds = rawIncludeRunIds.map((value) => requiredText(value, 220));
      if (parsedRunIds.some((value) => !value) || !workspaceId) {
        return NextResponse.json({ error: "Valid workspace-scoped research run IDs are required." }, { status: 400 });
      }
      const includeRunIds = [...new Set(parsedRunIds as string[])];
      const cases = await listProcurementCasesForResearchRuns(context, includeRunIds, workspaceId);
      return NextResponse.json({ runs: [], cases, senderAccounts: [], intelligenceProfile: null, page: { nextCursor: null } }, {
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    }
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const page = await listSourcingResearchPage(context, {
      cursor,
      limit: rawLimit === null ? undefined : Number(rawLimit),
      workspaceId,
    });
    const [cases, senderAccounts, intelligenceProfile] = await Promise.all([
      listProcurementCasesForResearchRuns(context, page.runs.map((run) => run.id), workspaceId),
      listSupplierSenderAccounts(context),
      workspaceId ? supplyIntelligenceProfile(context, workspaceId) : null,
    ]);
    return NextResponse.json({
      runs: page.runs,
      cases,
      senderAccounts,
      intelligenceProfile,
      page: { nextCursor: page.nextCursor },
    }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  void request;
  return NextResponse.json({
    error: "Legacy supplier research is disabled. Create a procurement request instead.",
  }, {
    status: 410,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
