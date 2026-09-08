import "server-only";

import { prisma } from "@/lib/prisma";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
  hashSupplyWorldStatePacket,
} from "./canonicalize";
import {
  readCurrentSupplyStateFact,
  resolveSupplyStateDependencyPolicy,
  supplyStateFactRegistry,
  SupplyStateFactRegistry,
  SupplyStateFactRegistryError,
} from "./fact-registry";
import { recordSupplyStateMetric } from "./instrumentation";
import {
  assertSupplyStateScopeOwnership,
  SupplyStateScopeOwnershipError,
} from "./readers/scope-ownership";
import type {
  SupplyStateDependency,
  SupplyStateDependencyChange,
  SupplyStateSource,
  SupplyStateValidationResult,
  SupplyWorldStatePacket,
  SupplyWorldEvidenceRef,
} from "./types";
import { supplyStateScopeRef, supplyStateWorkspaceId } from "./types";

const MAX_DEPENDENCIES = 320;
const VALIDATION_CONCURRENCY = 8;
const SOURCES = new Set<SupplyStateSource>([
  "APP_DB",
  "WORKFLOW_DB",
  "EMAIL_LEDGER",
  "COMPANY_BRAIN",
]);
const POLICIES = new Set(["STRICT", "ADVISORY"]);

type SupplyStateValidationDatabase = Pick<typeof prisma, "supplyStateRead">;

export class SupplyStateValidationError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid_manifest" | "unavailable",
  ) {
    super(message);
    this.name = "SupplyStateValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evidenceRefs(value: unknown): SupplyWorldEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((reference) => (
    isRecord(reference) && typeof reference.kind === "string" && typeof reference.id === "string"
      ? [reference as unknown as SupplyWorldEvidenceRef]
      : []
  )).slice(0, 240);
}

function parseDependency(value: unknown, index: number): SupplyStateDependency {
  if (!isRecord(value)
    || typeof value.key !== "string"
    || typeof value.source !== "string"
    || !SOURCES.has(value.source as SupplyStateSource)
    || typeof value.entityType !== "string"
    || typeof value.entityRef !== "string"
    || typeof value.version !== "string"
    || typeof value.valueHash !== "string"
    || !/^[0-9a-f]{64}$/.test(value.valueHash)
    || !POLICIES.has(value.policy as string)
    || typeof value.reason !== "string"
    || !Array.isArray(value.evidenceRefs)
    || value.key.length < 1
    || value.key.length > 2_000
    || value.entityType.length < 1
    || value.entityType.length > 200
    || value.entityRef.length < 1
    || value.entityRef.length > 1_000
    || value.version.length < 1
    || value.version.length > 1_000
    || value.reason.length < 1
    || value.reason.length > 1_000
    || value.evidenceRefs.length > 240) {
    throw new SupplyStateValidationError(
      `Supply state dependency ${index + 1} is invalid.`,
      "invalid_manifest",
    );
  }
  return {
    key: value.key,
    source: value.source as SupplyStateSource,
    entityType: value.entityType,
    entityRef: value.entityRef,
    version: value.version,
    valueHash: value.valueHash,
    policy: value.policy as SupplyStateDependency["policy"],
    reason: value.reason,
    evidenceRefs: evidenceRefs(value.evidenceRefs),
  };
}

function parseManifest(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES) {
    throw new SupplyStateValidationError("Supply state dependency manifest is invalid.", "invalid_manifest");
  }
  const dependencies = value.map(parseDependency);
  if (new Set(dependencies.map((dependency) => dependency.key)).size !== dependencies.length) {
    throw new SupplyStateValidationError("Supply state dependency keys are not unique.", "invalid_manifest");
  }
  return dependencies;
}

function assertManifestPolicies(
  dependencies: SupplyStateDependency[],
  registry: SupplyStateFactRegistry,
) {
  for (const dependency of dependencies) {
    let resolvedPolicy: SupplyStateDependency["policy"];
    try {
      resolvedPolicy = resolveSupplyStateDependencyPolicy({
        registry,
        key: dependency.key,
        requestedPolicy: dependency.policy,
      });
    } catch (error) {
      if (error instanceof SupplyStateFactRegistryError) {
        throw new SupplyStateValidationError(
          `Supply state dependency ${dependency.key} is not registered.`,
          "invalid_manifest",
        );
      }
      throw error;
    }
    if (resolvedPolicy !== dependency.policy) {
      throw new SupplyStateValidationError(
        `Supply state dependency ${dependency.key} weakens its registry policy.`,
        "invalid_manifest",
      );
    }
  }
}

function assertStateReadIntegrity(stateRead: {
  officeId: string;
  workspaceId: string | null;
  scopeType: string;
  scopeRef: string;
  objective: string;
  compilerVersion: string;
  sourceFingerprint: string;
  packet: unknown;
  packetHash: string;
  evidenceRefs: unknown;
  dependencyManifest: unknown;
}) {
  const packetValue = stateRead.packet;
  if (!isRecord(packetValue) || !isRecord(packetValue.scope)
    || packetValue.schemaVersion !== 1
    || typeof packetValue.compilerVersion !== "string"
    || typeof packetValue.objective !== "string"
    || typeof packetValue.sourceFingerprint !== "string"
    || typeof packetValue.packetHash !== "string"
    || !Array.isArray(packetValue.dependencies)
    || !Array.isArray(packetValue.evidenceRefs)) {
    throw new SupplyStateValidationError("Supply state read packet is invalid.", "invalid_manifest");
  }
  const packet = packetValue as unknown as SupplyWorldStatePacket;
  let packetScopeRef: string;
  let packetWorkspaceId: string | null;
  let computedPacketHash: string;
  try {
    packetScopeRef = supplyStateScopeRef(packet.scope);
    packetWorkspaceId = supplyStateWorkspaceId(packet.scope);
    computedPacketHash = hashSupplyWorldStatePacket(packet);
  } catch {
    throw new SupplyStateValidationError("Supply state read packet scope is invalid.", "invalid_manifest");
  }
  const packetManifest = parseManifest(packet.dependencies);
  const storedManifest = parseManifest(stateRead.dependencyManifest);
  const integrityMatches = packet.scope.officeId === stateRead.officeId
    && packet.scope.type === stateRead.scopeType
    && packetScopeRef === stateRead.scopeRef
    && packetWorkspaceId === stateRead.workspaceId
    && packet.objective === stateRead.objective
    && packet.compilerVersion === stateRead.compilerVersion
    && packet.sourceFingerprint === stateRead.sourceFingerprint
    && packet.packetHash === stateRead.packetHash
    && computedPacketHash === stateRead.packetHash
    && hashSupplyStateDependencies(packetManifest) === stateRead.sourceFingerprint
    && hashSupplyStateValue(packet.dependencies) === hashSupplyStateValue(stateRead.dependencyManifest)
    && hashSupplyStateValue(packet.evidenceRefs) === hashSupplyStateValue(stateRead.evidenceRefs)
    && hashSupplyStateValue(packetManifest) === hashSupplyStateValue(storedManifest);
  if (!integrityMatches) {
    throw new SupplyStateValidationError(
      "Supply state read packet and immutable manifest do not match.",
      "invalid_manifest",
    );
  }
  return { manifest: storedManifest, packet };
}

async function mapConcurrent<T, U>(values: T[], worker: (value: T) => Promise<U>) {
  const output = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(VALIDATION_CONCURRENCY, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index]!);
    }
  }));
  return output;
}

function changed(
  dependency: SupplyStateDependency,
  current: { version: string; hash: string },
): SupplyStateDependencyChange {
  return {
    key: dependency.key,
    oldVersion: dependency.version,
    newVersion: current.version,
    oldHash: dependency.valueHash,
    newHash: current.hash,
    reason: dependency.reason,
  };
}

async function validateDependency(
  dependency: SupplyStateDependency,
  args: {
    officeId: string;
    registry: SupplyStateFactRegistry;
    cache: Map<string, Promise<unknown>>;
  },
) {
  try {
    const current = await readCurrentSupplyStateFact({
      registry: args.registry,
      key: dependency.key,
      context: { officeId: args.officeId, cache: args.cache },
    });
    if (!current.exists) {
      return changed(dependency, {
        version: "MISSING",
        hash: hashSupplyStateValue({ missing: dependency.key }),
      });
    }
    if (current.source !== dependency.source) {
      return changed(dependency, {
        version: "SOURCE_MISMATCH",
        hash: hashSupplyStateValue({ source: current.source, valueHash: current.valueHash }),
      });
    }
    const identityChanged = current.entityType !== dependency.entityType
      || current.entityRef !== dependency.entityRef;
    if (identityChanged
      || current.resolvedVersion !== dependency.version
      || current.valueHash !== dependency.valueHash) {
      return changed(dependency, {
        version: current.resolvedVersion,
        hash: current.valueHash,
      });
    }
    return null;
  } catch {
    return changed(dependency, {
      version: "UNAVAILABLE",
      hash: hashSupplyStateValue({ unavailable: dependency.key }),
    });
  }
}

export async function validateSupplyStateRead(
  input: {
    officeId: string;
    stateReadId: string;
    validationMode?: "off" | "shadow" | "enforce";
  },
  dependencies: {
    database?: SupplyStateValidationDatabase;
    registry?: SupplyStateFactRegistry;
    assertScopeOwnership?: typeof assertSupplyStateScopeOwnership;
    now?: () => Date;
  } = {},
): Promise<SupplyStateValidationResult> {
  const startedAt = performance.now();
  const database = dependencies.database ?? prisma;
  const registry = dependencies.registry ?? supplyStateFactRegistry;
  const officeId = input.officeId.trim();
  const stateReadId = input.stateReadId.trim();
  if (!officeId || !stateReadId) {
    throw new SupplyStateValidationError("Supply state read identity is required.", "not_found");
  }
  const stateRead = await database.supplyStateRead.findFirst({
    where: { id: stateReadId, officeId },
    select: {
      officeId: true,
      dependencyManifest: true,
      evidenceRefs: true,
      packet: true,
      workspaceId: true,
      scopeType: true,
      scopeRef: true,
      objective: true,
      compilerVersion: true,
      sourceFingerprint: true,
      packetHash: true,
    },
  });
  if (!stateRead) throw new SupplyStateValidationError("Supply state read was not found.", "not_found");
  const { manifest, packet } = assertStateReadIntegrity(stateRead);
  assertManifestPolicies(manifest, registry);
  let ownershipChange: SupplyStateDependencyChange | null = null;
  try {
    await (dependencies.assertScopeOwnership ?? assertSupplyStateScopeOwnership)(packet.scope);
  } catch (error) {
    const mismatch = error instanceof SupplyStateScopeOwnershipError;
    const scopeRef = supplyStateScopeRef(packet.scope);
    ownershipChange = {
      key: `scope.ownership:${scopeRef}`,
      oldVersion: "OWNED",
      newVersion: mismatch ? "MISMATCH" : "UNAVAILABLE",
      oldHash: hashSupplyStateValue({ scope: packet.scope, owned: true }),
      newHash: hashSupplyStateValue({ scopeRef, owned: false, unavailable: !mismatch }),
      reason: "The durable action scope must retain its exact office, company, workspace, and workflow ownership.",
    };
  }
  const cache = new Map<string, Promise<unknown>>();
  const results = await mapConcurrent(manifest, (dependency) => validateDependency(dependency, {
    officeId,
    registry,
    cache,
  }));
  const changedStrict: SupplyStateDependencyChange[] = ownershipChange ? [ownershipChange] : [];
  const changedAdvisory: SupplyStateDependencyChange[] = [];
  for (let index = 0; index < manifest.length; index += 1) {
    const change = results[index];
    if (!change) continue;
    if (manifest[index]!.policy === "STRICT") changedStrict.push(change);
    else changedAdvisory.push(change);
  }
  const labels = {
    officeId,
    workspaceId: stateRead.workspaceId,
    scopeType: stateRead.scopeType,
    compilerVersion: stateRead.compilerVersion,
    validationMode: input.validationMode,
  };
  recordSupplyStateMetric("validation_ms", Math.max(0, performance.now() - startedAt), labels);
  recordSupplyStateMetric("strict_conflict_count", changedStrict.length, labels);
  recordSupplyStateMetric("advisory_change_count", changedAdvisory.length, labels);
  return {
    valid: changedStrict.length === 0,
    checkedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    changedStrict,
    changedAdvisory,
  };
}
