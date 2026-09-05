import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { buildLeadPipelineReport } from "@/lib/research-pipeline";
import { requireCompanyContextWorkspace } from "@/lib/customer-context-access";
import { supplyAccessContext } from "@/lib/supply-os/http";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";

export async function GET(request: Request) {
  const session = await requireSession();
  if (session.accessKind === "customer") {
    return NextResponse.json({ error: "Not available for customer accounts." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const projectParam = params.get("projectId");
  if (!projectParam) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  try {
    const normalizedProject = projectParam.trim();
    if (normalizedProject.length > 64) return NextResponse.json({ error: "projectId is invalid." }, { status: 400 });
    const projectId = normalizedProject === "other" ? null : normalizedProject;
    const listSlug = params.get("listSlug")?.trim() || undefined;
    if (listSlug && listSlug.length > 80) {
      return NextResponse.json({ error: "listSlug is invalid." }, { status: 400 });
    }
    let companyId: string | null = null;
    const workspaceParam = params.get("workspaceId");
    if (workspaceParam && workspaceParam.length > 64) {
      return NextResponse.json({ error: "workspaceId is invalid." }, { status: 400 });
    }
    const workspaceId = workspaceParam?.trim();
    if (workspaceId) {
      const workspace = await requireCompanyContextWorkspace(supplyAccessContext(session), workspaceId, "view");
      companyId = workspace.companyId;
    }
    return NextResponse.json(await buildLeadPipelineReport({
      officeId: session.officeId,
      companyId,
      projectId,
      listSlug,
    }), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Pipeline report unavailable." },
      { status: error instanceof SupplyPersistenceError
        ? error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : 400
        : 400 },
    );
  }
}
