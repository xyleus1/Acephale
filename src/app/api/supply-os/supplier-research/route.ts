import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  searchComponentSuppliers,
  supplierResearchError,
} from "@/lib/supply-os/component-supplier-research";
import { listProcurementCasesForResearchRuns } from "@/lib/supply-os/procurement-case-persistence";
import { listSupplierSenderAccounts } from "@/lib/supply-os/supplier-communication-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { ResearchRateLimiter } from "@/lib/supply-os/research";
import { supplyIntelligenceProfile } from "@/lib/supply-os/supply-intelligence-persistence";
import {
  executeSupplierResearchRoute,
  type SupplierResearchRouteResponse,
} from "@/lib/supply-os/supplier-research-route-contract";
import {
  completeSourcingResearchRun,
  failSourcingResearchRun,
  listSourcingResearchPage,
  startSourcingResearchRun,
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
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const workspaceId = requiredText(request.nextUrl.searchParams.get("workspaceId"), 220) ?? undefined;
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
      startRun: (routeContext, input, workspaceId) => startSourcingResearchRun(routeContext as typeof context, input, workspaceId),
      search: (input) => searchComponentSuppliers({
        ...input,
        manufacturer: input.manufacturer ?? undefined,
        mpn: input.mpn ?? undefined,
        specification: input.specification ?? undefined,
        targetCountry: input.targetCountry ?? undefined,
        requestedQuantity: input.requestedQuantity ?? undefined,
        requestedUnit: input.requestedUnit ?? undefined,
        sourceRegion: input.sourceRegion ?? undefined,
        deliveryLocation: input.deliveryLocation ?? undefined,
        needByDate: input.needByDate ?? undefined,
      }),
      supplierFailure: supplierResearchError,
      failRun: (args) => failSourcingResearchRun({ ...args, context: args.context as typeof context }),
      completeRun: (args) => completeSourcingResearchRun({
        ...args,
        context: args.context as typeof context,
        output: args.output as Parameters<typeof completeSourcingResearchRun>[0]["output"],
      }),
      intelligenceProfile: (routeContext, workspaceId) => supplyIntelligenceProfile(routeContext as typeof context, workspaceId),
      persistenceFailure: async (error) => {
        const response = supplyErrorResponse(error);
        return {
          status: response.status,
          body: await response.json() as Record<string, unknown>,
        };
      },
    },
  });
  return routeResponse(response);
}
