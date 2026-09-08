import "dotenv/config";

import {
  loadBenchmarkConfig,
  safeBenchmarkErrorMessage,
} from "../src/lib/supply-os/benchmark/config";

async function main() {
  const config = loadBenchmarkConfig();
  const [{ createBenchmarkClients, assertBenchmarkClientRoles }, { loadLatestBenchmarkArtifacts }, { writeBenchmarkArtifacts }] = await Promise.all([
    import("../src/lib/supply-os/benchmark/database"),
    import("../src/lib/supply-os/benchmark/load-results"),
    import("../src/lib/supply-os/benchmark/outputs"),
  ]);
  const clients = createBenchmarkClients(config);
  try {
    await assertBenchmarkClientRoles(config, clients);
    const measured = await loadLatestBenchmarkArtifacts(clients.app);
    const artifacts = await writeBenchmarkArtifacts({
      outputDir: config.outputDir,
      ...measured,
    });
    const failedRuns = measured.summary.runs.filter((run) => run.configuration.status === "failed");
    console.log(JSON.stringify({
      ok: failedRuns.length === 0,
      profileCount: new Set(measured.summary.runs.map((run) => run.profile)).size,
      artifacts,
    }, null, 2));
    if (failedRuns.length) process.exitCode = 1;
  } finally {
    await clients.disconnect();
  }
}

main().catch((error) => {
  console.error(`Benchmark report failed: ${safeBenchmarkErrorMessage(error)}`);
  process.exitCode = 1;
});
