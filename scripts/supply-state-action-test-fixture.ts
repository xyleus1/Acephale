import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import type { ProcurementOrderDetail, ProcurementOrderVendor } from "../src/lib/procurement-workflow";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
  hashSupplyWorldStatePacket,
} from "../src/lib/supply-os/state-runtime/canonicalize";
import {
  supplyStateScopeRef,
  type SupplyStateDependency,
  type SupplyStateScope,
  type SupplyWorldStatePacket,
} from "../src/lib/supply-os/state-runtime/types";

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export async function withEnforcedSupplyStateRuntime<T>(operation: () => Promise<T>) {
  const previousEnabled = process.env.SUPPLY_STATE_RUNTIME_ENABLED;
  const previousMode = process.env.SUPPLY_STATE_VALIDATION_MODE;
  process.env.SUPPLY_STATE_RUNTIME_ENABLED = "true";
  process.env.SUPPLY_STATE_VALIDATION_MODE = "enforce";
  try {
    return await operation();
  } finally {
    restoreEnvironment("SUPPLY_STATE_RUNTIME_ENABLED", previousEnabled);
    restoreEnvironment("SUPPLY_STATE_VALIDATION_MODE", previousMode);
  }
}

function dependency(input: {
  key: string;
  value: unknown;
  source?: SupplyStateDependency["source"];
}): SupplyStateDependency {
  const valueHash = hashSupplyStateValue(input.value);
  return {
    key: input.key,
    source: input.source ?? "WORKFLOW_DB",
    entityType: "test_fixture",
    entityRef: input.key,
    version: valueHash,
    valueHash,
    policy: "STRICT",
    reason: `${input.key} changed.`,
    evidenceRefs: [],
  };
}

function vendorIdentity(vendor: ProcurementOrderVendor) {
  return {
    id: vendor.id,
    supplierRegistryId: vendor.supplierRegistryId,
    name: vendor.name,
    website: vendor.website,
    contact: vendor.contact,
    status: vendor.status,
    contacted: vendor.contacted,
  };
}

export async function createProcurementActionStateReadFixture(args: {
  officeId: string;
  companyId: string;
  customerId: string;
  workspaceId: string;
  order: ProcurementOrderDetail;
  vendor: ProcurementOrderVendor;
  latestMessage: {
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    fromEmail: string;
  };
}) {
  const scope: Extract<SupplyStateScope, { type: "procurement_request" }> = {
    type: "procurement_request",
    officeId: args.officeId,
    companyId: args.companyId,
    customerId: args.customerId,
    orderId: args.order.id,
    workspaceId: args.workspaceId,
  };
  const suffix = `${args.customerId}:${args.order.id}:${args.vendor.id}`;
  const dependencies = [
    dependency({
      key: `procurement.order:${args.customerId}:${args.order.id}`,
      value: { id: args.order.id, status: args.order.status },
    }),
    dependency({
      key: `procurement.order_request_context:${args.customerId}:${args.order.id}`,
      value: args.order.requestContext,
    }),
    dependency({ key: `procurement.vendor:${suffix}`, value: vendorIdentity(args.vendor) }),
    dependency({ key: `procurement.vendor_quote:${suffix}`, value: args.vendor.quote }),
    dependency({
      key: `procurement.vendor_latest_message:${suffix}`,
      value: args.latestMessage,
      source: "EMAIL_LEDGER",
    }),
    dependency({ key: `procurement.vendor_triage:${suffix}`, value: null }),
  ];
  const sourceFingerprint = hashSupplyStateDependencies(dependencies);
  const unsealed: SupplyWorldStatePacket = {
    schemaVersion: 1,
    compilerVersion: "supply-state-runtime-v1",
    scope,
    objective: "Exercise the durable supplier action binding boundary.",
    compiledAt: "2026-08-27T12:00:00.000Z",
    currentState: {
      procurementRequest: {
        id: args.order.id,
        status: args.order.status,
        vendors: [{
          ...vendorIdentity(args.vendor),
          responseCount: args.vendor.responseCount,
          quote: args.vendor.quote,
          conversation: { latestMessage: args.latestMessage },
          triage: null,
          savedDraft: null,
        }],
      },
    },
    derivedState: {},
    openLoops: [],
    uncertainties: [],
    evidenceRefs: [],
    dependencies,
    sourceFingerprint,
    packetHash: "",
    diagnostics: {
      projectionHit: false,
      sourceCounts: { procurementOrders: 1, procurementVendors: 1, procurementMessages: 1 },
      timingsMs: {},
    },
  };
  const packet = { ...unsealed, packetHash: hashSupplyWorldStatePacket(unsealed) };
  return prisma.supplyStateRead.create({
    data: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      scopeType: scope.type,
      scopeRef: supplyStateScopeRef(scope),
      objective: packet.objective,
      compilerVersion: packet.compilerVersion,
      sourceFingerprint: packet.sourceFingerprint,
      packet: packet as unknown as Prisma.InputJsonValue,
      packetHash: packet.packetHash,
      evidenceRefs: [] as Prisma.InputJsonValue,
      dependencyManifest: dependencies as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, packetHash: true, sourceFingerprint: true },
  });
}
