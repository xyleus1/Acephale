import "server-only";

import { NextResponse } from "next/server";
import type { SupplyAccessContext } from "./persistence";
import { SupplyPersistenceError } from "./persistence";

export function supplyAccessContext(session: SupplyAccessContext): SupplyAccessContext {
  return {
    officeId: session.officeId,
    userId: session.userId,
    role: session.role,
    canViewWholeOffice: session.canViewWholeOffice,
  };
}

export function supplyErrorResponse(error: unknown) {
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
