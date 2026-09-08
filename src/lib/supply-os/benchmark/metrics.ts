import type {
  BenchmarkAggregateMetrics,
  BenchmarkCaseMetrics,
  BenchmarkMeasuredCaseResult,
  BenchmarkSystemSummary,
} from "./result-types";
import type { BenchmarkSystemName } from "./systems";

type UnknownRecord = Record<string, unknown>;

const CANONICAL_EVIDENCE_POINTER = /^(?:company_context|supply_snapshot|supply_evidence|supply_profile_fact|supply_price_observation|planning_result|supply_decision|execution_task|execution_event|procurement_order|procurement_vendor|procurement_message|email_message|knowledge_object|knowledge_chunk|memory_event):.+$/;

export type BenchmarkValidationExpectation =
  | "strict_change"
  | "advisory_change"
  | "unchanged"
  | null;

export type BenchmarkCaseEvaluationInput = {
  queryType: string;
  goldFacts: unknown[];
  goldEvidence: unknown[];
  retrievedFacts: unknown[];
  retrievedEvidence: unknown[];
  hardNegativeEvidence?: unknown[];
  retrievalMs: number;
  hydrationMs: number;
  componentTimingsMs?: Record<string, number>;
  measurementPass?: number;
  queryOrdinal?: number;
  validationMs?: number | null;
  projectionHit?: boolean | null;
  validationResult?: {
    valid: boolean;
    changedStrict?: unknown[];
    changedAdvisory?: unknown[];
  } | null;
  validationExpectation?: BenchmarkValidationExpectation;
  expectedChangedStrictKeys?: string[];
  expectedChangedAdvisoryKeys?: string[];
  tenantLeakCount?: number;
  unroutedLeakCount?: number;
};

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as UnknownRecord;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Returns compatible aliases so Company Brain and state-runtime refs compare by canonical pointer. */
export function benchmarkEvidenceKeys(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap(benchmarkEvidenceKeys))];
  if (typeof value === "string" && value.trim()) return [value.trim()];
  const entry = record(value);
  if (!entry) return [];
  if (entry.ref) return benchmarkEvidenceKeys(entry.ref);
  if (Array.isArray(entry.evidence)) return benchmarkEvidenceKeys(entry.evidence);
  if (Array.isArray(entry.refs)) return benchmarkEvidenceKeys(entry.refs);
  const keys = new Set<string>();
  const kind = text(entry.kind);
  const id = text(entry.id);
  if (kind && id) keys.add(`${kind}:${id}`);
  const refType = text(entry.refType) ?? text(entry.ref_type);
  const objectId = text(entry.knowledgeObjectId) ?? text(entry.knowledge_object_id);
  const chunkId = text(entry.knowledgeChunkId) ?? text(entry.knowledge_chunk_id);
  const eventId = text(entry.memoryEventId) ?? text(entry.memory_event_id);
  const entityType = text(entry.entityType) ?? text(entry.entity_type);
  const entityId = text(entry.entityId) ?? text(entry.entity_id);
  const externalId = text(entry.sourceExternalId) ?? text(entry.source_external_id);
  if (objectId) keys.add(`knowledge_object:${objectId}`);
  if (chunkId) keys.add(`knowledge_chunk:${chunkId}`);
  if (eventId) keys.add(`memory_event:${eventId}`);
  if (entityType && entityId) {
    keys.add(`${entityType}:${entityId}`);
    keys.add(`entity:${entityType}:${entityId}`);
  }
  if (refType && id) keys.add(`${refType}:${id}`);
  if (refType && externalId) keys.add(`${refType}:external:${externalId}`);
  if (externalId) {
    keys.add(`external:${externalId}`);
    // Benchmark retrieval indexes encode an explicit pointer back to the
    // canonical evidence row. This alias never treats arbitrary external IDs
    // as gold evidence.
    if (CANONICAL_EVIDENCE_POINTER.test(externalId)) keys.add(externalId);
  }
  if (!keys.size) keys.add(`json:${stableJson(entry)}`);
  return [...keys];
}

function factKey(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const entry = record(value);
  return text(entry?.key)
    ?? text(entry?.factKey)
    ?? text(entry?.fact_key)
    ?? text(entry?.path)
    ?? (text(entry?.entityType) && text(entry?.entityId)
      ? `${text(entry?.entityType)}:${text(entry?.entityId)}`
      : null);
}

function factExpectedValue(value: unknown): unknown {
  const entry = record(value);
  if (!entry) return undefined;
  for (const field of [
    "valueHash",
    "value_hash",
    "contentHash",
    "content_hash",
    "sourceHash",
    "source_hash",
    "outputHash",
    "output_hash",
    "payloadHash",
    "payload_hash",
    "inputHash",
    "input_hash",
    "expectedValue",
    "expected_value",
    "value",
  ]) {
    if (Object.prototype.hasOwnProperty.call(entry, field)) return entry[field];
  }
  return undefined;
}

export function benchmarkFactsMatch(gold: unknown, retrieved: unknown) {
  const goldKey = factKey(gold);
  const retrievedKey = factKey(retrieved);
  if (!goldKey || goldKey !== retrievedKey) return false;
  const expected = factExpectedValue(gold);
  if (expected === undefined) return true;
  const actual = factExpectedValue(retrieved);
  return actual !== undefined && stableJson(actual) === stableJson(expected);
}

function evidenceMatches(gold: unknown, retrieved: unknown) {
  const expected = new Set(benchmarkEvidenceKeys(gold));
  return benchmarkEvidenceKeys(retrieved).some((key) => expected.has(key));
}

function uniqueGoldEvidence(values: unknown[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = benchmarkEvidenceKeys(value)[0] ?? `json:${stableJson(value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueGoldFacts(values: unknown[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = factKey(value) ?? `json:${stableJson(value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function recallAtK(goldEvidence: unknown[], retrievedEvidence: unknown[], k: number) {
  const gold = uniqueGoldEvidence(goldEvidence);
  if (!gold.length) return 1;
  const retrieved = retrievedEvidence.slice(0, Math.max(1, Math.floor(k)));
  const hits = gold.filter((expected) => retrieved.some((actual) => evidenceMatches(expected, actual))).length;
  return hits / gold.length;
}

export function reciprocalRank(goldEvidence: unknown[], retrievedEvidence: unknown[]) {
  const gold = uniqueGoldEvidence(goldEvidence);
  if (!gold.length) return 1;
  const index = retrievedEvidence.findIndex((actual) => gold.some((expected) => evidenceMatches(expected, actual)));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function factAccuracy(goldFacts: unknown[], retrievedFacts: unknown[]) {
  const gold = uniqueGoldFacts(goldFacts);
  if (!gold.length) return 1;
  return gold.filter((expected) => retrievedFacts.some((actual) => benchmarkFactsMatch(expected, actual))).length / gold.length;
}

export function temporalOrderAccuracy(goldEvidence: unknown[], retrievedEvidence: unknown[]) {
  const gold = uniqueGoldEvidence(goldEvidence);
  if (gold.length < 2) return recallAtK(gold, retrievedEvidence, retrievedEvidence.length || 1);
  const positions = gold.map((expected) =>
    retrievedEvidence.findIndex((actual) => evidenceMatches(expected, actual)));
  let correct = 0;
  let pairs = 0;
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      pairs += 1;
      if (positions[left]! >= 0 && positions[right]! >= 0 && positions[left]! < positions[right]!) correct += 1;
    }
  }
  return pairs ? correct / pairs : 1;
}

function queryTypeMatches(queryType: string, name: "current" | "temporal" | "entity" | "routing") {
  return queryType.trim().toLowerCase().replaceAll("-", "_").includes(name);
}

function normalizedQueryType(queryType: string) {
  return queryType.trim().toLowerCase().replaceAll("-", "_");
}

export function evaluateBenchmarkCase(input: BenchmarkCaseEvaluationInput): BenchmarkCaseMetrics {
  const correctEvidenceCount = uniqueGoldEvidence(input.goldEvidence).filter((expected) =>
    input.retrievedEvidence.some((actual) => evidenceMatches(expected, actual))).length;
  const goldFacts = uniqueGoldFacts(input.goldFacts);
  const surfacedFacts = input.retrievedFacts.slice(0, 20);
  // A fact is credited only when the system surfaced the matching current-state
  // fact. Merely retrieving evidence that could support it is not a fact hit.
  const correctFactCount = goldFacts.filter((expected) =>
    surfacedFacts.some((actual) => benchmarkFactsMatch(expected, actual))).length;
  const factRecallAt20 = goldFacts.length ? correctFactCount / goldFacts.length : 1;
  const hardNegativeHits = (input.hardNegativeEvidence ?? []).filter((negative) =>
    input.retrievedEvidence.some((actual) => evidenceMatches(negative, actual))).length;
  const currentAccuracy = normalizedQueryType(input.queryType) === "current_vs_stale"
    ? Number(correctFactCount === goldFacts.length && hardNegativeHits === 0)
    : null;
  const validation = input.validationResult;
  const expected = input.validationExpectation ?? null;
  const invalid = validation ? !validation.valid : false;
  const actualStrictKeys = new Set((validation?.changedStrict ?? []).map((change) => text(record(change)?.key)).filter((key): key is string => Boolean(key)));
  const actualAdvisoryKeys = new Set((validation?.changedAdvisory ?? []).map((change) => text(record(change)?.key)).filter((key): key is string => Boolean(key)));
  const expectedStrictKeys = new Set(input.expectedChangedStrictKeys ?? []);
  const expectedAdvisoryKeys = new Set(input.expectedChangedAdvisoryKeys ?? []);
  const exactKeys = (actual: Set<string>, wanted: Set<string>) =>
    actual.size === wanted.size && [...wanted].every((key) => actual.has(key));
  const expectedChangesObserved = exactKeys(actualStrictKeys, expectedStrictKeys)
    && exactKeys(actualAdvisoryKeys, expectedAdvisoryKeys);
  const retrievalSeconds = Math.max(0.000_001, input.retrievalMs / 1_000);
  const hydrationSeconds = Math.max(0.000_001, input.hydrationMs / 1_000);
  return {
    recallAt5: recallAtK(input.goldEvidence, input.retrievedEvidence, 5),
    recallAt10: recallAtK(input.goldEvidence, input.retrievedEvidence, 10),
    recallAt20: recallAtK(input.goldEvidence, input.retrievedEvidence, 20),
    factRecallAt20,
    reciprocalRank: reciprocalRank(input.goldEvidence, input.retrievedEvidence),
    currentStateAccuracy: currentAccuracy,
    temporalOrderAccuracy: queryTypeMatches(input.queryType, "temporal")
      ? temporalOrderAccuracy(input.goldEvidence, input.retrievedEvidence)
      : null,
    entityResolutionAccuracy: queryTypeMatches(input.queryType, "entity")
      || queryTypeMatches(input.queryType, "routing")
      ? Number(recallAtK(input.goldEvidence, input.retrievedEvidence, 20) === 1 && hardNegativeHits === 0)
      : null,
    correctEvidenceCount,
    correctFactCount,
    evidenceBandwidthPerSecond: correctEvidenceCount / retrievalSeconds,
    factBandwidthPerSecond: correctFactCount / hydrationSeconds,
    projectionHit: input.projectionHit ?? null,
    tenantLeakCount: Math.max(0, Math.floor(input.tenantLeakCount ?? 0)),
    unroutedLeakCount: Math.max(0, Math.floor(input.unroutedLeakCount ?? 0)),
    strictStaleDetected: expected === "strict_change" ? Number(invalid && expectedChangesObserved) : null,
    staleEscape: expected === "strict_change" ? Number(!invalid || !expectedChangesObserved) : null,
    falseConflict: expected === "unchanged" || expected === "advisory_change"
      ? Number(invalid || !expectedChangesObserved)
      : null,
    retrievalMs: Math.max(0, input.retrievalMs),
    hydrationMs: Math.max(0, input.hydrationMs),
    validationMs: input.validationMs == null ? null : Math.max(0, input.validationMs),
    componentTimingsMs: Object.fromEntries(Object.entries(input.componentTimingsMs ?? {})
      .filter(([, value]) => Number.isFinite(value) && value >= 0)),
    measurementPass: Math.max(1, Math.floor(input.measurementPass ?? 1)),
    queryOrdinal: Math.max(1, Math.floor(input.queryOrdinal ?? 1)),
  };
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function optionalMean(values: Array<number | null>) {
  const measured = values.filter((value): value is number => value != null && Number.isFinite(value));
  return measured.length ? mean(measured) : null;
}

export function percentile(values: number[], quantile: number) {
  const measured = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!measured.length) return 0;
  const bounded = Math.max(0, Math.min(1, quantile));
  const rank = Math.max(0, Math.ceil(bounded * measured.length) - 1);
  return measured[rank]!;
}

export function aggregateBenchmarkMetrics(results: BenchmarkMeasuredCaseResult[]): BenchmarkAggregateMetrics {
  const metrics = results.map((result) => result.metrics);
  const validations = metrics.map((entry) => entry.validationMs).filter((value): value is number => value != null);
  const retrievalSeconds = metrics.reduce((sum, entry) => sum + entry.retrievalMs, 0) / 1_000;
  const hydrationSeconds = metrics.reduce((sum, entry) => sum + entry.hydrationMs, 0) / 1_000;
  const componentNames = [...new Set(metrics.flatMap((entry) => Object.keys(entry.componentTimingsMs ?? {})))].sort();
  const componentTimings = Object.fromEntries(componentNames.map((name) => {
    const values = metrics.map((entry) => (entry.componentTimingsMs ?? {})[name])
      .filter((value): value is number => value != null && Number.isFinite(value));
    return [name, {
      sampleCount: values.length,
      totalMs: values.reduce((sum, value) => sum + value, 0),
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
    }];
  }));
  return {
    caseCount: results.length,
    recallAt5: mean(metrics.map((entry) => entry.recallAt5)),
    recallAt10: mean(metrics.map((entry) => entry.recallAt10)),
    recallAt20: mean(metrics.map((entry) => entry.recallAt20)),
    factRecallAt20: mean(metrics.map((entry) => entry.factRecallAt20 ?? 0)),
    mrr: mean(metrics.map((entry) => entry.reciprocalRank)),
    currentStateAccuracy: optionalMean(metrics.map((entry) => entry.currentStateAccuracy)),
    temporalOrderAccuracy: optionalMean(metrics.map((entry) => entry.temporalOrderAccuracy)),
    entityResolutionAccuracy: optionalMean(metrics.map((entry) => entry.entityResolutionAccuracy)),
    latencyP50Ms: percentile(results.map((entry) => entry.latencyMs), 0.5),
    latencyP95Ms: percentile(results.map((entry) => entry.latencyMs), 0.95),
    projectionHitRate: optionalMean(metrics.map((entry) => entry.projectionHit == null ? null : Number(entry.projectionHit))),
    hydrationP50Ms: percentile(metrics.map((entry) => entry.hydrationMs), 0.5),
    hydrationP95Ms: percentile(metrics.map((entry) => entry.hydrationMs), 0.95),
    validationP50Ms: validations.length ? percentile(validations, 0.5) : null,
    validationP95Ms: validations.length ? percentile(validations, 0.95) : null,
    evidenceBandwidthPerSecond: retrievalSeconds > 0
      ? metrics.reduce((sum, entry) => sum + entry.correctEvidenceCount, 0) / retrievalSeconds
      : 0,
    factBandwidthPerSecond: hydrationSeconds > 0
      ? metrics.reduce((sum, entry) => sum + entry.correctFactCount, 0) / hydrationSeconds
      : 0,
    tenantLeakCount: metrics.reduce((sum, entry) => sum + entry.tenantLeakCount, 0),
    unroutedLeakCount: metrics.reduce((sum, entry) => sum + entry.unroutedLeakCount, 0),
    strictStaleDetectionRate: optionalMean(metrics.map((entry) => entry.strictStaleDetected)),
    staleEscapeRate: optionalMean(metrics.map((entry) => entry.staleEscape)),
    falseConflictRate: optionalMean(metrics.map((entry) => entry.falseConflict)),
    componentTimings,
  };
}

export function aggregateMetricsByQueryType(results: BenchmarkMeasuredCaseResult[]) {
  const groups = new Map<string, BenchmarkMeasuredCaseResult[]>();
  for (const result of results) {
    const current = groups.get(result.queryType) ?? [];
    current.push(result);
    groups.set(result.queryType, current);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([queryType, entries]) => [queryType, aggregateBenchmarkMetrics(entries)]));
}

export function calculateBandwidthMultipliers(systems: BenchmarkSystemSummary[]) {
  const profiles = [...new Set(systems.map((system) => system.profile))].sort();
  return profiles.flatMap((profile) => {
    const hot = systems.find((system) => system.profile === profile && system.systemName === "DERYA_HOT");
    const hybrid = systems.find((system) => system.profile === profile && system.systemName === "STRONG_HYBRID_RAG");
    return (["evidence", "fact"] as const).map((metric) => {
      const hotValue = metric === "evidence"
        ? hot?.metrics?.evidenceBandwidthPerSecond
        : hot?.metrics?.factBandwidthPerSecond;
      const baselineValue = metric === "evidence"
        ? hybrid?.metrics?.evidenceBandwidthPerSecond
        : hybrid?.metrics?.factBandwidthPerSecond;
      const valid = hot?.status === "completed"
        && hybrid?.status === "completed"
        && Number.isFinite(hotValue)
        && Number.isFinite(baselineValue)
        && (baselineValue ?? 0) > 0;
      return {
        profile,
        metric,
        hotSystem: "DERYA_HOT" as const,
        baselineSystem: "STRONG_HYBRID_RAG" as const,
        value: valid ? hotValue! / baselineValue! : null,
        ...(!valid ? { reason: hybrid?.skipReason ?? "baseline_not_measured" } : {}),
      };
    });
  });
}

export function groupResultsBySystem(results: BenchmarkMeasuredCaseResult[]) {
  const groups = new Map<string, BenchmarkMeasuredCaseResult[]>();
  for (const result of results) {
    const key = `${result.profile}:${result.systemName}`;
    const current = groups.get(key) ?? [];
    current.push(result);
    groups.set(key, current);
  }
  return groups as Map<string, BenchmarkMeasuredCaseResult[]>;
}

export function systemKey(profile: string, systemName: BenchmarkSystemName) {
  return `${profile}:${systemName}`;
}
