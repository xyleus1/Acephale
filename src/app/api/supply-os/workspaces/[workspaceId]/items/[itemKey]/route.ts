import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supplyAccessContext, supplyErrorResponse } from "@/lib/supply-os/http";
import { deleteManagedSupplyItem, updateManagedSupplyItem } from "@/lib/supply-os/workspace-management";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string; itemKey: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, itemKey } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Item details are required." }, { status: 400 });
  try {
    const result = await updateManagedSupplyItem(supplyAccessContext(session), workspaceId, itemKey, {
      name: typeof body.name === "string" ? body.name : "",
      description: typeof body.description === "string" ? body.description : null,
      manufacturer: typeof body.manufacturer === "string" ? body.manufacturer : null,
      mpn: typeof body.mpn === "string" ? body.mpn : null,
      unitOfMeasure: typeof body.unitOfMeasure === "string" ? body.unitOfMeasure : "",
      requestedQuantity: typeof body.requestedQuantity === "number" ? body.requestedQuantity : null,
      requestedUnit: typeof body.requestedUnit === "string" ? body.requestedUnit : null,
      supplierDeliverable: typeof body.supplierDeliverable === "string" ? body.supplierDeliverable : null,
      deliveryLocation: typeof body.deliveryLocation === "string" ? body.deliveryLocation : null,
      needByDate: typeof body.needByDate === "string" ? body.needByDate : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return supplyErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ workspaceId: string; itemKey: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, itemKey } = await context.params;
  try {
    return NextResponse.json(await deleteManagedSupplyItem(supplyAccessContext(session), workspaceId, itemKey));
  } catch (error) {
    return supplyErrorResponse(error);
  }
}
