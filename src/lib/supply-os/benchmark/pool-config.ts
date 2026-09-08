export type BenchmarkPrismaPoolConfiguration = {
  connectionLimit: number;
  poolTimeoutSeconds: number;
  source: "benchmark_url_query_parameters_v1" | "legacy_unknown";
  appliedTo: readonly string[];
};

// A measured case can fan out into several source reads. This benchmark-only
// pool adds headroom for that internal fanout without changing case concurrency.
export const BENCHMARK_PRISMA_POOL_CONFIGURATION: BenchmarkPrismaPoolConfiguration = Object.freeze({
  connectionLimit: 32,
  poolTimeoutSeconds: 120,
  source: "benchmark_url_query_parameters_v1",
  appliedTo: Object.freeze(["app", "app_unpooled", "workflow"]),
});

export function benchmarkPrismaDatabaseUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("connection_limit", String(BENCHMARK_PRISMA_POOL_CONFIGURATION.connectionLimit));
  parsed.searchParams.set("pool_timeout", String(BENCHMARK_PRISMA_POOL_CONFIGURATION.poolTimeoutSeconds));
  return parsed.toString();
}
