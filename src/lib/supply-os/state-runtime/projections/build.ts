import "server-only";

import {
  canonicalSupplyStateJson,
  hashSupplyStateDependencies,
  hashSupplyStateValue,
} from "@/lib/supply-os/state-runtime/canonicalize";
import { recordSupplyStateMetric } from "@/lib/supply-os/state-runtime/instrumentation";
import { readCompanyState } from "@/lib/supply-os/state-runtime/readers/company";
import { readCompanyContextState } from "@/lib/supply-os/state-runtime/readers/company-context";
import { readEmailThreadState } from "@/lib/supply-os/state-runtime/readers/email-thread";
import { readExecutionState } from "@/lib/supply-os/state-runtime/readers/execution";
import { readItemSupplyState } from "@/lib/supply-os/state-runtime/readers/item-supply";
import { readPlanningState } from "@/lib/supply-os/state-runtime/readers/planning";
import { readProcurementOrderState } from "@/lib/supply-os/state-runtime/readers/procurement-order";
import { readSupplierState } from "@/lib/supply-os/state-runtime/readers/supplier";
import {
  boundSupplyStateValue,
  mergeSupplyStateReaderResults,
  readerFailure,
  resolveRegisteredSupplyStateDependencies,
  SupplyStateDependencyDriftError,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "@/lib/supply-os/state-runtime/readers/types";
import { assertSupplyStateScopeOwnership } from "@/lib/supply-os/state-runtime/readers/scope-ownership";
import { readWorkspaceSnapshotState } from "@/lib/supply-os/state-runtime/readers/workspace-snapshot";
import { supplyStateWorkspaceId } from "@/lib/supply-os/state-runtime/types";
import {
  projectionTypeForSupplyStateScope,
  SUPPLY_STATE_COMPILER_VERSION,
  type SupplyStateProjectionBuild,
  type SupplyStateProjectionPayload,
  type SupplyStateProjectionRequest,
} from "./types";

const MAX_PROJECTION_PAYLOAD_BYTES = 72 * 1024;

type NamedReader = {
  name: string;
  read: (input: SupplyStateReaderInput) => Promise<SupplyStateReaderResult>;
};

export type SupplyStateProjectionBuildDependencies = {
  readersForScope?: (input: SupplyStateReaderInput) => NamedReader[];
  resolveDependencies?: typeof resolveRegisteredSupplyStateDependencies;
  assertScopeOwnership?: typeof assertSupplyStateScopeOwnership;
  now?: () => Date;
};

function defaultReadersForScope(input: SupplyStateReaderInput): NamedReader[] {
  if (input.scope.type === "company") {
    return [
      { name: "company", read: readCompanyState },
      { name: "company_context", read: readCompanyContextState },
      { name: "email_thread", read: readEmailThreadState },
    ];
  }
  if (input.scope.type === "procurement_request") {
    return [{ name: "procurement_order", read: readProcurementOrderState }];
  }
  if (input.scope.type === "supplier") {
    return [{ name: "supplier", read: readSupplierState }];
  }
  if (input.scope.type === "item") {
    return [{ name: "item_supply", read: readItemSupplyState }];
  }
  return [
    { name: "workspace_snapshot", read: readWorkspaceSnapshotState },
    { name: "planning", read: readPlanningState },
    { name: "execution", read: readExecutionState },
  ];
}

function compactProjectionPayload(payload: SupplyStateProjectionPayload) {
  if (Buffer.byteLength(canonicalSupplyStateJson(payload), "utf8") <= MAX_PROJECTION_PAYLOAD_BYTES) {
    return payload;
  }
  for (const limits of [
    { maxArray: 40, maxString: 2_000 },
    { maxArray: 20, maxString: 1_000 },
    { maxArray: 10, maxString: 500 },
  ]) {
    const compact = boundSupplyStateValue(payload, limits) as SupplyStateProjectionPayload;
    if (Buffer.byteLength(canonicalSupplyStateJson(compact), "utf8") <= MAX_PROJECTION_PAYLOAD_BYTES) {
      compact.uncertainties = [
        ...(Array.isArray(compact.uncertainties) ? compact.uncertainties : []),
        { kind: "projection_payload_compacted", byteLimit: MAX_PROJECTION_PAYLOAD_BYTES },
      ].slice(0, limits.maxArray);
      if (Buffer.byteLength(canonicalSupplyStateJson(compact), "utf8") <= MAX_PROJECTION_PAYLOAD_BYTES) {
        return compact;
      }
    }
  }
  throw new Error("Bounded supply state projection payload still exceeds its serialized limit.");
}

export async function buildSupplyStateProjection(
  request: SupplyStateProjectionRequest,
  dependencies: SupplyStateProjectionBuildDependencies = {},
): Promise<SupplyStateProjectionBuild> {
  if (request.access?.accessKind === "customer"
    || (request.access && (request.access as unknown as { actorType?: string }).actorType === "CUSTOMER")) {
    throw new Error("The Commercial State Runtime V1 is available only to internal operators.");
  }
  await (dependencies.assertScopeOwnership ?? assertSupplyStateScopeOwnership)(request.scope);
  const compilerVersion = request.compilerVersion ?? SUPPLY_STATE_COMPILER_VERSION;
  const input: SupplyStateReaderInput = {
    scope: request.scope,
    objective: `Materialize ${projectionTypeForSupplyStateScope(request.scope)} current state.`,
    access: request.access,
  };
  const readers = (dependencies.readersForScope ?? defaultReadersForScope)(input);
  const timingsMs: Record<string, number> = {};
  let hadReaderFailure = false;
  let merged: SupplyStateReaderResult | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let attemptReaderFailure = false;
    const results = await Promise.all(readers.map(async (reader) => {
      const startedAt = performance.now();
      try {
        return await reader.read(input);
      } catch (error) {
        attemptReaderFailure = true;
        return readerFailure(reader.name, error);
      } finally {
        const elapsed = Math.max(0, performance.now() - startedAt);
        timingsMs[reader.name] = (timingsMs[reader.name] ?? 0) + elapsed;
        recordSupplyStateMetric("source_reader_ms", elapsed, {
          officeId: request.scope.officeId,
          workspaceId: supplyStateWorkspaceId(request.scope),
          scopeType: request.scope.type,
          source: reader.name,
          compilerVersion,
        });
      }
    }));
    try {
      const attemptMerged = mergeSupplyStateReaderResults(results);
      attemptMerged.dependencies = await (
        dependencies.resolveDependencies ?? resolveRegisteredSupplyStateDependencies
      )(
        attemptMerged.dependencies,
        { officeId: request.scope.officeId, cache: new Map() },
      );
      merged = attemptMerged;
      hadReaderFailure = attemptReaderFailure;
      break;
    } catch (error) {
      if (!(error instanceof SupplyStateDependencyDriftError) || attempt === 1) throw error;
    }
  }
  if (!merged) throw new Error("Supply state projection compilation did not produce a consistent result.");
  merged.evidenceRefs = [...new Map([
    ...merged.evidenceRefs,
    ...merged.dependencies.flatMap((dependency) => dependency.evidenceRefs),
  ].map((reference) => [`${reference.kind}:${reference.id}`, reference])).values()];
  const payload = compactProjectionPayload({
    currentState: merged.currentState,
    derivedState: merged.derivedState,
    openLoops: merged.openLoops,
    uncertainties: merged.uncertainties,
  });
  const builtAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const projectionType = projectionTypeForSupplyStateScope(request.scope);
  return {
    scope: request.scope,
    projectionType,
    compilerVersion,
    sourceFingerprint: hashSupplyStateDependencies(merged.dependencies),
    payload,
    payloadHash: hashSupplyStateValue(payload),
    evidenceRefs: merged.evidenceRefs,
    dependencies: merged.dependencies,
    builtAt,
    sourceCounts: merged.sourceCounts,
    timingsMs,
    hadReaderFailure,
  };
}
