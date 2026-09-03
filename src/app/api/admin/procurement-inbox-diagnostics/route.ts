import { NextRequest, NextResponse } from "next/server";
import { operatorSecretAuthorized } from "@/lib/admin-operator-secret";
import { procurementInboxDiagnostics } from "@/lib/procurement-inbox-diagnostics";
import { procurementOrderIdError } from "@/lib/procurement-order-id";

export const maxDuration = 300;

// Read only: it reports which mailbox each RFQ went out from and whether that
// mailbox still ingests replies, so a campaign that looks unanswered can be
// told apart from one whose answers never arrive.
export async function GET(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orderId = req.nextUrl.searchParams.get("orderId")?.trim() ?? "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  try {
    const diagnostics = await procurementInboxDiagnostics(orderId);
    if (!diagnostics) {
      return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    }
    return NextResponse.json(diagnostics);
  } catch (error) {
    console.error("procurement inbox diagnostics failed", error);
    return NextResponse.json({ error: "The inbox diagnostics failed." }, { status: 500 });
  }
}
