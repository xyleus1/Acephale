import { handleProcurementWake } from "@/lib/procurement-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await context.params;
  return handleProcurementWake(orderId);
}
