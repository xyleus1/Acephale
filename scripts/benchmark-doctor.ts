import "dotenv/config";
import {
  benchmarkProfilesFromArguments,
  loadBenchmarkConfig,
  safeBenchmarkErrorMessage,
} from "../src/lib/supply-os/benchmark/config";
import { createBenchmarkClients } from "../src/lib/supply-os/benchmark/database";
import { runBenchmarkDoctor } from "../src/lib/supply-os/benchmark/doctor";

async function main() {
  const profiles = benchmarkProfilesFromArguments(process.argv.slice(2));
  const config = loadBenchmarkConfig();
  const clients = createBenchmarkClients(config);
  try {
    const reports = [];
    for (const profile of profiles) {
      reports.push(await runBenchmarkDoctor({ config, profile, clients }));
    }
    const output = {
      ok: reports.every((report) => report.ok),
      profiles: reports,
    };
    console.log(JSON.stringify(output, null, 2));
    if (!output.ok) process.exitCode = 1;
  } finally {
    await clients.disconnect();
  }
}

main().catch((error) => {
  console.error(`Benchmark doctor failed: ${safeBenchmarkErrorMessage(error)}`);
  process.exitCode = 1;
});
