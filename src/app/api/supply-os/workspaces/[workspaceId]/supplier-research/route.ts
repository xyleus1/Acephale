import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchComponentSuppliers } from "@/lib/supply-os/component-supplier-research";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { getSupplyWorkspace } from "@/lib/supply-os/persistence";
import { ResearchRateLimiter } from "@/lib/supply-os/research";

export const runtime = "nodejs";
export const maxDuration = 120;

const limiter = new ResearchRateLimiter(10, 60 * 60 * 1_000);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  let workspace: Awaited<ReturnType<typeof getSupplyWorkspace>>;
  try {
    workspace = await getSupplyWorkspace(supplyAccessContext(session), workspaceId);
  } catch (error) {
    return supplyErrorResponse(error);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const componentItemKey = typeof body?.componentItemKey === "string" ? body.componentItemKey.trim() : "";
  if (!componentItemKey || componentItemKey.length > 180) {
    return NextResponse.json({ error: "A valid component key is required." }, { status: 400 });
  }
  const component = workspace.snapshots[0]?.items.find((item) => item.itemKey === componentItemKey);
  if (!component) return NextResponse.json({ error: "Component was not found in the current published snapshot." }, { status: 404 });
  if (!limiter.consume(`${session.officeId}:${session.userId}`)) {
    return NextResponse.json({ error: "Supplier research rate limit reached." }, { status: 429 });
  }
  const optional = (key: string, max: number) => typeof body?.[key] === "string" ? String(body[key]).trim().slice(0, max) || undefined : undefined;
  const result = await searchComponentSuppliers({
    officeId: session.officeId,
    workspaceId,
    componentItemKey,
    componentName: component.name,
    manufacturer: component.manufacturer ?? undefined,
    mpn: component.mpn ?? undefined,
    specification: optional("specification", 1_000) ?? component.description ?? undefined,
    targetCountry: optional("targetCountry", 120),
  });
  return NextResponse.json({ result }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
