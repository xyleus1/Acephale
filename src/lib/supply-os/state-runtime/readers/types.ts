import type { SupplyAccessContext } from "@/lib/supply-os/persistence";
import {
  hashSupplyStateValue,
} from "@/lib/supply-os/state-runtime/canonicalize";
import {
  readSupplyStateDependency,
  type SupplyStateFactRegistry,
  type SupplyStateFactReadContext,
} from "@/lib/supply-os/state-runtime/fact-registry";
import type {
  SupplyStateDependency,
  SupplyStateScope,
  SupplyWorldEvidenceRef,
} from "@/lib/supply-os/state-runtime/types";

export const SUPPLY_STATE_MAX_COLLECTION = 100;
export const SUPPLY_STATE_MAX_EVIDENCE = 240;
export const SUPPLY_STATE_MAX_DEPENDENCIES = 320;
export const SUPPLY_STATE_MAX_TEXT = 4_000;

export type SupplyStateReaderInput = {
  scope: SupplyStateScope;
  objective: string;
  access?: SupplyAccessContext | null;
  procurementVendorIds?: readonly string[];
  compilerVersion?: string;
};

export type SupplyStateReaderResult = {
  currentState: Record<string, unknown>;
  derivedState: Record<string, unknown>;
  openLoops: Array<Record<string, unknown>>;
  uncertainties: Array<Record<string, unknown>>;
  evidenceRefs: SupplyWorldEvidenceRef[];
  dependencies: SupplyStateDependency[];
  sourceCounts: Record<string, number>;
  timingsMs: Record<string, number>;
};

export function emptySupplyStateReaderResult(): SupplyStateReaderResult {
  return {
    currentState: {},
    derivedState: {},
    openLoops: [],
    uncertainties: [],
    evidenceRefs: [],
    dependencies: [],
    sourceCounts: {},
    timingsMs: {},
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function boundedText(value: unknown, max = SUPPLY_STATE_MAX_TEXT) {
  return typeof value === "string"
    ? value.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max)
    : "";
}

export function safeIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function decimalString(value: { toString(): string } | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? String(value) : value.toString();
}

export function boundSupplyStateValue(
  value: unknown,
  options: { depth?: number; maxArray?: number; maxKeys?: number; maxString?: number } = {},
): unknown {
  const depth = options.depth ?? 0;
  const maxArray = options.maxArray ?? SUPPLY_STATE_MAX_COLLECTION;
  const maxKeys = options.maxKeys ?? 80;
  const maxString = options.maxString ?? SUPPLY_STATE_MAX_TEXT;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return boundedText(value, maxString);
  if (value instanceof Date) return safeIso(value);
  if (depth >= 7) return "[bounded]";
  if (Array.isArray(value)) {
    return value.slice(0, maxArray).map((entry) => boundSupplyStateValue(entry, {
      ...options,
      depth: depth + 1,
    }));
  }
  if (!value || typeof value !== "object") return null;
  if ("toJSON" in value && typeof value.toJSON === "function") {
    return boundSupplyStateValue(value.toJSON(), { ...options, depth: depth + 1 });
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, maxKeys)
    .flatMap(([key, child]) => child === undefined
      ? []
      : [[key, boundSupplyStateValue(child, { ...options, depth: depth + 1 })] as const]);
  return Object.fromEntries(entries);
}

export function makeSupplyStateDependency(args: {
  key: string;
  source: SupplyStateDependency["source"];
  entityType: string;
  entityRef: string;
  value: unknown;
  version?: string | null;
  policy?: SupplyStateDependency["policy"];
  reason: string;
  evidenceRefs?: SupplyWorldEvidenceRef[];
}): SupplyStateDependency {
  const valueHash = hashSupplyStateValue(args.value);
  return {
    key: args.key,
    source: args.source,
    entityType: args.entityType,
    entityRef: args.entityRef,
    version: args.version?.trim() || valueHash,
    valueHash,
    policy: args.policy ?? "ADVISORY",
    reason: args.reason,
    evidenceRefs: dedupeSupplyWorldEvidence(args.evidenceRefs ?? []),
  };
}

export function evidenceRefKey(ref: SupplyWorldEvidenceRef) {
  return `${ref.kind}:${ref.id}`;
}

export function dedupeSupplyWorldEvidence(refs: SupplyWorldEvidenceRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = evidenceRefKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, SUPPLY_STATE_MAX_EVIDENCE);
}

export class SupplyStateDependencyDriftError extends Error {
  readonly code = "dependency_drift" as const;

  constructor(
    public readonly key: string,
    public readonly declaredVersion: string,
    public readonly currentVersion: string,
    public readonly declaredHash: string,
    public readonly currentHash: string,
  ) {
    super(`Supply state fact ${key} changed while its packet was being compiled.`);
    this.name = "SupplyStateDependencyDriftError";
  }
}

export function mergeSupplyStateReaderResults(results: SupplyStateReaderResult[]): SupplyStateReaderResult {
  const merged = emptySupplyStateReaderResult();
  for (const result of results) {
    Object.assign(merged.currentState, result.currentState);
    Object.assign(merged.derivedState, result.derivedState);
    merged.openLoops.push(...result.openLoops);
    merged.uncertainties.push(...result.uncertainties);
    merged.evidenceRefs.push(...result.evidenceRefs);
    merged.dependencies.push(...result.dependencies);
    for (const [source, count] of Object.entries(result.sourceCounts)) {
      merged.sourceCounts[source] = (merged.sourceCounts[source] ?? 0) + count;
    }
    for (const [source, timing] of Object.entries(result.timingsMs)) {
      if (!Number.isFinite(timing) || timing < 0) continue;
      merged.timingsMs[source] = (merged.timingsMs[source] ?? 0) + timing;
    }
  }
  merged.evidenceRefs = dedupeSupplyWorldEvidence(merged.evidenceRefs);
  const dependencyByKey = new Map<string, SupplyStateDependency>();
  for (const dependency of merged.dependencies) {
    const existing = dependencyByKey.get(dependency.key);
    if (!existing) {
      dependencyByKey.set(dependency.key, dependency);
      continue;
    }
    if (existing.version !== dependency.version || existing.valueHash !== dependency.valueHash) {
      throw new SupplyStateDependencyDriftError(
        dependency.key,
        existing.version,
        dependency.version,
        existing.valueHash,
        dependency.valueHash,
      );
    }
    if (existing.source !== dependency.source
      || existing.entityType !== dependency.entityType
      || existing.entityRef !== dependency.entityRef
      || existing.policy !== dependency.policy) {
      throw new Error(`Supply state readers declared incompatible metadata for fact ${dependency.key}.`);
    }
    dependencyByKey.set(dependency.key, {
      ...existing,
      evidenceRefs: dedupeSupplyWorldEvidence([
        ...existing.evidenceRefs,
        ...dependency.evidenceRefs,
      ]),
    });
  }
  const dependencies = [...dependencyByKey.values()]
    .sort((left, right) => left.key.localeCompare(right.key));
  if (dependencies.length > SUPPLY_STATE_MAX_DEPENDENCIES) {
    throw new Error(`Supply state dependency manifest exceeds ${SUPPLY_STATE_MAX_DEPENDENCIES} facts.`);
  }
  merged.dependencies = dependencies;
  merged.openLoops = merged.openLoops.slice(0, SUPPLY_STATE_MAX_COLLECTION);
  merged.uncertainties = merged.uncertainties.slice(0, SUPPLY_STATE_MAX_COLLECTION);
  return merged;
}

// Reader-local dependency values are declarations used to keep packet assembly
// testable. Before a projection or packet is sealed, every declaration is read
// again through the fact registry, which exclusively owns the semantic value,
// canonical hash, source version, and canonical evidence for that key.
export async function resolveRegisteredSupplyStateDependencies(
  dependencies: SupplyStateDependency[],
  context: SupplyStateFactReadContext,
  registry?: SupplyStateFactRegistry,
) {
  return Promise.all(dependencies.map(async (dependency) => {
    const current = await readSupplyStateDependency({
      registry,
      key: dependency.key,
      context,
      policy: dependency.policy,
      reason: dependency.reason,
    });
    if (dependency.version !== current.version || dependency.valueHash !== current.valueHash) {
      throw new SupplyStateDependencyDriftError(
        dependency.key,
        dependency.version,
        current.version,
        dependency.valueHash,
        current.valueHash,
      );
    }
    return current;
  }));
}

export function readerFailure(
  source: string,
  error: unknown,
  options: { required?: boolean } = {},
): SupplyStateReaderResult {
  const required = options.required !== false;
  return {
    ...emptySupplyStateReaderResult(),
    uncertainties: [{
      kind: required ? "source_reader_failed" : "evidence_retrieval_failed",
      source,
      message: error instanceof Error ? boundedText(error.message, 500) : "Source reader failed.",
    }],
    sourceCounts: {
      [`${source}_errors`]: 1,
      ...(required ? { requiredSourceReaderFailures: 1 } : {}),
    },
  };
}
