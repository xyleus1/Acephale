import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listProcurementCasesForResearchRuns } from "@/lib/supply-os/procurement-case-persistence";
import { listSupplierSenderAccounts } from "@/lib/supply-os/supplier-communication-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { ResearchRateLimiter } from "@/lib/supply-os/research";
import { supplyIntelligenceProfile } from "@/lib/supply-os/supply-intelligence-persistence";
import { runSourcingResearchWorker } from "@/lib/supply-os/supplier-research-worker";
import {
  executeSupplierResearchRoute,
  type SupplierResearchRouteResponse,
} from "@/lib/supply-os/supplier-research-route-contract";
import {
  enqueueSourcingResearchRun,
  getSourcingResearchRun,
  listSourcingResearchPage,
} from "@/lib/supply-os/sourcing-research-persistence";

export const runtime = "nodejs";
export const maxDuration = 120;

const limiter = new ResearchRateLimiter(10, 60 * 60 * 1_000);

function requiredText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function routeResponse(response: SupplierResearchRouteResponse) {
  return NextResponse.json(response.body, {
    status: response.status,
    headers: response.headers,
  });
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
  const context = supplyAccessContext(session);
  const body = await request.json().catch(() => null);
  const response = await executeSupplierResearchRoute({
    body,
    context,
    dependencies: {
      consumeRateLimit: (key) => limiter.consume(key),
      enqueueRun: ({ context: routeContext, input, workspaceId }) => enqueueSourcingResearchRun({
        context: routeContext as typeof context,
        input,
        workspaceId,
      }),
      persistenceFailure: async (error) => {
        const response = supplyErrorResponse(error);
        return {
          status: response.status,
          body: await response.json() as Record<string, unknown>,
        };
      },
    },
  });
  if (response.status === 202) {
    const run = response.body.run as { id?: unknown; workspaceId?: unknown } | undefined;
    if (typeof run?.id === "string" && typeof run.workspaceId === "string") {
      after(async () => {
        await runSourcingResearchWorker({
          id: run.id as string,
          officeId: context.officeId,
          workspaceId: run.workspaceId as string,
        }).catch(() => undefined);
      });
    }
  }
  return routeResponse(response);
}
