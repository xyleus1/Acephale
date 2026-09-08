import "server-only";

import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { supplyStateRuntimeConfig } from "@/lib/supply-os/state-runtime/config";
import {
  supplyStateScopeRef,
  type SupplyStateScope,
} from "@/lib/supply-os/state-runtime/types";
import { buildSupplyStateProjection } from "./build";
import { storeSupplyStateProjection } from "./store";
import {
  projectionTypeForSupplyStateScope,
  SUPPLY_STATE_COMPILER_VERSION,
  type SupplyStateProjectionRequest,
} from "./types";

type ProjectionJobPayload = {
  scope: SupplyStateScope;
  compilerVersion: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string) {
  return value === null || value === undefined || value === ""
    ? null
    : requiredString(value, label);
}

export function parseSupplyStateProjectionJobPayload(
  officeId: string,
  value: unknown,
): ProjectionJobPayload {
  const payload = record(value);
  const rawScope = record(payload.scope);
  const type = requiredString(rawScope.type, "Projection scope type");
  const scopedOfficeId = requiredString(rawScope.officeId, "Projection scope office");
  if (scopedOfficeId !== officeId) throw new Error("Projection job office does not match its scope.");
  let scope: SupplyStateScope;
  if (type === "company") {
    scope = {
      type,
      officeId,
      companyId: requiredString(rawScope.companyId, "Company ID"),
      workspaceId: optionalString(rawScope.workspaceId, "Workspace ID"),
    };
  } else if (type === "procurement_request") {
    scope = {
      type,
      officeId,
      companyId: requiredString(rawScope.companyId, "Company ID"),
      customerId: requiredString(rawScope.customerId, "Workflow customer ID"),
      orderId: requiredString(rawScope.orderId, "Procurement order ID"),
      workspaceId: optionalString(rawScope.workspaceId, "Workspace ID"),
    };
  } else if (type === "supplier") {
    scope = {
      type,
      officeId,
      companyId: optionalString(rawScope.companyId, "Company ID"),
      workspaceId: optionalString(rawScope.workspaceId, "Workspace ID"),
      supplierId: optionalString(rawScope.supplierId, "Supplier ID"),
      supplierKey: optionalString(rawScope.supplierKey, "Supplier key"),
      orderId: optionalString(rawScope.orderId, "Procurement order ID"),
      vendorId: optionalString(rawScope.vendorId, "Procurement vendor ID"),
    };
  } else if (type === "item") {
    scope = {
      type,
      officeId,
      companyId: requiredString(rawScope.companyId, "Company ID"),
      workspaceId: requiredString(rawScope.workspaceId, "Workspace ID"),
      itemId: optionalString(rawScope.itemId, "Item ID"),
      itemKey: optionalString(rawScope.itemKey, "Item key"),
    };
  } else if (type === "workspace") {
    scope = {
      type,
      officeId,
      workspaceId: requiredString(rawScope.workspaceId, "Workspace ID"),
    };
  } else {
    throw new Error("Projection scope type is unsupported.");
  }
  // Canonical scope construction also checks that item and supplier identities
  // are present and keeps the resulting database key bounded.
  supplyStateScopeRef(scope);
  return {
    scope,
    compilerVersion: requiredString(payload.compilerVersion, "Compiler version"),
  };
}

export function supplyStateProjectionJobDedupeKey(request: SupplyStateProjectionRequest) {
  const compilerVersion = request.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  return [
    "state-projection",
    request.scope.officeId,
    projectionTypeForSupplyStateScope(request.scope),
    request.scope.type,
    supplyStateScopeRef(request.scope),
    compilerVersion,
  ].join(":");
}

export async function enqueueSupplyStateProjectionRebuild(request: SupplyStateProjectionRequest) {
  const compilerVersion = request.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  return enqueueBackgroundJob({
    officeId: request.scope.officeId,
    type: "SUPPLY_STATE_PROJECTION_REBUILD",
    payload: JSON.parse(JSON.stringify({
      scope: request.scope,
      compilerVersion,
    })) as Record<string, unknown>,
    dedupeKey: supplyStateProjectionJobDedupeKey({ ...request, compilerVersion }),
    maxAttempts: 3,
  });
}

export async function enqueueSupplyStateProjectionRebuildIfEnabled(
  request: SupplyStateProjectionRequest,
) {
  const config = supplyStateRuntimeConfig();
  if (!config.enabled || !config.projectionsEnabled) return null;
  return enqueueSupplyStateProjectionRebuild(request);
}

export async function rebuildSupplyStateProjection(request: SupplyStateProjectionRequest) {
  const build = await buildSupplyStateProjection(request);
  if (build.hadReaderFailure) {
    throw new Error("Projection rebuild did not complete every required source reader.");
  }
  const stored = await storeSupplyStateProjection(build);
  return stored;
}

export async function runSupplyStateProjectionRebuildJob(args: {
  officeId: string;
  payload: unknown;
}) {
  const config = supplyStateRuntimeConfig();
  if (!config.enabled || !config.projectionsEnabled) {
    return {
      skipped: true as const,
      reason: !config.enabled ? "runtime_disabled" as const : "projections_disabled" as const,
    };
  }
  const request = parseSupplyStateProjectionJobPayload(args.officeId, args.payload);
  const projection = await rebuildSupplyStateProjection(request);
  return {
    projectionId: projection.id,
    projectionType: projection.projectionType,
    sourceFingerprint: projection.sourceFingerprint,
    payloadHash: projection.payloadHash,
  };
}
