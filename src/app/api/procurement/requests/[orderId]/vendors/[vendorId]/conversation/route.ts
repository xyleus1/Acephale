import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import { getProcurementFileDeliveryDraft } from "@/lib/procurement-file-delivery-draft";
import {
  procurementReplyFacts,
  triageSupplierInbound,
} from "@/lib/procurement-inbound-triage";
import {
  customerCanAccessProcurementOrder,
  handleProcurementReplyDraft,
} from "@/lib/procurement-route-handlers";
import {
  getProcurementRequest,
  ProcurementWorkflowError,
  resolveProcurementCustomerId,
} from "@/lib/procurement-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string; vendorId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  try {
    const { orderId, vendorId } = await context.params;
    const customerId = await resolveProcurementCustomerId(session);
    const order = await getProcurementRequest(customerId, orderId);
    if (!customerCanAccessProcurementOrder(session, order)) {
      return NextResponse.json(
        { error: "Supplier conversation not found." },
        { status: 404, headers: responseHeaders },
      );
    }
    const conversation = await procurementVendorConversation({
      officeId: session.officeId,
      customerId,
      orderId,
      vendorId,
    });
    const fileDraft = order
      ? await getProcurementFileDeliveryDraft({ officeId: session.officeId, order, vendorId })
      : null;
    const latest = conversation.messages.at(-1);
    const triage = order && latest?.direction === "INBOUND"
      ? triageSupplierInbound({
          subject: latest.subject,
          body: latest.body,
          facts: procurementReplyFacts(order),
        })
      : null;
    return NextResponse.json({ conversation, triage, fileDraft }, { headers: responseHeaders });
  } catch (error) {
    if (error instanceof ProcurementWorkflowError) {
      const status = error.code === "forbidden"
        ? 403
        : error.code === "not_found"
          ? 404
          : error.code === "configuration" || error.code === "conflict"
            ? 409
            : 503;
      return NextResponse.json({ error: error.message }, { status, headers: responseHeaders });
    }
    return NextResponse.json({ error: "Supplier conversation is unavailable." }, { status: 500, headers: responseHeaders });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string; vendorId: string }> },
) {
  const { orderId, vendorId } = await context.params;
  return handleProcurementReplyDraft(request, orderId, vendorId);
}
