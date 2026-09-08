import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  BenchmarkCaseResult,
  BenchmarkSummaryDocument,
} from "./result-types";
import { renderBenchmarkReport } from "./report";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function benchmarkResultsCsv(results: BenchmarkCaseResult[]) {
  const headers = [
    "run_id",
    "status",
    "failure_code",
    "profile",
    "system_name",
    "case_id",
    "query_type",
    "difficulty",
    "latency_ms",
    "retrieval_ms",
    "hydration_ms",
    "validation_ms",
    "recall_at_5",
    "recall_at_10",
    "recall_at_20",
    "fact_recall_at_20",
    "mrr",
    "current_state_accuracy",
    "temporal_order_accuracy",
    "entity_resolution_accuracy",
    "projection_hit",
    "evidence_bandwidth_per_second",
    "fact_bandwidth_per_second",
    "correct_evidence_count",
    "correct_fact_count",
    "measurement_pass",
    "query_ordinal",
    "component_timings_json",
    "tenant_leak_count",
    "unrouted_leak_count",
    "strict_stale_detected",
    "stale_escape",
    "false_conflict",
  ];
  const lines = results.map((result) => {
    const metric = result.metrics;
    return [
      result.runId,
      result.status,
      result.failureCode,
      result.profile,
      result.systemName,
      result.caseId,
      result.queryType,
      result.difficulty,
      result.latencyMs,
      metric?.retrievalMs,
      metric?.hydrationMs,
      metric?.validationMs,
      metric?.recallAt5,
      metric?.recallAt10,
      metric?.recallAt20,
      metric?.factRecallAt20,
      metric?.reciprocalRank,
      metric?.currentStateAccuracy,
      metric?.temporalOrderAccuracy,
      metric?.entityResolutionAccuracy,
      metric?.projectionHit,
      metric?.evidenceBandwidthPerSecond,
      metric?.factBandwidthPerSecond,
      metric?.correctEvidenceCount,
      metric?.correctFactCount,
      metric?.measurementPass,
      metric?.queryOrdinal,
      metric ? JSON.stringify(metric.componentTimingsMs) : null,
      metric?.tenantLeakCount,
      metric?.unroutedLeakCount,
      metric?.strictStaleDetected,
      metric?.staleEscape,
      metric?.falseConflict,
    ].map(csvCell).join(",");
  });
  return `${headers.join(",")}\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export async function writeBenchmarkArtifacts(input: {
  outputDir: string;
  summary: BenchmarkSummaryDocument;
  results: BenchmarkCaseResult[];
}) {
  const summaryPath = join(input.outputDir, "summary.json");
  const resultsPath = join(input.outputDir, "results.csv");
  const reportPath = join(input.outputDir, "report.html");
  await Promise.all([
    atomicWrite(summaryPath, `${JSON.stringify(input.summary, null, 2)}\n`),
    atomicWrite(resultsPath, benchmarkResultsCsv(input.results)),
    atomicWrite(reportPath, renderBenchmarkReport(input.summary)),
  ]);
  return { summaryPath, resultsPath, reportPath };
}

export async function writeBenchmarkReport(input: {
  outputDir: string;
  summary: BenchmarkSummaryDocument;
}) {
  const reportPath = join(input.outputDir, "report.html");
  await atomicWrite(reportPath, renderBenchmarkReport(input.summary));
  return reportPath;
}
