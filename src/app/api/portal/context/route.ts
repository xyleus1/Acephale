import { NextRequest, NextResponse } from "next/server";
import { getCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import type { CustomerPortalPrincipal } from "@/lib/customer-portal-data";
import {
  appendCustomerSupplyContextMessage,
  createCustomerSupplyContextNode,
  loadCustomerSupplyContext,
} from "@/lib/supply-os/context-persistence";
import { supplyErrorResponse } from "@/lib/supply-os/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = request.nextUrl.searchParams.get("company") ?? "";
  try {
    const context = await loadCustomerSupplyContext(principal as CustomerPortalPrincipal, companyId, request.nextUrl.searchParams.get("node"));
    return NextResponse.json({ context }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const principal = await getCustomerPortalPrincipal();
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const companyId = String(body?.companyId ?? "");
  try {
    if (body?.operation === "CREATE_NODE") {
      const node = await createCustomerSupplyContextNode({
        principal: principal as CustomerPortalPrincipal,
        companyId,
        parentId: String(body.parentId ?? ""),
        scopeType: body.scopeType,
        name: body.name,
        description: body.description,
      });
      return NextResponse.json({ node: { id: node.id, parentId: node.parentId, scopeType: node.scopeType, name: node.name } }, { status: 201 });
    }
    if (body?.operation === "POST_MESSAGE") {
      const message = await appendCustomerSupplyContextMessage({
        principal: principal as CustomerPortalPrincipal,
        companyId,
        nodeId: String(body.nodeId ?? ""),
        body: body.body,
      });
      return NextResponse.json({ message: { id: message.id, nodeId: message.nodeId, role: message.role, body: message.body, createdAt: message.createdAt } }, { status: 201 });
    }
    return NextResponse.json({ error: "Unsupported context operation." }, { status: 400 });
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
