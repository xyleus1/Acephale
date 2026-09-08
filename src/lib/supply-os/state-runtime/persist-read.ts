import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canonicalSupplyStateJson,
  hashSupplyStateDependencies,
  hashSupplyWorldStatePacket,
  MAX_SUPPLY_STATE_PACKET_BYTES,
  supplyStateHashesEqual,
} from "./canonicalize";
import {
  recordSupplyStateMetric,
} from "./instrumentation";
import {
  resolveSupplyStateDependencyPolicy,
  supplyStateFactRegistry,
  SupplyStateFactRegistryError,
  type SupplyStateFactRegistry,
} from "./fact-registry";
import {
  assertSupplyStateScopeOwnership,
  SupplyStateScopeOwnershipError,
} from "./readers/scope-ownership";
import {
  supplyStateScopeRef,
  supplyStateWorkspaceId,
  type SupplyStateDependency,
  type SupplyWorldEvidenceRef,
  type SupplyWorldStatePacket,
} from "./types";

const MAX_DEPENDENCIES = 320;
const MAX_EVIDENCE_REFS = 240;
const SOURCES = new Set(["APP_DB", "WORKFLOW_DB", "EMAIL_LEDGER", "COMPANY_BRAIN"]);
const POLICIES = new Set(["STRICT", "ADVISORY"]);
const EVIDENCE_KINDS = new Set([
  "company_context",
  "supply_snapshot",
  "supply_evidence",
  "supply_profile_fact",
  "supply_price_observation",
  "planning_result",
  "supply_decision",
  "execution_task",
  "execution_event",
  "procurement_order",
  "procurement_vendor",
  "procurement_message",
  "email_message",
  "knowledge_object",
  "knowledge_chunk",
  "memory_event",
]);

type SupplyStateReadDatabase = Pick<typeof prisma, "supplyStateRead">;

export class SupplyStateReadPersistenceError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_input" | "conflict" | "unavailable",
  ) {
    super(message);
    this.name = "SupplyStateReadPersistenceError";
  }
}

function assertText(value: string, label: string, max: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\0]/.test(normalized)) {
    throw new SupplyStateReadPersistenceError(`${label} is invalid.`, "invalid_input");
  }
  return normalized;
}

function assertEvidenceRef(reference: SupplyWorldEvidenceRef) {
  if (!reference || typeof reference !== "object" || !EVIDENCE_KINDS.has(reference.kind)) {
    throw new SupplyStateReadPersistenceError("Supply state evidence kind is invalid.", "invalid_input");
  }
  assertText(reference.id, "Supply state evidence reference", 1_000);
}

function assertDependency(dependency: SupplyStateDependency) {
  if (!dependency || typeof dependency !== "object"
    || !SOURCES.has(dependency.source)
    || !POLICIES.has(dependency.policy)
    || !Array.isArray(dependency.evidenceRefs)) {
    throw new SupplyStateReadPersistenceError("Supply state dependency is invalid.", "invalid_input");
  }
  assertText(dependency.key, "Supply state dependency key", 2_000);
  assertText(dependency.entityType, "Supply state dependency entity type", 200);
  assertText(dependency.entityRef, "Supply state dependency entity reference", 1_000);
  assertText(dependency.version, "Supply state dependency version", 1_000);
  if (!/^[0-9a-f]{64}$/.test(dependency.valueHash)) {
    throw new SupplyStateReadPersistenceError("Supply state dependency hash is invalid.", "invalid_input");
  }
  assertText(dependency.reason, "Supply state dependency reason", 1_000);
  if (dependency.evidenceRefs.length > MAX_EVIDENCE_REFS) {
    throw new SupplyStateReadPersistenceError("Supply state dependency evidence is too large.", "invalid_input");
  }
  dependency.evidenceRefs.forEach(assertEvidenceRef);
}

function assertDependencyPolicy(
  dependency: SupplyStateDependency,
  registry: SupplyStateFactRegistry,
) {
  let resolvedPolicy: SupplyStateDependency["policy"];
  try {
    resolvedPolicy = resolveSupplyStateDependencyPolicy({
      registry,
      key: dependency.key,
      requestedPolicy: dependency.policy,
    });
  } catch (error) {
    if (error instanceof SupplyStateFactRegistryError) {
      throw new SupplyStateReadPersistenceError(
        `Supply state dependency ${dependency.key} is not registered.`,
        "invalid_input",
      );
    }
    throw error;
  }
  if (resolvedPolicy !== dependency.policy) {
    throw new SupplyStateReadPersistenceError(
      `Supply state dependency ${dependency.key} weakens its registry policy.`,
      "conflict",
    );
  }
}

function assertPacket(input: {
  officeId: string;
  workspaceId?: string | null;
  packet: SupplyWorldStatePacket;
}, registry: SupplyStateFactRegistry) {
  const officeId = assertText(input.officeId, "Office ID", 512);
  const packet = input.packet;
  if (packet.schemaVersion !== 1 || packet.scope.officeId !== officeId) {
    throw new SupplyStateReadPersistenceError("Supply state packet does not match the requested office.", "invalid_input");
  }
  assertText(packet.compilerVersion, "Supply state compiler version", 120);
  assertText(packet.objective, "Supply state objective", 4_000);
  const compiledAt = new Date(packet.compiledAt);
  if (Number.isNaN(compiledAt.valueOf()) || compiledAt.toISOString() !== packet.compiledAt) {
    throw new SupplyStateReadPersistenceError("Supply state compilation timestamp is invalid.", "invalid_input");
  }
  if (packet.dependencies.length > MAX_DEPENDENCIES || packet.evidenceRefs.length > MAX_EVIDENCE_REFS) {
    throw new SupplyStateReadPersistenceError("Supply state packet exceeds its evidence bounds.", "invalid_input");
  }
  const requiredReaderFailure = packet.uncertainties.some((entry) => (
    entry && typeof entry === "object" && !Array.isArray(entry)
      && (entry as Record<string, unknown>).kind === "source_reader_failed"
  )) || packet.diagnostics.sourceCounts.requiredSourceReaderFailures > 0;
  if (requiredReaderFailure || packet.dependencies.length === 0) {
    throw new SupplyStateReadPersistenceError(
      "Incomplete commercial state cannot be persisted for durable work.",
      "unavailable",
    );
  }
  const keys = new Set<string>();
  for (const dependency of packet.dependencies) {
    assertDependency(dependency);
    assertDependencyPolicy(dependency, registry);
    if (keys.has(dependency.key)) {
      throw new SupplyStateReadPersistenceError("Supply state dependency keys must be unique.", "invalid_input");
    }
    keys.add(dependency.key);
  }
  packet.evidenceRefs.forEach(assertEvidenceRef);
  const sourceFingerprint = hashSupplyStateDependencies(packet.dependencies);
  if (!supplyStateHashesEqual(sourceFingerprint, packet.sourceFingerprint)) {
    throw new SupplyStateReadPersistenceError("Supply state source fingerprint does not match its dependencies.", "conflict");
  }
  const packetHash = hashSupplyWorldStatePacket(packet);
  if (!supplyStateHashesEqual(packetHash, packet.packetHash)) {
    throw new SupplyStateReadPersistenceError("Supply state packet hash does not match its contents.", "conflict");
  }
  const scopedWorkspaceId = supplyStateWorkspaceId(packet.scope);
  const requestedWorkspaceId = input.workspaceId?.trim() || null;
  if (requestedWorkspaceId && requestedWorkspaceId !== scopedWorkspaceId) {
    throw new SupplyStateReadPersistenceError("Supply state packet does not match the requested workspace.", "invalid_input");
  }
  return {
    officeId,
    workspaceId: requestedWorkspaceId || scopedWorkspaceId,
    scopeRef: supplyStateScopeRef(packet.scope),
  };
}

export async function persistSupplyStateRead(
  input: {
    officeId: string;
    workspaceId?: string | null;
    packet: SupplyWorldStatePacket;
  },
  dependencies: {
    database?: SupplyStateReadDatabase;
    assertScopeOwnership?: typeof assertSupplyStateScopeOwnership;
    registry?: SupplyStateFactRegistry;
  } = {},
) {
  const database = dependencies.database ?? prisma;
  const identity = assertPacket(input, dependencies.registry ?? supplyStateFactRegistry);
  try {
    await (dependencies.assertScopeOwnership ?? assertSupplyStateScopeOwnership)(input.packet.scope);
  } catch (error) {
    if (error instanceof SupplyStateScopeOwnershipError) {
      throw new SupplyStateReadPersistenceError(
        "Supply state packet scope does not belong to the requested tenant.",
        "conflict",
      );
    }
    throw error;
  }
  let packetJson: string;
  try {
    packetJson = canonicalSupplyStateJson(input.packet, MAX_SUPPLY_STATE_PACKET_BYTES);
  } catch {
    throw new SupplyStateReadPersistenceError("Supply state packet exceeds its serialization bounds.", "invalid_input");
  }
  const storedPacket = JSON.parse(packetJson) as SupplyWorldStatePacket;
  try {
    const stateRead = await database.supplyStateRead.create({
      data: {
        officeId: identity.officeId,
        workspaceId: identity.workspaceId,
        scopeType: storedPacket.scope.type,
        scopeRef: identity.scopeRef,
        objective: storedPacket.objective,
        compilerVersion: storedPacket.compilerVersion,
        sourceFingerprint: storedPacket.sourceFingerprint,
        packet: storedPacket as unknown as Prisma.InputJsonValue,
        packetHash: storedPacket.packetHash,
        evidenceRefs: storedPacket.evidenceRefs as unknown as Prisma.InputJsonValue,
        dependencyManifest: storedPacket.dependencies as unknown as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        officeId: true,
        workspaceId: true,
        scopeType: true,
        scopeRef: true,
        objective: true,
        compilerVersion: true,
        sourceFingerprint: true,
        packetHash: true,
        createdAt: true,
      },
    });
    recordSupplyStateMetric("packet_bytes", Buffer.byteLength(packetJson, "utf8"), {
      officeId: identity.officeId,
      workspaceId: identity.workspaceId,
      scopeType: storedPacket.scope.type,
      compilerVersion: storedPacket.compilerVersion,
    });
    recordSupplyStateMetric("dependency_count", storedPacket.dependencies.length, {
      officeId: identity.officeId,
      workspaceId: identity.workspaceId,
      scopeType: storedPacket.scope.type,
      compilerVersion: storedPacket.compilerVersion,
    });
    return stateRead;
  } catch (error) {
    if (error instanceof SupplyStateReadPersistenceError) throw error;
    throw new SupplyStateReadPersistenceError("Supply state read could not be persisted.", "unavailable");
  }
}
