import { NextRequest, NextResponse } from "next/server";
import { operatorSecretAuthorized } from "@/lib/admin-operator-secret";
import { procurementOrderIdError } from "@/lib/procurement-order-id";
import {
  FILE_SEND_CONFIRMATION,
  FILE_SEND_MAX_PER_RUN,
  runProcurementFileDraftSendBatch,
} from "@/lib/procurement-file-draft-send";

export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!operatorSecretAuthorized(req)) return unauthorized();
  const payload = await req.json().catch(() => ({})) as {
    orderId?: unknown;
    limit?: unknown;
    confirm?: unknown;
  };
  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const invalid = procurementOrderIdError(orderId);
  if (invalid) return badRequest(invalid);
  // Sending supplier mail is irreversible, so the confirmation phrase has to be
  // present in the request body rather than implied by the route.
  if (payload.confirm !== FILE_SEND_CONFIRMATION) {
    return badRequest("This send needs an explicit confirmation.");
  }
  const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit)
    ? Math.min(FILE_SEND_MAX_PER_RUN, Math.max(1, Math.trunc(payload.limit)))
    : FILE_SEND_MAX_PER_RUN;
  try {
    const result = await runProcurementFileDraftSendBatch({ orderId, limit });
    if (!result) return NextResponse.json({ error: "The sourcing request was not found." }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("procurement file draft send failed", error);
    return NextResponse.json({ error: "The supplier file send failed." }, { status: 500 });
  }
}
