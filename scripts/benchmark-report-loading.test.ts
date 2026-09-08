import assert from "node:assert/strict";
import { loadLatestBenchmarkArtifacts } from "../src/lib/supply-os/benchmark/load-results";
import { evaluateBenchmarkCase } from "../src/lib/supply-os/benchmark/metrics";
import type { BenchmarkSqlClient } from "../src/lib/supply-os/benchmark/database";

async function main() {
  const systems = ["CURRENT_KEYWORD", "DERYA_HOT"];
  const timestamp = "2026-09-08T00:00:00.000Z";
  const runs = systems.flatMap((systemName) => Array.from({ length: 6 }, (_, index) => ({
    id: `${systemName.toLowerCase()}-${String(6 - index).padStart(2, "0")}`,
    profile: "graph-small",
    systemName,
    configurationJson: {
      profile: "graph-small", corpusSize: 10_000, queryCount: 2, topK: 20,
      warmupCount: 3, warmupPassCount: 3, warmupPolicy: "full_corpus_seeded_random",
      concurrency: 4, embeddingModel: "not-configured", embeddingDimensions: null,
      vectorIndex: null, runCount: 6, runIndex: index + 1,
      queryOrderPolicy: "seeded_random_per_pass_shared_across_systems",
      queryOrderSeed: 42, queryOrderHash: `order-${index}`,
      hardwareLabel: "test", runtimeLabel: "test", branch: "test", commitSha: "test",
      workingTreeDirty: false, sourceTreeFingerprint: "a".repeat(64),
      sourceTreeFingerprintAlgorithm: "sha256_git_ls_files_path_bytes_v1",
      sourceTreeFileCount: 1, postgresVersion: "17.5", postgresStatementTimeout: "10min",
      timestamp, databaseLabel: "isolated_test", status: "completed",
    },
    startedAt: timestamp, completedAt: timestamp, summaryMetricsJson: {},
  })));
  const metrics = evaluateBenchmarkCase({
    queryType: "exact", goldFacts: [], goldEvidence: [], retrievedFacts: [],
    retrievedEvidence: [], retrievalMs: 10, hydrationMs: 10, validationMs: null,
  });
  const rows = runs.flatMap((run) => ["case-z", "case-a"].map((caseId) => ({
    runId: run.id, caseId, profile: run.profile, systemName: run.systemName,
    queryType: "exact", difficulty: "easy", latencyMs: 10,
    retrievedFactsJson: [], retrievedEvidenceJson: [], validationResultJson: null,
    metricsJson: { ...metrics, executionStatus: "completed" },
  })));
  const batches: string[][] = [];
  const database = {
    async $queryRawUnsafe(query: string, runIdsJson: string) {
      if (query.includes("FROM benchmark.runs")) return runs;
      assert.ok(query.includes("FROM benchmark.results AS result"));
      const ids = JSON.parse(runIdsJson) as string[];
      assert.ok(ids.length <= 5, "Each database transfer must stay bounded.");
      batches.push(ids);
      return rows.filter((row) => ids.includes(row.runId));
    },
    async $executeRawUnsafe() { throw new Error("Report loading must be read-only."); },
  } as unknown as BenchmarkSqlClient;

  const output = await loadLatestBenchmarkArtifacts(database);
  assert.deepEqual(batches.map((batch) => batch.length), [5, 5, 2]);
  assert.equal(new Set(batches.flat()).size, runs.length);
  assert.equal(output.results.length, 24);
  assert.equal(output.summary.runs.length, 12);
  assert.ok(output.summary.runs.every((run) => run.configuration.status === "completed"));
  assert.ok(output.summary.runs.every((run) => run.metrics?.caseCount === 2));
  assert.deepEqual(
    output.results.map((row) => `${row.profile}/${row.systemName}/${row.runId}/${row.caseId}`),
    rows.map((row) => `${row.profile}/${row.systemName}/${row.runId}/${row.caseId}`).sort(),
    "Batch boundaries must not change the original global artifact order.",
  );

  let resultReads = 0;
  const failingDatabase = {
    ...database,
    async $queryRawUnsafe(query: string, ids: string) {
      if (query.includes("FROM benchmark.results AS result") && ++resultReads === 2) {
        throw new Error("batch unavailable");
      }
      return database.$queryRawUnsafe(query, ids);
    },
  } as BenchmarkSqlClient;
  await assert.rejects(loadLatestBenchmarkArtifacts(failingDatabase), /batch unavailable/);
  console.log("Benchmark report batching, metric preservation, ordering, and failure tests passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
