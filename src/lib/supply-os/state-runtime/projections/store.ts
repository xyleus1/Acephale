import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canonicalSupplyStateJson,
  hashSupplyStateDependencies,
  hashSupplyStateValue,
} from "@/lib/supply-os/state-runtime/canonicalize";
import { supplyStateRuntimeConfig } from "@/lib/supply-os/state-runtime/config";
import {
  incrementSupplyStateMetric,
  recordSupplyStateMetric,
} from "@/lib/supply-os/state-runtime/instrumentation";
import {
  supplyStateScopeRef,
  supplyStateWorkspaceId,
  type SupplyStateDependency,
  type SupplyWorldEvidenceRef,
} from "@/lib/supply-os/state-runtime/types";
import { buildSupplyStateProjection } from "./build";
import { assertSupplyStateScopeOwnership } from "@/lib/supply-os/state-runtime/readers/scope-ownership";
import { checkSupplyStateProjectionFreshness } from "./freshness";
import {
  projectionTypeForSupplyStateScope,
  SUPPLY_STATE_COMPILER_VERSION,
  type SupplyStateProjectionBuild,
  type SupplyStateProjectionPayload,
  type SupplyStateProjectionRequest,
  type SupplyStateProjectionSnapshot,
} from "./types";

type ProjectionStoreDependencies = {
  findUnique: typeof prisma.supplyStateProjection.findUnique;
  upsert: typeof prisma.supplyStateProjection.upsert;
};

const defaultStoreDependencies: ProjectionStoreDependencies = {
  findUnique: (args) => prisma.supplyStateProjection.findUnique(args),
  upsert: (args) => prisma.supplyStateProjection.upsert(args),
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asJson(value: unknown) {
  return JSON.parse(canonicalSupplyStateJson(value)) as Prisma.InputJsonValue;
}

function parsePayload(value: unknown): SupplyStateProjectionPayload | null {
  const payload = record(value);
  if (!payload || !record(payload.currentState) || !record(payload.derivedState)
    || !Array.isArray(payload.openLoops) || !Array.isArray(payload.uncertainties)) return null;
  if (payload.openLoops.some((entry) => !record(entry)) || payload.uncertainties.some((entry) => !record(entry))) return null;
  return {
    currentState: payload.currentState as Record<string, unknown>,
    derivedState: payload.derivedState as Record<string, unknown>,
    openLoops: payload.openLoops as Array<Record<string, unknown>>,
    uncertainties: payload.uncertainties as Array<Record<string, unknown>>,
  };
}

function parseEvidence(value: unknown): SupplyWorldEvidenceRef[] | null {
  if (!Array.isArray(value)) return null;
  const refs = value.filter((entry) => {
    const reference = record(entry);
    return reference && typeof reference.kind === "string" && typeof reference.id === "string";
  }) as SupplyWorldEvidenceRef[];
  return refs.length === value.length ? refs : null;
}

function parseDependencies(value: unknown): SupplyStateDependency[] | null {
  if (!Array.isArray(value)) return null;
  const dependencies = value.filter((entry) => {
    const dependency = record(entry);
    return dependency
      && typeof dependency.key === "string"
      && typeof dependency.source === "string"
      && typeof dependency.entityType === "string"
      && typeof dependency.entityRef === "string"
      && typeof dependency.version === "string"
      && typeof dependency.valueHash === "string"
      && (dependency.policy === "STRICT" || dependency.policy === "ADVISORY")
      && typeof dependency.reason === "string"
      && Array.isArray(dependency.evidenceRefs);
  }) as SupplyStateDependency[];
  return dependencies.length === value.length ? dependencies : null;
}

function sourceCountsFromDependencies(dependencies: SupplyStateDependency[]) {
  const counts: Record<string, number> = {};
  for (const dependency of dependencies) counts[dependency.source] = (counts[dependency.source] ?? 0) + 1;
  return counts;
}

export async function storeSupplyStateProjection(
  build: SupplyStateProjectionBuild,
  dependencies: Pick<ProjectionStoreDependencies, "upsert"> & {
    assertScopeOwnership?: typeof assertSupplyStateScopeOwnership;
  } = defaultStoreDependencies,
): Promise<SupplyStateProjectionSnapshot> {
  await (dependencies.assertScopeOwnership ?? assertSupplyStateScopeOwnership)(build.scope);
  if (build.projectionType !== projectionTypeForSupplyStateScope(build.scope)) {
    throw new Error("Supply state projection type does not match its scope.");
  }
  if (hashSupplyStateValue(build.payload) !== build.payloadHash) {
    throw new Error("Supply state projection payload hash does not match its payload.");
  }
  if (hashSupplyStateDependencies(build.dependencies) !== build.sourceFingerprint) {
    throw new Error("Supply state projection source fingerprint does not match its dependencies.");
  }
  const scopeRef = supplyStateScopeRef(build.scope);
  const workspaceId = supplyStateWorkspaceId(build.scope);
  const row = await dependencies.upsert({
    where: {
      officeId_projectionType_scopeType_scopeRef_compilerVersion: {
        officeId: build.scope.officeId,
        projectionType: build.projectionType,
        scopeType: build.scope.type,
        scopeRef,
        compilerVersion: build.compilerVersion,
      },
    },
    create: {
      officeId: build.scope.officeId,
      workspaceId,
      scopeType: build.scope.type,
      scopeRef,
      projectionType: build.projectionType,
      compilerVersion: build.compilerVersion,
      sourceFingerprint: build.sourceFingerprint,
      payload: asJson(build.payload),
      payloadHash: build.payloadHash,
      evidenceRefs: asJson(build.evidenceRefs),
      dependencyManifest: asJson(build.dependencies),
      builtAt: new Date(build.builtAt),
      dirtyAt: null,
    },
    update: {
      workspaceId,
      sourceFingerprint: build.sourceFingerprint,
      payload: asJson(build.payload),
      payloadHash: build.payloadHash,
      evidenceRefs: asJson(build.evidenceRefs),
      dependencyManifest: asJson(build.dependencies),
      builtAt: new Date(build.builtAt),
      dirtyAt: null,
    },
    select: { id: true, builtAt: true },
  });
  incrementSupplyStateMetric("projection_rebuild_count", {
    officeId: build.scope.officeId,
    workspaceId,
    scopeType: build.scope.type,
    projectionType: build.projectionType,
    compilerVersion: build.compilerVersion,
  });
  return {
    id: row.id,
    scope: build.scope,
    projectionType: build.projectionType,
    compilerVersion: build.compilerVersion,
    sourceFingerprint: build.sourceFingerprint,
    payload: build.payload,
    payloadHash: build.payloadHash,
    evidenceRefs: build.evidenceRefs,
    dependencies: build.dependencies,
    builtAt: row.builtAt.toISOString(),
    dirtyAt: null,
    projectionHit: false,
    sourceCounts: build.sourceCounts,
    timingsMs: build.timingsMs,
  };
}

async function loadStoredProjection(
  request: SupplyStateProjectionRequest,
  dependencies: Pick<ProjectionStoreDependencies, "findUnique">,
) {
  const compilerVersion = request.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  const projectionType = projectionTypeForSupplyStateScope(request.scope);
  const scopeRef = supplyStateScopeRef(request.scope);
  const row = await dependencies.findUnique({
    where: {
      officeId_projectionType_scopeType_scopeRef_compilerVersion: {
        officeId: request.scope.officeId,
        projectionType,
        scopeType: request.scope.type,
        scopeRef,
        compilerVersion,
      },
    },
  });
  if (!row || row.officeId !== request.scope.officeId || row.scopeRef !== scopeRef
    || row.scopeType !== request.scope.type || row.projectionType !== projectionType
    || row.compilerVersion !== compilerVersion || row.dirtyAt) return null;
  const payload = parsePayload(row.payload);
  const evidenceRefs = parseEvidence(row.evidenceRefs);
  const dependenciesManifest = parseDependencies(row.dependencyManifest);
  if (!payload || !evidenceRefs || !dependenciesManifest) return null;
  if (hashSupplyStateValue(payload) !== row.payloadHash
    || hashSupplyStateDependencies(dependenciesManifest) !== row.sourceFingerprint) return null;
  return {
    id: row.id,
    scope: request.scope,
    projectionType,
    compilerVersion,
    sourceFingerprint: row.sourceFingerprint,
    payload,
    payloadHash: row.payloadHash,
    evidenceRefs,
    dependencies: dependenciesManifest,
    builtAt: row.builtAt.toISOString(),
    dirtyAt: null,
    projectionHit: true,
    sourceCounts: sourceCountsFromDependencies(dependenciesManifest),
    timingsMs: {},
  } satisfies SupplyStateProjectionSnapshot;
}

export type GetFreshStateProjectionDependencies = ProjectionStoreDependencies & {
  build: typeof buildSupplyStateProjection;
  checkFreshness: typeof checkSupplyStateProjectionFreshness;
  assertScopeOwnership: typeof assertSupplyStateScopeOwnership;
};

const defaultFreshDependencies: GetFreshStateProjectionDependencies = {
  ...defaultStoreDependencies,
  build: buildSupplyStateProjection,
  checkFreshness: checkSupplyStateProjectionFreshness,
  assertScopeOwnership: assertSupplyStateScopeOwnership,
};

export async function getFreshStateProjection(
  request: SupplyStateProjectionRequest & { projectionsEnabled?: boolean },
  dependencies: GetFreshStateProjectionDependencies = defaultFreshDependencies,
): Promise<SupplyStateProjectionSnapshot> {
  if (request.access?.accessKind === "customer"
    || (request.access && (request.access as unknown as { actorType?: string }).actorType === "CUSTOMER")) {
    throw new Error("The Commercial State Runtime V1 is available only to internal operators.");
  }
  await (dependencies.assertScopeOwnership ?? assertSupplyStateScopeOwnership)(request.scope);
  const config = supplyStateRuntimeConfig();
  const projectionsEnabled = request.projectionsEnabled ?? config.projectionsEnabled;
  const compilerVersion = request.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  const labels = {
    officeId: request.scope.officeId,
    workspaceId: supplyStateWorkspaceId(request.scope),
    scopeType: request.scope.type,
    projectionType: projectionTypeForSupplyStateScope(request.scope),
    compilerVersion,
  } as const;
  if (projectionsEnabled) {
    const lookupStartedAt = performance.now();
    let stored: SupplyStateProjectionSnapshot | null = null;
    try {
      stored = await loadStoredProjection({ ...request, compilerVersion }, dependencies);
    } catch {
      stored = null;
    }
    const lookupMs = Math.max(0, performance.now() - lookupStartedAt);
    if (stored) {
      const freshnessStartedAt = performance.now();
      let fresh = false;
      try {
        fresh = (await dependencies.checkFreshness({
          officeId: request.scope.officeId,
          expectedSourceFingerprint: stored.sourceFingerprint,
          dependencies: stored.dependencies,
        })).fresh;
      } catch {
        fresh = false;
      }
      const freshnessMs = Math.max(0, performance.now() - freshnessStartedAt);
      if (fresh) {
        incrementSupplyStateMetric("projection_hit", labels);
        return {
          ...stored,
          timingsMs: { projectionLookup: lookupMs, projectionFreshness: freshnessMs },
        };
      }
    }
  }

  if (projectionsEnabled) recordSupplyStateMetric("projection_hit", 0, labels);
  const buildStartedAt = performance.now();
  const build = await dependencies.build({ ...request, compilerVersion });
  const projectionBuildMs = Math.max(0, performance.now() - buildStartedAt);
  const live: SupplyStateProjectionSnapshot = {
    id: null,
    scope: build.scope,
    projectionType: build.projectionType,
    compilerVersion: build.compilerVersion,
    sourceFingerprint: build.sourceFingerprint,
    payload: build.payload,
    payloadHash: build.payloadHash,
    evidenceRefs: build.evidenceRefs,
    dependencies: build.dependencies,
    builtAt: build.builtAt,
    dirtyAt: null,
    projectionHit: false,
    sourceCounts: build.sourceCounts,
    timingsMs: { ...build.timingsMs, projectionBuild: projectionBuildMs },
  };
  if (!projectionsEnabled || build.hadReaderFailure) return live;
  const persistStartedAt = performance.now();
  try {
    const stored = await storeSupplyStateProjection(build, dependencies);
    return {
      ...stored,
      timingsMs: {
        ...stored.timingsMs,
        projectionBuild: projectionBuildMs,
        projectionPersist: Math.max(0, performance.now() - persistStartedAt),
      },
    };
  } catch {
    // Projection persistence is a cache write. Live compilation remains usable.
    return {
      ...live,
      timingsMs: {
        ...live.timingsMs,
        projectionPersist: Math.max(0, performance.now() - persistStartedAt),
      },
    };
  }
}
