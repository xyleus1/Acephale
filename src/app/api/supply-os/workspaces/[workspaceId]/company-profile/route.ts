import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getSupplyCompanyResearch,
  storeSupplyCompanyResearch,
} from "@/lib/supply-os/customer-workspace";
import {
  parseSupplyCompanyResearch,
  toManualSupplyCompanyResearch,
} from "@/lib/supply-os/company-profile";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import {
  getSupplyWorkspace,
  requireSupplyWorkspace,
  SupplyPersistenceError,
} from "@/lib/supply-os/persistence";
import { researchCompany } from "@/lib/supply-os-company-research";

export const runtime = "nodejs";
export const maxDuration = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const profile = await getSupplyCompanyResearch(supplyAccessContext(session), workspaceId);
    return NextResponse.json(
      { research: profile?.payload ?? null, capturedAt: profile?.capturedAt ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await context.params;
  try {
    const access = supplyAccessContext(session);
    await requireSupplyWorkspace(access, workspaceId, "edit");
    const workspace = await getSupplyWorkspace(access, workspaceId);
    const rawBody = await request.text();
    let body: unknown = null;
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        throw new SupplyPersistenceError("A valid manual company profile is required.", "invalid_input");
      }
    }
    const manualProfile = isRecord(body) && "manualProfile" in body ? body.manualProfile : undefined;
    const research = manualProfile === undefined
      ? await researchCompany([
          workspace.company?.name || workspace.name,
          workspace.company?.website,
        ].filter(Boolean).join(", "))
      : (() => {
          const parsed = parseSupplyCompanyResearch(manualProfile);
          if (!parsed) {
            throw new SupplyPersistenceError("A valid manual company profile is required.", "invalid_input");
          }
          return toManualSupplyCompanyResearch(parsed);
        })();
    await storeSupplyCompanyResearch({ context: access, workspaceId, research });
    return NextResponse.json(
      { research, capturedAt: research.researchedAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
