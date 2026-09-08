import "dotenv/config";

import { createHash } from "node:crypto";

import { bootstrapBenchmarkEnvironment } from "../src/lib/supply-os/benchmark/bootstrap";
import {
  benchmarkProfileFromArguments,
  loadBenchmarkConfig,
  safeBenchmarkErrorMessage,
} from "../src/lib/supply-os/benchmark/config";
import { benchmarkSourceTreeFingerprint } from "../src/lib/supply-os/benchmark/source-tree";

function argumentValue(arguments_: readonly string[], name: string) {
  const prefix = `--${name}=`;
  const explicit = arguments_.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (explicit != null) return explicit;
  const npmConfigName = `npm_config_${name.replaceAll("-", "_")}`;
  return process.env[npmConfigName];
}

function integerArgument(
  arguments_: readonly string[],
  name: string,
  fallback: number,
) {
  const value = argumentValue(arguments_, name);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`);
  return parsed;
}

function integerArgumentAliases(
  arguments_: readonly string[],
  names: readonly string[],
  fallback: number,
) {
  for (const name of names) {
    if (argumentValue(arguments_, name) != null) return integerArgument(arguments_, name, fallback);
  }
  return fallback;
}

function booleanArgument(arguments_: readonly string[], name: string, fallback: boolean) {
  const value = argumentValue(arguments_, name)?.trim().toLowerCase();
  if (value == null) return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`--${name} must be true or false.`);
}

async function hardwareLabel() {
  const os = await import("node:os");
  const processor = os.cpus()[0]?.model?.replace(/\s+/g, " ").trim() || "unknown CPU";
  const memoryGiB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  return `${os.platform()} ${os.release()}; ${processor}; ${memoryGiB} GiB; ${os.cpus().length} logical CPUs`;
}

async function gitMetadata() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const value = async (arguments_: string[]) => (
    (await run("git", arguments_, { cwd: process.cwd(), windowsHide: true })).stdout.trim()
  );
  const [branch, commitSha, status, sourceTree] = await Promise.all([
    value(["branch", "--show-current"]),
    value(["rev-parse", "HEAD"]),
    value(["status", "--porcelain"]),
    benchmarkSourceTreeFingerprint(process.cwd()),
  ]);
  return {
    branch: branch || "detached",
    commitSha,
    workingTreeDirty: Boolean(status),
    sourceTreeFingerprint: sourceTree.sha256,
    sourceTreeFingerprintAlgorithm: sourceTree.algorithm,
    sourceTreeFileCount: sourceTree.fileCount,
  };
}

function vectorIndexConfiguration(manifest: {
  schemaVersion: number;
  profile: string;
  seedVersion: string;
  model: {
    id: string;
    revision: string;
    dtype: string;
    dimensions: number;
    runtimePackage: string;
    runtimeVersion: string;
    files: Array<{ bytes: number; sha256: string }>;
  };
  chunkCount: number;
  corpusFingerprint: string;
  vectorFile: { bytes: number; sha256: string };
  metadataFile: { bytes: number; sha256: string };
  buildMs: number;
  builtAt: string;
}) {
  return {
    schemaVersion: manifest.schemaVersion,
    profile: manifest.profile,
    seedVersion: manifest.seedVersion,
    modelId: manifest.model.id,
    modelRevision: manifest.model.revision,
    modelDtype: manifest.model.dtype,
    dimensions: manifest.model.dimensions,
    runtimePackage: manifest.model.runtimePackage,
    runtimeVersion: manifest.model.runtimeVersion,
    modelAssets: manifest.model.files.map(({ bytes, sha256 }) => ({ bytes, sha256 })),
    indexChunkCount: manifest.chunkCount,
    corpusFingerprint: manifest.corpusFingerprint,
    vectorAsset: {
      bytes: manifest.vectorFile.bytes,
      sha256: manifest.vectorFile.sha256,
    },
    metadataAsset: {
      bytes: manifest.metadataFile.bytes,
      sha256: manifest.metadataFile.sha256,
    },
    buildMs: manifest.buildMs,
    builtAt: manifest.builtAt,
    manifestHash: createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex"),
  };
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const profile = benchmarkProfileFromArguments(arguments_);
  const config = loadBenchmarkConfig();
  const vectorEnabled = booleanArgument(arguments_, "vector-enabled", false);
  const repository = await gitMetadata();
  const {
    assertBenchmarkClientRoles,
    createBenchmarkClients,
  } = await import("../src/lib/supply-os/benchmark/database");
  const clients = createBenchmarkClients(config);
  let runtimeImported = false;
  try {
    await assertBenchmarkClientRoles(config, clients);
    const { runBenchmarkDoctor } = await import("../src/lib/supply-os/benchmark/doctor");
    const doctor = await runBenchmarkDoctor({ config, profile, clients });
    if (!doctor.ok) {
      throw new Error(`Benchmark doctor failed: ${doctor.failures.map((failure) => failure.code).join(", ")}.`);
    }
    const { loadBenchmarkProcurementCustomerMapping } = await import(
      "../src/lib/supply-os/benchmark/persistence"
    );
    const customerMapping = await loadBenchmarkProcurementCustomerMapping({
      database: clients.app,
      profile,
    });
    bootstrapBenchmarkEnvironment({
      config,
      procurementCustomerMapping: customerMapping,
      flags: {
        stateRuntimeEnabled: true,
        projectionsEnabled: true,
        validationMode: "enforce",
        retrievalV2Enabled: true,
        vectorRetrievalEnabled: vectorEnabled,
      },
    });

    const [{ createDeryaBenchmarkExecutor }, { runCommercialStateBenchmark }, { parseBenchmarkSystemNames }] = await Promise.all([
      import("../src/lib/supply-os/benchmark/runtime"),
      import("../src/lib/supply-os/benchmark/runner"),
      import("../src/lib/supply-os/benchmark/systems"),
    ]);
    runtimeImported = true;
    const vectorRetriever = vectorEnabled
      ? await import("../src/lib/supply-os/benchmark/local-vector").then(({ createLocalBenchmarkVectorRetriever }) => (
        createLocalBenchmarkVectorRetriever({ config, database: clients.app, profile })
      ))
      : null;
    const embeddingModelArgument = argumentValue(arguments_, "embedding-model")?.trim();
    if (vectorRetriever && embeddingModelArgument && embeddingModelArgument !== vectorRetriever.name) {
      throw new Error(
        `--embedding-model must match the prepared retriever label ${vectorRetriever.name}.`,
      );
    }
    const systems = parseBenchmarkSystemNames(argumentValue(arguments_, "systems"));
    const result = await runCommercialStateBenchmark({
      config,
      database: clients.app,
      executor: createDeryaBenchmarkExecutor({ vectorRetriever }),
      procurementCustomerMapping: customerMapping,
      options: {
        profile,
        systems,
        topK: integerArgument(arguments_, "top-k", 20),
        warmupCount: integerArgumentAliases(arguments_, ["warmup-passes", "warmup"], 3),
        concurrency: integerArgument(arguments_, "concurrency", 4),
        runCount: integerArgument(arguments_, "runs", 10),
        randomSeed: integerArgument(arguments_, "seed", 42),
        embeddingModel: vectorRetriever?.name ?? embeddingModelArgument ?? "not-configured",
        embeddingDimensions: vectorRetriever?.manifest.model.dimensions ?? null,
        vectorIndex: vectorRetriever ? vectorIndexConfiguration(vectorRetriever.manifest) : null,
        hardwareLabel: argumentValue(arguments_, "hardware-label")?.trim() || await hardwareLabel(),
        runtimeLabel: argumentValue(arguments_, "runtime-label")?.trim() || `node ${process.version} ${process.arch}`,
        ...repository,
        vectorEnabled,
      },
      onProgress(progress) {
        console.log(JSON.stringify(progress));
      },
    });
    const failedRuns = result.summary.runs.filter((run) => run.configuration.status === "failed");
    console.log(JSON.stringify({
      ok: failedRuns.length === 0,
      databaseName: config.databaseName,
      profile,
      postgresStatementTimeout: result.summary.configurations[0]?.postgresStatementTimeout ?? "unknown",
      prismaPoolConfiguration: result.summary.configurations[0]?.prismaPoolConfiguration ?? null,
      sourceTreeFingerprint: result.summary.configurations[0]?.sourceTreeFingerprint ?? "unknown",
      measuredCases: result.results.filter((entry) => entry.status === "completed").length,
      failedCases: result.results.filter((entry) => entry.status === "failed").length,
      skippedCases: result.results.filter((entry) => entry.status === "skipped").length,
      artifacts: result.artifacts,
    }, null, 2));
    if (failedRuns.length) process.exitCode = 1;
  } finally {
    if (runtimeImported) {
      const { prisma } = await import("../src/lib/prisma");
      await prisma.$disconnect();
    }
    await clients.disconnect();
  }
}

main().catch((error) => {
  console.error(`Benchmark run failed: ${safeBenchmarkErrorMessage(error)}`);
  process.exitCode = 1;
});
