import "dotenv/config";

import {
  benchmarkProfileFromArguments,
  loadBenchmarkConfig,
  safeBenchmarkErrorMessage,
} from "../src/lib/supply-os/benchmark/config";
import {
  assertBenchmarkClientRoles,
  createBenchmarkClients,
} from "../src/lib/supply-os/benchmark/database";
import { runBenchmarkDoctor } from "../src/lib/supply-os/benchmark/doctor";
import { seedCommercialStateBenchmark } from "../src/lib/supply-os/benchmark/seed";

function benchmarkSeed(
  arguments_: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const argument = arguments_.find((value) => value.startsWith("--seed="));
  const configured = argument?.slice("--seed=".length) ?? environment.npm_config_seed;
  if (!configured) throw new Error("Benchmark seed requires --seed=42.");
  const seed = Number(configured);
  if (!Number.isSafeInteger(seed) || seed !== 42) {
    throw new Error("Commercial State Benchmark V1 is a fixed scripted corpus and supports only --seed=42.");
  }
  return seed;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const profile = benchmarkProfileFromArguments(arguments_);
  const seed = benchmarkSeed(arguments_);
  const config = loadBenchmarkConfig();
  const clients = createBenchmarkClients(config);
  try {
    await assertBenchmarkClientRoles(config, clients);
    const manifest = await seedCommercialStateBenchmark({ clients, profile });
    const doctor = await runBenchmarkDoctor({ config, profile, clients });
    console.log(JSON.stringify({
      ok: doctor.ok,
      profile,
      seed,
      scenarioCount: manifest.scenarioCount,
      queryCount: manifest.caseCount,
      concurrencyCaseCount: manifest.concurrencyCaseCount,
      entityCounts: manifest.entityCounts,
      retrievableCounts: manifest.retrievableCounts,
      doctorFailures: doctor.failures,
    }, null, 2));
    if (!doctor.ok) process.exitCode = 1;
  } finally {
    await clients.disconnect();
  }
}

main().catch((error) => {
  console.error(`Benchmark seed failed: ${safeBenchmarkErrorMessage(error)}`);
  process.exitCode = 1;
});
