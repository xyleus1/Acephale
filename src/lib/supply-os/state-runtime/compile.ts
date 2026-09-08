import "server-only";

import type { SupplyAccessContext } from "@/lib/supply-os/persistence";
import {
  canonicalSupplyStateJson,
  hashSupplyStateDependencies,
  hashSupplyWorldStatePacket,
  MAX_SUPPLY_STATE_PACKET_BYTES,
} from "@/lib/supply-os/state-runtime/canonicalize";
import {
  recordSupplyStateMetric,
} from "@/lib/supply-os/state-runtime/instrumentation";
import { readCompanyBrainState } from "@/lib/supply-os/state-runtime/readers/company-brain";
import { readProcurementOrderState } from "@/lib/supply-os/state-runtime/readers/procurement-order";
import {
  boundSupplyStateValue,
  dedupeSupplyWorldEvidence,
  emptySupplyStateReaderResult,
  readerFailure,
  resolveRegisteredSupplyStateDependencies,
  SUPPLY_STATE_MAX_DEPENDENCIES,
  type SupplyStateReaderResult,
} from "@/lib/supply-os/state-runtime/readers/types";
import {
  getFreshStateProjection,
} from "@/lib/supply-os/state-runtime/projections/store";
import { buildSupplyStateProjection } from "@/lib/supply-os/state-runtime/projections/build";
import {
  SUPPLY_STATE_COMPILER_VERSION,
  type SupplyStateProjectionSnapshot,
} from "@/lib/supply-os/state-runtime/projections/types";
import type { SupplyStateFactRegistry } from "@/lib/supply-os/state-runtime/fact-registry";
import {
  SUPPLY_STATE_SCHEMA_VERSION,
  supplyStateScopeRef,
  supplyStateWorkspaceId,
  type SupplyStateDependency,
  type SupplyStateScope,
  type SupplyWorldEvidenceRef,
  type SupplyWorldStatePacket,
} from "@/lib/supply-os/state-runtime/types";

export type SupplyStateQueryEvidence = {
  results?: Array<Record<string, unknown>>;
  derivedState?: Record<string, unknown>;
  openLoops?: Array<Record<string, unknown>>;
  uncertainties?: Array<Record<string, unknown>>;
  evidenceRefs?: SupplyWorldEvidenceRef[];
  dependencies?: SupplyStateDependency[];
  sourceCounts?: Record<string, number>;
  timingsMs?: Record<string, number>;
};

export type CompileSupplyWorldStateInput = {
  scope: SupplyStateScope;
  objective: string;
  projection: SupplyStateProjectionSnapshot;
  queryEvidence?: SupplyStateQueryEvidence | null;
  compiledAt?: Date | string;
};

export type CompileSupplyWorldStateLiveInput = {
  scope: SupplyStateScope;
  objective: string;
  access?: SupplyAccessContext | null;
  queryEvidence?: SupplyStateQueryEvidence | null;
  retrieveEvidence?: boolean;
  useProjections?: boolean;
  compiledAt?: Date | string;
  compilerVersion?: string;
};

function cleanObjective(value: string) {
  const objective = value.replace(/[\r\n\0]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 2_000);
  if (!objective) throw new Error("Supply state compilation requires an objective.");
  return objective;
}

function compiledAtIso(value: Date | string | undefined) {
  const parsed = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.valueOf())) throw new Error("Supply state compilation time is invalid.");
  return parsed.toISOString();
}

function mergeCounts(...counts: Array<Record<string, number> | undefined>) {
  const output: Record<string, number> = {};
  for (const entries of counts) {
    for (const [key, value] of Object.entries(entries ?? {})) {
      if (!Number.isFinite(value) || value < 0) continue;
      output[key] = (output[key] ?? 0) + value;
    }
  }
  return output;
}

export function mergeSupplyStateDependencies(
  projection: SupplyStateDependency[],
  evidence: SupplyStateDependency[] = [],
) {
  const merged = new Map<string, SupplyStateDependency>();
  for (const dependency of [...projection, ...evidence]) {
    const existing = merged.get(dependency.key);
    if (!existing) {
      merged.set(dependency.key, dependency);
      continue;
    }
    if (existing.source !== dependency.source
      || existing.entityType !== dependency.entityType
      || existing.entityRef !== dependency.entityRef
      || existing.version !== dependency.version
      || existing.valueHash !== dependency.valueHash) {
      throw new Error(`Supply state dependency ${dependency.key} has conflicting declarations.`);
    }
    const dependencyIsStricter = existing.policy !== "STRICT" && dependency.policy === "STRICT";
    merged.set(dependency.key, {
      ...existing,
      policy: existing.policy === "STRICT" || dependency.policy === "STRICT" ? "STRICT" : "ADVISORY",
      reason: dependencyIsStricter ? dependency.reason : existing.reason,
      evidenceRefs: dedupeSupplyWorldEvidence([
        ...existing.evidenceRefs,
        ...dependency.evidenceRefs,
      ]),
    });
  }
  const dependencies = [...merged.values()].sort((left, right) => left.key.localeCompare(right.key));
  if (dependencies.length > SUPPLY_STATE_MAX_DEPENDENCIES) {
    throw new Error(`Supply state dependency manifest exceeds ${SUPPLY_STATE_MAX_DEPENDENCIES} facts.`);
  }
  return dependencies;
}

function queryResults(queryEvidence: SupplyStateQueryEvidence | null | undefined) {
  return (queryEvidence?.results ?? []).slice(0, 12).map((result) => (
    boundSupplyStateValue(result, { maxArray: 20, maxKeys: 50, maxString: 1_200 }) as Record<string, unknown>
  ));
}

function packetWithoutHash(args: {
  input: CompileSupplyWorldStateInput;
  objective: string;
  compiledAt: string;
  currentState: Record<string, unknown>;
  derivedState: Record<string, unknown>;
  openLoops: Array<Record<string, unknown>>;
  uncertainties: Array<Record<string, unknown>>;
  evidenceRefs: SupplyWorldEvidenceRef[];
  dependencies: SupplyStateDependency[];
  sourceCounts: Record<string, number>;
  timingsMs: Record<string, number>;
}): SupplyWorldStatePacket {
  return {
    schemaVersion: SUPPLY_STATE_SCHEMA_VERSION,
    compilerVersion: args.input.projection.compilerVersion,
    scope: args.input.scope,
    objective: args.objective,
    compiledAt: args.compiledAt,
    currentState: args.currentState,
    derivedState: args.derivedState,
    openLoops: args.openLoops,
    uncertainties: args.uncertainties,
    evidenceRefs: args.evidenceRefs,
    dependencies: args.dependencies,
    sourceFingerprint: hashSupplyStateDependencies(args.dependencies),
    packetHash: "",
    diagnostics: {
      projectionHit: args.input.projection.projectionHit,
      sourceCounts: args.sourceCounts,
      timingsMs: args.timingsMs,
    },
  };
}

function* packetCompactionCandidates(input: SupplyWorldStatePacket): Generator<SupplyWorldStatePacket> {
  yield input;
  for (const limits of [
    { maxArray: 40, maxString: 2_000 },
    { maxArray: 20, maxString: 1_000 },
    { maxArray: 10, maxString: 500 },
  ]) {
    yield {
      ...input,
      currentState: boundSupplyStateValue(input.currentState, limits) as Record<string, unknown>,
      derivedState: boundSupplyStateValue(input.derivedState, limits) as Record<string, unknown>,
      openLoops: (boundSupplyStateValue(input.openLoops, limits) as Array<Record<string, unknown>>),
      uncertainties: [
        ...(boundSupplyStateValue(input.uncertainties, limits) as Array<Record<string, unknown>>),
        { kind: "state_packet_compacted", byteLimit: MAX_SUPPLY_STATE_PACKET_BYTES },
      ].slice(0, limits.maxArray),
    };
  }
}

function fitPacket(input: SupplyWorldStatePacket) {
  // Most packets fit unchanged. Build a smaller representation only after the
  // preceding one exceeds the byte budget, and retain just one candidate.
  for (const candidate of packetCompactionCandidates(input)) {
    const packet = { ...candidate, packetHash: hashSupplyWorldStatePacket(candidate) };
    try {
      canonicalSupplyStateJson(packet, MAX_SUPPLY_STATE_PACKET_BYTES);
      return packet;
    } catch {
      // Try the next deterministic compaction tier.
    }
  }
  throw new Error(`Supply state packet exceeds the ${MAX_SUPPLY_STATE_PACKET_BYTES} byte limit.`);
}

export function compileSupplyWorldState(input: CompileSupplyWorldStateInput): SupplyWorldStatePacket {
  if (input.scope.officeId !== input.projection.scope.officeId
    || input.scope.type !== input.projection.scope.type
    || supplyStateScopeRef(input.scope) !== supplyStateScopeRef(input.projection.scope)) {
    throw new Error("Supply state projection does not match the requested scope.");
  }
  const startedAt = performance.now();
  const objective = cleanObjective(input.objective);
  const compiledAt = compiledAtIso(input.compiledAt);
  const query = input.queryEvidence;
  const currentState = input.projection.payload.currentState;
  const legacyQueryCurrentState = query && "currentState" in query
    && query.currentState && typeof query.currentState === "object" && !Array.isArray(query.currentState)
    ? query.currentState as Record<string, unknown>
    : null;
  const relevantEvidence = queryResults(query);
  const derivedState = {
    ...input.projection.payload.derivedState,
    ...(query?.derivedState ?? {}),
    ...(legacyQueryCurrentState && Object.keys(legacyQueryCurrentState).length
      ? { historicalStateEvidence: legacyQueryCurrentState }
      : {}),
    ...(relevantEvidence.length ? { relevantEvidence } : {}),
  };
  const dependencies = mergeSupplyStateDependencies(input.projection.dependencies, query?.dependencies);
  const evidenceRefs = dedupeSupplyWorldEvidence([
    ...input.projection.evidenceRefs,
    ...(query?.evidenceRefs ?? []),
    ...dependencies.flatMap((dependency) => dependency.evidenceRefs),
  ]);
  const timingsMs = {
    ...input.projection.timingsMs,
    ...(query?.timingsMs ?? {}),
    packetAssembly: Math.max(0, performance.now() - startedAt),
  };
  const packet = fitPacket(packetWithoutHash({
    input,
    objective,
    compiledAt,
    currentState,
    derivedState,
    openLoops: [
      ...input.projection.payload.openLoops,
      ...(query?.openLoops ?? []),
    ].slice(0, 100),
    uncertainties: [
      ...input.projection.payload.uncertainties,
      ...(query?.uncertainties ?? []),
    ].slice(0, 100),
    evidenceRefs,
    dependencies,
    sourceCounts: mergeCounts(input.projection.sourceCounts, query?.sourceCounts),
    timingsMs,
  }));
  const packetBytes = Buffer.byteLength(canonicalSupplyStateJson(packet), "utf8");
  const labels = {
    officeId: input.scope.officeId,
    workspaceId: supplyStateWorkspaceId(input.scope),
    scopeType: input.scope.type,
    compilerVersion: packet.compilerVersion,
  } as const;
  recordSupplyStateMetric("packet_bytes", packetBytes, labels);
  recordSupplyStateMetric("dependency_count", packet.dependencies.length, labels);
  return packet;
}

function queryEvidenceFromReader(result: SupplyStateReaderResult): SupplyStateQueryEvidence {
  const companyBrainResults = result.derivedState.companyBrainEvidence;
  const { companyBrainEvidence: _companyBrainEvidence, ...otherDerivedState } = result.derivedState;
  return {
    derivedState: {
      ...otherDerivedState,
      ...(Object.keys(result.currentState).length
        ? { historicalStateEvidence: result.currentState }
        : {}),
    },
    results: Array.isArray(companyBrainResults)
      ? companyBrainResults.filter((entry): entry is Record<string, unknown> => (
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
        ))
      : [],
    openLoops: result.openLoops,
    uncertainties: result.uncertainties,
    evidenceRefs: result.evidenceRefs,
    dependencies: result.dependencies,
    sourceCounts: result.sourceCounts,
    timingsMs: result.timingsMs,
  };
}

export async function resolveSupplyStateCompilationDependencies(args: {
  officeId: string;
  projectionDependencies: SupplyStateDependency[];
  queryDependencies?: SupplyStateDependency[];
  registry?: SupplyStateFactRegistry;
}) {
  const declarations = mergeSupplyStateDependencies(
    args.projectionDependencies,
    args.queryDependencies,
  );
  return resolveRegisteredSupplyStateDependencies(
    declarations,
    { officeId: args.officeId, cache: new Map() },
    args.registry,
  );
}

export async function compileSupplyWorldStateLive(
  input: CompileSupplyWorldStateLiveInput,
): Promise<SupplyWorldStatePacket> {
  const startedAt = performance.now();
  if (input.access?.accessKind === "customer"
    || (input.access && (input.access as unknown as { actorType?: string }).actorType === "CUSTOMER")) {
    throw new Error("The Commercial State Runtime V1 is available only to internal operators.");
  }
  const objective = cleanObjective(input.objective);
  const shouldRetrieve = input.retrieveEvidence !== false && input.queryEvidence === undefined;
  const compilerVersion = input.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  const [projection, retrieved] = await Promise.all([
    getFreshStateProjection({
      scope: input.scope,
      access: input.access,
      compilerVersion,
      projectionsEnabled: input.useProjections,
    }),
    shouldRetrieve
      ? readCompanyBrainState({
          scope: input.scope,
          objective,
          access: input.access,
          compilerVersion,
        })
          .catch((error) => readerFailure("company_brain", error, { required: false }))
      : Promise.resolve(emptySupplyStateReaderResult()),
  ]);
  let queryEvidence = input.queryEvidence;
  if (shouldRetrieve) {
    queryEvidence = queryEvidenceFromReader(retrieved);
  }
  // Re-read the complete manifest in one registry context. This covers stored
  // projection facts, dynamic Company Brain evidence, and caller-supplied
  // query evidence alike; no non-registry declaration reaches a live packet.
  const resolvedDependencies = await resolveSupplyStateCompilationDependencies({
    officeId: input.scope.officeId,
    projectionDependencies: projection.dependencies,
    queryDependencies: queryEvidence?.dependencies,
  });
  const packet = compileSupplyWorldState({
    scope: input.scope,
    objective,
    projection: { ...projection, dependencies: resolvedDependencies },
    queryEvidence: queryEvidence ? { ...queryEvidence, dependencies: [] } : queryEvidence,
    compiledAt: input.compiledAt,
  });
  recordSupplyStateMetric("packet_compile_ms", Math.max(0, performance.now() - startedAt), {
    officeId: input.scope.officeId,
    workspaceId: supplyStateWorkspaceId(input.scope),
    scopeType: input.scope.type,
    compilerVersion: packet.compilerVersion,
  });
  return packet;
}

export function compileProcurementRequestState(input: Omit<
  CompileSupplyWorldStateLiveInput,
  "scope"
> & {
  scope: Extract<SupplyStateScope, { type: "procurement_request" }>;
}) {
  return compileSupplyWorldStateLive(input);
}

export async function compileProcurementRequestVendorPageState(input: Omit<
  CompileSupplyWorldStateLiveInput,
  "scope" | "queryEvidence"
> & {
  scope: Extract<SupplyStateScope, { type: "procurement_request" }>;
  vendorIds: readonly string[];
}) {
  const startedAt = performance.now();
  if (input.access?.accessKind === "customer"
    || (input.access && (input.access as unknown as { actorType?: string }).actorType === "CUSTOMER")) {
    throw new Error("The Commercial State Runtime V1 is available only to internal operators.");
  }
  const vendorIds = [...new Set(input.vendorIds.map((vendorId) => vendorId.trim()).filter(Boolean))];
  if (!vendorIds.length) throw new Error("A procurement supplier state page requires at least one supplier.");
  const objective = cleanObjective(input.objective);
  const compilerVersion = input.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  const shouldRetrieve = input.retrieveEvidence !== false;
  const [build, retrieved] = await Promise.all([
    buildSupplyStateProjection({
      scope: input.scope,
      access: input.access,
      compilerVersion,
    }, {
      readersForScope: () => [{
        name: "procurement_order",
        read: (readerInput) => readProcurementOrderState({
          ...readerInput,
          procurementVendorIds: vendorIds,
        }),
      }],
    }),
    shouldRetrieve
      ? readCompanyBrainState({
          scope: input.scope,
          objective,
          access: input.access,
          compilerVersion,
        })
          .catch((error) => readerFailure("company_brain", error, { required: false }))
      : Promise.resolve(emptySupplyStateReaderResult()),
  ]);
  if (build.hadReaderFailure) {
    throw new Error("Required procurement state was unavailable during bounded supplier compilation.");
  }
  const queryEvidence = shouldRetrieve ? queryEvidenceFromReader(retrieved) : null;
  const resolvedDependencies = await resolveSupplyStateCompilationDependencies({
    officeId: input.scope.officeId,
    projectionDependencies: build.dependencies,
    queryDependencies: queryEvidence?.dependencies,
  });
  const packet = compileSupplyWorldState({
    scope: input.scope,
    objective,
    compiledAt: input.compiledAt,
    projection: {
      id: null,
      scope: build.scope,
      projectionType: build.projectionType,
      compilerVersion: build.compilerVersion,
      sourceFingerprint: build.sourceFingerprint,
      payload: build.payload,
      payloadHash: build.payloadHash,
      evidenceRefs: build.evidenceRefs,
      dependencies: resolvedDependencies,
      builtAt: build.builtAt,
      dirtyAt: null,
      projectionHit: false,
      sourceCounts: build.sourceCounts,
      timingsMs: build.timingsMs,
    },
    queryEvidence: queryEvidence ? { ...queryEvidence, dependencies: [] } : queryEvidence,
  });
  recordSupplyStateMetric("packet_compile_ms", Math.max(0, performance.now() - startedAt), {
    officeId: input.scope.officeId,
    workspaceId: supplyStateWorkspaceId(input.scope),
    scopeType: input.scope.type,
    compilerVersion: packet.compilerVersion,
  });
  return packet;
}
