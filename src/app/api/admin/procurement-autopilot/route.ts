import { NextRequest, NextResponse } from "next/server";
import { operatorSecretAuthorized } from "@/lib/admin-operator-secret";
import { AUTOPILOT_MAX_PER_RUN, runProcurementAutopilot } from "@/lib/procurement-autopilot";
import { FILE_SEND_CONFIRMATION } from "@/lib/procurement-file-draft-send";
import { procurementOrderIdError } from "@/lib/procurement-order-id";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = await req.json().catch(() => ({})) as {
    orderId?: unknown;
    limit?: unknown;
    confirm?: unknown;
  };
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  // Without the confirmation phrase the pass drafts and reports only, so the
  // default behaviour of the loop never puts mail in front of a supplier.
  const autoSend = payload.confirm === FILE_SEND_CONFIRMATION;
  const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
    ? Math.min(AUTOPILOT_MAX_PER_RUN, Math.max(1, Math.trunc(payload.limit)))
    : AUTOPILOT_MAX_PER_RUN;
  try {
    const result = await runProcurementAutopilot({ orderId, autoSend, limit });
    if (!result) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("procurement autopilot run failed", error);
    return NextResponse.json({ error: "The sourcing autopilot run failed." }, { status: 500 });
  }
}
