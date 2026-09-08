import "server-only";

import {
  hashSupplyStateDependencies,
} from "@/lib/supply-os/state-runtime/canonicalize";
import {
  readSupplyStateDependency,
  type SupplyStateFactReadContext,
  type SupplyStateFactRegistry,
} from "@/lib/supply-os/state-runtime/fact-registry";
import type { SupplyStateDependency } from "@/lib/supply-os/state-runtime/types";

const MAX_FRESHNESS_CONCURRENCY = 12;
const MAX_PROJECTION_HEAD_DEPENDENCIES = 128;

const PROJECTION_HEAD_PREFIXES = [
  "company.identity:",
  "workspace.identity:",
  "workspace.presentation:",
  "workspace.current_snapshot:",
  "workspace.equivalence_rules:",
  "company.context_workspaces:",
  "company.context_version:",
  "email.company_threads:",
  "procurement.order:",
  "procurement.order_decision_state:",
  "procurement.order_request_context:",
  "procurement.order_stage:",
  "procurement.vendor:",
  "procurement.vendor_quote:",
  "procurement.vendor_latest_message:",
  "procurement.vendor_saved_draft:",
  "supplier.identity:",
  "supplier.company_relationship:",
  "supplier.profile:",
  "supplier.profile_research:",
  "supplier.profile_facts:",
  "supplier.price_observations:",
  "supplier.evidence:",
  "item.identity:",
  "item.approved_alias_mapping:",
  "item.equivalence_rules:",
  "item.planning_results:",
  "planning.latest_results:",
  "execution.controls:",
  "execution.events:",
] as const;

// Projection head facts summarize mutable state represented by the payload.
// Immutable child hashes remain in the complete manifest for durable action
// validation, but a cache hit need not reread each child independently.
export function projectionFreshnessHeadDependencies(dependencies: SupplyStateDependency[]) {
  const selected = dependencies.filter((dependency) => (
    PROJECTION_HEAD_PREFIXES.some((prefix) => dependency.key.startsWith(prefix))
  ));
  return selected.length <= MAX_PROJECTION_HEAD_DEPENDENCIES ? selected : [];
}

async function mapConcurrent<T, U>(values: T[], worker: (value: T) => Promise<U>) {
  const output = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(MAX_FRESHNESS_CONCURRENCY, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index]!);
    }
  }));
  return output;
}

export type SupplyStateProjectionFreshness = {
  fresh: boolean;
  sourceFingerprint: string | null;
  changedKeys: string[];
  failedKeys: string[];
};

export async function checkSupplyStateProjectionFreshness(args: {
  officeId: string;
  expectedSourceFingerprint: string;
  dependencies: SupplyStateDependency[];
  registry?: SupplyStateFactRegistry;
}): Promise<SupplyStateProjectionFreshness> {
  if (hashSupplyStateDependencies(args.dependencies) !== args.expectedSourceFingerprint) {
    return { fresh: false, sourceFingerprint: null, changedKeys: [], failedKeys: ["manifest_integrity"] };
  }
  const heads = projectionFreshnessHeadDependencies(args.dependencies);
  if (!heads.length) {
    return { fresh: false, sourceFingerprint: null, changedKeys: [], failedKeys: ["freshness_heads"] };
  }
  const context: SupplyStateFactReadContext = { officeId: args.officeId, cache: new Map() };
  const failedKeys: string[] = [];
  const current = await mapConcurrent(heads, async (dependency) => {
    try {
      return await readSupplyStateDependency({
        registry: args.registry,
        key: dependency.key,
        context,
        policy: dependency.policy,
        reason: dependency.reason,
      });
    } catch {
      failedKeys.push(dependency.key);
      return null;
    }
  });
  if (failedKeys.length) {
    return {
      fresh: false,
      sourceFingerprint: null,
      changedKeys: [],
      failedKeys: failedKeys.sort(),
    };
  }
  const currentDependencies = current.filter((dependency): dependency is SupplyStateDependency => Boolean(dependency));
  const currentByKey = new Map(currentDependencies.map((dependency) => [dependency.key, dependency]));
  const changedKeys = heads.flatMap((dependency) => {
    const next = currentByKey.get(dependency.key);
    return !next || next.version !== dependency.version || next.valueHash !== dependency.valueHash
      ? [dependency.key]
      : [];
  }).sort();
  const headFingerprint = hashSupplyStateDependencies(currentDependencies);
  const expectedHeadFingerprint = hashSupplyStateDependencies(heads);
  return {
    fresh: changedKeys.length === 0 && headFingerprint === expectedHeadFingerprint,
    sourceFingerprint: changedKeys.length === 0 && headFingerprint === expectedHeadFingerprint
      ? args.expectedSourceFingerprint
      : null,
    changedKeys,
    failedKeys: [],
  };
}
