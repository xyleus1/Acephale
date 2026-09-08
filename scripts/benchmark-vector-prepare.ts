import "dotenv/config";

import {
  benchmarkProfileFromArguments,
  loadBenchmarkConfig,
  safeBenchmarkErrorMessage,
} from "../src/lib/supply-os/benchmark/config";

function booleanArgument(arguments_: readonly string[], name: string, fallback: boolean) {
  const prefix = `--${name}=`;
  const raw = arguments_.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
    ?? process.env[`npm_config_${name.replaceAll("-", "_")}`];
  if (raw == null) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`--${name} must be true or false.`);
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const profile = benchmarkProfileFromArguments(arguments_);
  const config = loadBenchmarkConfig();
  const [{ assertBenchmarkClientRoles, createBenchmarkClients }, { runBenchmarkDoctor }] = await Promise.all([
    import("../src/lib/supply-os/benchmark/database"),
    import("../src/lib/supply-os/benchmark/doctor"),
  ]);
  const clients = createBenchmarkClients(config);
  try {
    await assertBenchmarkClientRoles(config, clients);
    const doctor = await runBenchmarkDoctor({ config, profile, clients });
    if (!doctor.ok) {
      throw new Error(`Benchmark doctor failed: ${doctor.failures.map((failure) => failure.code).join(", ")}.`);
    }
    const { prepareLocalBenchmarkVectorIndex } = await import(
      "../src/lib/supply-os/benchmark/local-vector"
    );
    const prepared = await prepareLocalBenchmarkVectorIndex({
      config,
      database: clients.app,
      profile,
      installRuntime: true,
      downloadModel: true,
      // npm reserves `--rebuild`, so npm-run callers use `--force-rebuild`.
      // Keep the shorter spelling for direct `node ...` invocations.
      rebuild: booleanArgument(
        arguments_,
        "force-rebuild",
        booleanArgument(arguments_, "rebuild", false),
      ),
      onProgress(progress) {
        console.log(JSON.stringify(progress));
      },
    });
    console.log(JSON.stringify({
      ok: true,
      databaseName: config.databaseName,
      profile,
      reused: prepared.reused,
      runtimeInstalled: prepared.runtimeInstalled,
      model: prepared.manifest.model,
      chunkCount: prepared.manifest.chunkCount,
      corpusFingerprint: prepared.manifest.corpusFingerprint,
      buildMs: prepared.manifest.buildMs,
      builtAt: prepared.manifest.builtAt,
      vectorBytes: prepared.manifest.vectorFile.bytes,
    }, null, 2));
  } finally {
    await clients.disconnect();
  }
}

main().catch((error) => {
  console.error(`Benchmark vector preparation failed: ${safeBenchmarkErrorMessage(error)}`);
  process.exitCode = 1;
});
