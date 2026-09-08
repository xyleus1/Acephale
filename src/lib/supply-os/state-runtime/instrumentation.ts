export const SUPPLY_STATE_METRICS = [
  "packet_compile_ms",
  "source_reader_ms",
  "projection_hit",
  "projection_rebuild_count",
  "packet_bytes",
  "dependency_count",
  "validation_ms",
  "strict_conflict_count",
  "advisory_change_count",
  "action_block_count",
  "false_conflict_test_count",
  "retrieval_recall_at_k",
] as const;

export type SupplyStateMetricName = (typeof SUPPLY_STATE_METRICS)[number];

export type SupplyStateMetricLabels = Partial<Record<
  | "officeId"
  | "workspaceId"
  | "scopeType"
  | "projectionType"
  | "source"
  | "compilerVersion"
  | "validationMode"
  | "actionType"
  | "benchmark"
  | "benchmarkName",
  string | boolean | null
>>;

export type SupplyStateMetricEvent = {
  name: SupplyStateMetricName;
  value: number;
  labels: SupplyStateMetricLabels;
  recordedAt: string;
};

export type SupplyStateMetricLog = {
  event: "supply_state_runtime.metric";
  metric: SupplyStateMetricName;
  value: number;
  labels: SupplyStateMetricLabels;
  recordedAt: string;
};

export type SupplyStateMetricSummary = {
  name: SupplyStateMetricName;
  labels: SupplyStateMetricLabels;
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  sum: number;
};

type MetricSeries = {
  name: SupplyStateMetricName;
  labels: SupplyStateMetricLabels;
  samples: number[];
  sum: number;
};

const MAX_SAMPLES_PER_SERIES = 2_048;
const MAX_METRIC_SERIES = 1_024;
const ALLOWED_LABELS = new Set([
  "officeId",
  "workspaceId",
  "scopeType",
  "projectionType",
  "source",
  "compilerVersion",
  "validationMode",
  "actionType",
  "benchmark",
  "benchmarkName",
]);

declare global {
  // eslint-disable-next-line no-var
  var supplyStateMetricSeriesGlobal: Map<string, MetricSeries> | undefined;
  // eslint-disable-next-line no-var
  var supplyStateMetricSinkGlobal: ((event: SupplyStateMetricEvent) => void) | undefined;
}

const series = global.supplyStateMetricSeriesGlobal ?? new Map<string, MetricSeries>();
if (process.env.NODE_ENV !== "production") global.supplyStateMetricSeriesGlobal = series;

function normalizedLabels(labels: SupplyStateMetricLabels) {
  const output: SupplyStateMetricLabels = {};
  for (const [key, value] of Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))) {
    if (!ALLOWED_LABELS.has(key) || value === undefined) continue;
    output[key as keyof SupplyStateMetricLabels] = typeof value === "string"
      ? value.replace(/[\r\n\0]/g, "").slice(0, 160)
      : value;
  }
  return output;
}

function seriesKey(name: SupplyStateMetricName, labels: SupplyStateMetricLabels) {
  return `${name}:${JSON.stringify(labels)}`;
}

function percentile(sorted: number[], percentileValue: number) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}

export function setSupplyStateMetricSink(sink?: (event: SupplyStateMetricEvent) => void) {
  global.supplyStateMetricSinkGlobal = sink;
}

function emitProductionMetric(event: SupplyStateMetricEvent) {
  if (process.env.NODE_ENV !== "production") return;
  const log: SupplyStateMetricLog = {
    event: "supply_state_runtime.metric",
    metric: event.name,
    value: event.value,
    labels: event.labels,
    recordedAt: event.recordedAt,
  };
  console.info(JSON.stringify(log));
}

export function recordSupplyStateMetric(
  name: SupplyStateMetricName,
  value: number,
  labels: SupplyStateMetricLabels = {},
) {
  if (!Number.isFinite(value) || value < 0) return;
  if (name === "retrieval_recall_at_k" && labels.benchmark !== true) return;
  const safeLabels = normalizedLabels(labels);
  const key = seriesKey(name, safeLabels);
  let current = series.get(key);
  if (!current) {
    if (series.size >= MAX_METRIC_SERIES) {
      const oldest = series.keys().next().value;
      if (oldest !== undefined) series.delete(oldest);
    }
    current = { name, labels: safeLabels, samples: [], sum: 0 };
  }
  current.samples.push(value);
  current.sum += value;
  if (current.samples.length > MAX_SAMPLES_PER_SERIES) {
    current.sum -= current.samples.shift() ?? 0;
  }
  series.set(key, current);

  const event: SupplyStateMetricEvent = {
    name,
    value,
    labels: safeLabels,
    recordedAt: new Date().toISOString(),
  };
  try {
    const sink = global.supplyStateMetricSinkGlobal;
    if (sink) sink(event);
    else emitProductionMetric(event);
  } catch {
    // Metrics are best effort and may never break a commercial operation.
  }
}

export function incrementSupplyStateMetric(
  name: SupplyStateMetricName,
  labels: SupplyStateMetricLabels = {},
  amount = 1,
) {
  recordSupplyStateMetric(name, amount, labels);
}

export async function measureSupplyStateOperation<T>(
  metric: "packet_compile_ms" | "source_reader_ms" | "validation_ms",
  operation: () => Promise<T>,
  labels: SupplyStateMetricLabels = {},
) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    recordSupplyStateMetric(metric, Math.max(0, performance.now() - startedAt), labels);
  }
}

export function getSupplyStateMetricSummaries(): SupplyStateMetricSummary[] {
  return [...series.values()].map((entry) => {
    const sorted = [...entry.samples].sort((left, right) => left - right);
    return {
      name: entry.name,
      labels: entry.labels,
      count: sorted.length,
      min: sorted[0] ?? 0,
      max: sorted.at(-1) ?? 0,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      sum: entry.sum,
    };
  });
}

export function resetSupplyStateInstrumentationForTests() {
  if (process.env.NODE_ENV === "production") return;
  series.clear();
  global.supplyStateMetricSinkGlobal = undefined;
}
