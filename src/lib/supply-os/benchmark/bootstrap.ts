import {
  type BenchmarkConfig,
  validateBenchmarkConfig,
} from "./config";
import {
  BENCHMARK_PRISMA_POOL_CONFIGURATION,
  benchmarkPrismaDatabaseUrl,
} from "./pool-config";

export type BenchmarkRuntimeFlags = {
  stateRuntimeEnabled: boolean;
  projectionsEnabled: boolean;
  validationMode: "off" | "shadow" | "enforce";
  retrievalV2Enabled: boolean;
  vectorRetrievalEnabled: boolean;
};

export const DEFAULT_BENCHMARK_RUNTIME_FLAGS: BenchmarkRuntimeFlags = {
  stateRuntimeEnabled: false,
  projectionsEnabled: false,
  validationMode: "off",
  retrievalV2Enabled: false,
  vectorRetrievalEnabled: false,
};

export function applyBenchmarkRuntimeFlags(
  flagsInput: Partial<BenchmarkRuntimeFlags>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const flags = {
    ...DEFAULT_BENCHMARK_RUNTIME_FLAGS,
    ...flagsInput,
  };
  if (!(["off", "shadow", "enforce"] as const).includes(flags.validationMode)) {
    throw new Error("Benchmark validation mode must be off, shadow, or enforce.");
  }
  environment.SUPPLY_STATE_RUNTIME_ENABLED = String(flags.stateRuntimeEnabled);
  environment.SUPPLY_STATE_PROJECTIONS_ENABLED = String(flags.projectionsEnabled);
  environment.SUPPLY_STATE_VALIDATION_MODE = flags.validationMode;
  environment.MEMORY_RETRIEVAL_V2_ENABLED = String(flags.retrievalV2Enabled);
  environment.MEMORY_VECTOR_SEARCH_ENABLED = String(flags.vectorRetrievalEnabled);
  environment.MEMORY_VECTOR_RETRIEVAL_ENABLED = String(flags.vectorRetrievalEnabled);
  return flags;
}

function serializeCustomerMapping(mapping: string | Readonly<Record<string, string>>) {
  let parsed: unknown;
  if (typeof mapping === "string") {
    try {
      parsed = JSON.parse(mapping);
    } catch {
      throw new Error("Benchmark procurement customer mapping must be valid JSON.");
    }
  } else {
    parsed = mapping;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Benchmark procurement customer mapping must be a JSON object.");
  }
  const entries = Object.entries(parsed);
  if (!entries.length || entries.some(([officeId, customerId]) => !officeId.trim() || typeof customerId !== "string" || !customerId.trim())) {
    throw new Error("Benchmark procurement customer mapping must contain non-empty office and customer IDs.");
  }
  return JSON.stringify(Object.fromEntries(entries));
}

export function bootstrapBenchmarkEnvironment(args: {
  config: BenchmarkConfig;
  procurementCustomerMapping: string | Readonly<Record<string, string>>;
  flags?: Partial<BenchmarkRuntimeFlags>;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = args.environment ?? process.env;
  const config = validateBenchmarkConfig(args.config, environment);
  const customerMapping = serializeCustomerMapping(args.procurementCustomerMapping);
  const flags = applyBenchmarkRuntimeFlags(args.flags ?? {}, environment);

  environment.DATABASE_URL = benchmarkPrismaDatabaseUrl(config.appDatabaseUrl);
  environment.DATABASE_URL_UNPOOLED = benchmarkPrismaDatabaseUrl(config.appDatabaseUrlUnpooled);
  environment.WORKFLOW_DATABASE_URL = benchmarkPrismaDatabaseUrl(config.workflowDatabaseUrl);
  environment.PROCUREMENT_CUSTOMER_MAP_JSON = customerMapping;

  return {
    databaseName: config.databaseName,
    flags,
    prismaPoolConfiguration: BENCHMARK_PRISMA_POOL_CONFIGURATION,
    mappedOfficeCount: Object.keys(JSON.parse(customerMapping) as Record<string, string>).length,
  };
}
