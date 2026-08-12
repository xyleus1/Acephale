import "server-only";

import { NextResponse } from "next/server";
import type { SupplyAccessContext } from "./persistence";
import { SupplyPersistenceError } from "./persistence";
import { SupplyConnectorError } from "./connector-contract";

export function supplyAccessContext(session: SupplyAccessContext): SupplyAccessContext {
  return {
    officeId: session.officeId,
    userId: session.userId,
    role: session.role,
    canViewWholeOffice: session.canViewWholeOffice,
  };
}

export function supplyErrorResponse(error: unknown) {
  if (error instanceof SupplyConnectorError) {
    const status = error.code === "RATE_LIMITED"
      ? 429
      : error.code === "SOURCE_UNAVAILABLE" || error.code === "AUTH_FAILED"
        ? 503
        : error.code === "SYNC_IN_PROGRESS" || error.code === "CONNECTOR_DISABLED"
          ? 409
          : error.code === "VALIDATION_FAILED"
            ? 422
            : 400;
    return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status });
  }
  if (!(error instanceof SupplyPersistenceError)) {
    return NextResponse.json({ error: "Supply OS request failed." }, { status: 500 });
  }
  const status = error.code === "forbidden"
    ? 403
    : error.code === "not_found"
      ? 404
      : error.code === "conflict"
        ? 409
        : 400;
  return NextResponse.json({ error: error.message, issues: error.issues }, { status });
}
