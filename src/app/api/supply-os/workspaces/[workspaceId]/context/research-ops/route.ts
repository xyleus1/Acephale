import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendCompanyContextMessage } from "@/lib/company-context";
import { requireCompanyContextWorkspace } from "@/lib/customer-context-access";
import { createCompanyContextResearchOperations } from "@/lib/supply-os/context-research-ops";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 300;

const KINDS = new Set(["pause", "resume", "purge", "requalify", "enrich"]);

export async function POST(
  request: Request,
  route: { params: Promise<{ workspaceId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.accessKind === "customer" || session.role === "CUSTOMER") {
    return NextResponse.json({ error: "Research operations are not available for customer access." }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const projectId = body?.projectId === null ? null : typeof body?.projectId === "string" ? body.projectId.trim() : undefined;
  const listSlug = body?.listSlug === undefined
    ? undefined
    : typeof body.listSlug === "string" ? body.listSlug.trim() : null;
  if (!KINDS.has(kind) || projectId === undefined || (typeof projectId === "string" && !projectId) || listSlug === null || (listSlug !== undefined && (!listSlug || listSlug.length > 80))) {
    return NextResponse.json({ error: "A valid research operation and project are required." }, { status: 400 });
  }
  if (projectId === null) return NextResponse.json({ error: "Other lists has no project" }, { status: 400 });
  const { workspaceId } = await route.params;
  if (workspaceId.length > 64) {
    return NextResponse.json({ error: "workspaceId is invalid." }, { status: 400 });
  }
  if (projectId.length > 64) {
    return NextResponse.json({ error: "projectId is invalid." }, { status: 400 });
  }
  try {
    const context = supplyAccessContext(session);
    const workspace = await requireCompanyContextWorkspace(context, workspaceId, "edit");
    const project = await prisma.researchProject.findFirst({
      where: {
        id: projectId,
        officeId: session.officeId,
        OR: [{ companyId: null }, { companyId: workspace.companyId }],
      },
      select: { id: true, name: true },
    });
    if (!project) return NextResponse.json({ error: "Project is not available in this workspace." }, { status: 404 });
    const bodyText = kind === "requalify"
      ? `Screen unscreened rows in ${project.name}`
      : kind === "enrich"
        ? `Find contacts for ${project.name}`
        : kind === "purge"
          ? `Remove purgeable rows from ${project.name}`
          : kind === "pause"
            ? `Pause research in ${project.name}`
            : `Resume research in ${project.name}`;
    const message = await appendCompanyContextMessage({
      context,
      workspaceId,
      role: "OPERATOR",
      body: bodyText,
    });
    const operations = await createCompanyContextResearchOperations({
      context,
      workspaceId,
      items: [{
        request: { kind: kind as "pause" | "resume" | "purge" | "requalify" | "enrich", projectName: project.name, regions: [], note: bodyText },
        projectId: project.id,
        projectName: project.name,
      }],
      requestMessageId: message.id,
      requestBody: bodyText,
      requestCreatedAt: message.createdAt,
      listSlug,
    });
    return NextResponse.json({ operations }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
