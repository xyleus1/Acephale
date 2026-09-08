import "server-only";

import { prisma } from "@/lib/prisma";
import {
  getProcurementWorkflowAccount,
  type ProcurementOrderDetail,
} from "@/lib/procurement-workflow";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";
import { procurementVendorStatePacket } from "@/lib/supply-os/state-runtime/autopilot";
import {
  compileProcurementRequestState,
  compileProcurementRequestVendorPageState,
} from "@/lib/supply-os/state-runtime/compile";
import { supplyStateRuntimeConfig } from "@/lib/supply-os/state-runtime/config";
import { persistSupplyStateRead } from "@/lib/supply-os/state-runtime/persist-read";
import type { SupplyWorldStatePacket } from "@/lib/supply-os/state-runtime/types";

export type ProcurementStateReadReference = {
  id: string;
  packetHash: string;
  sourceFingerprint: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function workspaceIdFromOrder(order: ProcurementOrderDetail) {
  const source = record(record(order.requestContext).source);
  return typeof source.workspace_id === "string" && source.workspace_id.trim()
    ? source.workspace_id.trim()
    : null;
}

function runtimeFailure(message: string, error: unknown): never {
  throw new SupplyPersistenceError(
    `${message}${error instanceof Error && error.message ? ` ${error.message}` : ""}`.slice(0, 2_000),
    "conflict",
  );
}

export async function compileProcurementStateForDurableAction(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
  objective: string;
  vendorIds?: readonly string[];
}): Promise<SupplyWorldStatePacket | null> {
  const runtime = supplyStateRuntimeConfig();
  if (!runtime.enabled) return null;
  try {
    const account = await getProcurementWorkflowAccount({
      customerId: args.customerId,
      officeId: args.officeId,
    });
    if (!account) throw new Error("The workflow account is not linked to this office.");
    const workspaceId = workspaceIdFromOrder(args.order);
    if (!workspaceId) throw new Error("The procurement request is not linked to a Derya workspace.");
    const workspace = await prisma.supplyWorkspace.findFirst({
      where: { id: workspaceId, officeId: args.officeId, status: "ACTIVE" },
      select: { id: true, companyId: true },
    });
    if (!workspace || workspace.companyId !== account.companyId) {
      throw new Error("The procurement workspace is not owned by the workflow company.");
    }
    const scope = {
      type: "procurement_request" as const,
      officeId: args.officeId,
      companyId: account.companyId,
      customerId: args.customerId,
      orderId: args.order.id,
      workspaceId: workspace.id,
    };
    const vendorIds = [...new Set((args.vendorIds ?? []).map((vendorId) => vendorId.trim()).filter(Boolean))];
    return vendorIds.length
      ? await compileProcurementRequestVendorPageState({
          scope,
          vendorIds,
          objective: args.objective,
        })
      : await compileProcurementRequestState({
          scope,
          objective: args.objective,
        });
  } catch (error) {
    if (runtime.validationMode === "enforce") {
      runtimeFailure("Commercial state could not be compiled, so the durable supplier draft was not created.", error);
    }
    return null;
  }
}

export async function persistProcurementVendorDraftStateRead(args: {
  packet: SupplyWorldStatePacket | null;
  vendorId: string;
  objective: string;
}): Promise<ProcurementStateReadReference | null> {
  if (!args.packet) return null;
  const runtime = supplyStateRuntimeConfig();
  try {
    const packet = procurementVendorStatePacket({
      packet: args.packet,
      vendorId: args.vendorId,
      objective: args.objective,
      includeSavedDraftDependency: false,
    });
    const stateRead = await persistSupplyStateRead({ officeId: packet.scope.officeId, packet });
    return {
      id: stateRead.id,
      packetHash: stateRead.packetHash,
      sourceFingerprint: stateRead.sourceFingerprint,
    };
  } catch (error) {
    if (runtime.validationMode === "enforce") {
      runtimeFailure("Commercial state could not be recorded, so the durable supplier draft was not created.", error);
    }
    return null;
  }
}

export async function createProcurementVendorDraftStateRead(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
  vendorId: string;
  objective: string;
}) {
  const packet = await compileProcurementStateForDurableAction({
    officeId: args.officeId,
    customerId: args.customerId,
    order: args.order,
    objective: args.objective,
    vendorIds: [args.vendorId],
  });
  return persistProcurementVendorDraftStateRead({
    packet,
    vendorId: args.vendorId,
    objective: args.objective,
  });
}
