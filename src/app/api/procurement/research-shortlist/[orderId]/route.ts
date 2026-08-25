import { procurementResearchShortlistResponse } from "@/lib/procurement-research-shortlist-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  return procurementResearchShortlistResponse(request, orderId);
}
