import { handleProcurementReplySend } from "@/lib/procurement-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string; vendorId: string }> },
) {
  const { orderId, vendorId } = await context.params;
  return handleProcurementReplySend(request, orderId, vendorId);
}
