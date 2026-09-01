import "server-only";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import type { SupplyAccessContext } from "./persistence";
import { SupplyPersistenceError } from "./persistence";
import { SupplyConnectorError } from "./connector-contract";

export function supplyAccessContext(session: SupplyAccessContext): SupplyAccessContext {
  return {
    officeId: session.officeId,
    userId: session.userId,
    role: session.role,
    canViewWholeOffice: session.canViewWholeOffice,
    accessKind: session.accessKind,
    restrictedWorkspaceIds: session.restrictedWorkspaceIds,
  };
}

export function isMissingSchemaError(error: unknown) {
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
  return code === "P2021" || code === "P2022";
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
    if (isMissingSchemaError(error)) {
      console.error("[supply-os] database schema is behind the deployed code", error);
      return NextResponse.json(
        { error: "This environment is missing a database migration, so the request could not be stored." },
        { status: 503 },
      );
    }
    console.error("[supply-os] unhandled request failure", error);
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
