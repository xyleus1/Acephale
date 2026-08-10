import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchComponentSuppliers } from "@/lib/supply-os/component-supplier-research";
import { listProcurementCasesForResearchRuns } from "@/lib/supply-os/procurement-case-persistence";
import { listSupplierSenderAccounts } from "@/lib/supply-os/supplier-communication-persistence";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { ResearchRateLimiter } from "@/lib/supply-os/research";
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

function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, max) ?? null;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const context = supplyAccessContext(session);
    const rawLimit = request.nextUrl.searchParams.get("limit");
    const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
    const page = await listSourcingResearchPage(context, {
      cursor,
      limit: rawLimit === null ? undefined : Number(rawLimit),
    });
    const cases = await listProcurementCasesForResearchRuns(context, page.runs.map((run) => run.id));
    const senderAccounts = await listSupplierSenderAccounts(context);
    return NextResponse.json({
      runs: page.runs,
      cases,
      senderAccounts,
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

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const componentItemKey = requiredText(body?.componentItemKey, 180);
  const componentName = requiredText(body?.componentName, 240);
  const manufacturer = optionalText(body?.manufacturer, 180);
  const mpn = optionalText(body?.mpn, 180);
  const specification = optionalText(body?.specification, 1_000);
  const targetCountry = optionalText(body?.targetCountry, 120);
  const requestText = optionalText(body?.requestText, 500);
  if (!componentItemKey || !componentName || manufacturer === null || mpn === null || specification === null || targetCountry === null || requestText === null) {
    return NextResponse.json({ error: "A valid component request is required." }, { status: 400 });
  }
  if (!limiter.consume(`${session.officeId}:${session.userId}`)) {
    return NextResponse.json({ error: "Supplier research rate limit reached." }, { status: 429 });
  }

  const context = supplyAccessContext(session);
  const input = {
    componentItemKey,
    componentName,
    manufacturer: manufacturer ?? null,
    mpn: mpn ?? null,
    specification: specification ?? null,
    targetCountry: targetCountry ?? null,
    requestText: requestText ?? componentName,
  };
  const run = await startSourcingResearchRun(context, input);
  try {
    const result = await searchComponentSuppliers({
      officeId: session.officeId,
      workspaceId: run.workspaceId,
      componentItemKey,
      componentName,
      manufacturer,
      mpn,
      specification,
      targetCountry,
    });
    const completedRun = await completeSourcingResearchRun({
      context,
      runId: run.id,
      workspaceId: run.workspaceId,
      output: JSON.parse(JSON.stringify(result)),
    });
    return NextResponse.json({ result, run: completedRun }, {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    await failSourcingResearchRun({
      context,
      runId: run.id,
      workspaceId: run.workspaceId,
      message: "Supplier research did not finish.",
    });
    return NextResponse.json({ error: "Supplier research did not finish." }, { status: 502 });
  }
}
