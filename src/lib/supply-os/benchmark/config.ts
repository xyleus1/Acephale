import { resolve } from "node:path";
import {
  BENCHMARK_OFFICE_ID_PREFIX,
  BENCHMARK_OFFICE_NAME_PREFIX,
  BENCHMARK_PROFILE_RETRIEVABLE_TARGETS,
  BENCHMARK_PROFILES,
  type BenchmarkProfile,
} from "./types";

export {
  BENCHMARK_OFFICE_ID_PREFIX,
  BENCHMARK_OFFICE_NAME_PREFIX,
  BENCHMARK_PROFILE_RETRIEVABLE_TARGETS,
  BENCHMARK_PROFILES,
};
export type { BenchmarkProfile };

export const BENCHMARK_DATABASE_ENVIRONMENT_KEYS = [
  "BENCHMARK_DATABASE_OWNER_URL",
  "BENCHMARK_APP_DATABASE_URL",
  "BENCHMARK_APP_DATABASE_URL_UNPOOLED",
  "BENCHMARK_WORKFLOW_DATABASE_URL",
  "BENCHMARK_BOURNE_DATABASE_URL",
] as const;

export const BENCHMARK_ENVIRONMENT_KEYS = [
  ...BENCHMARK_DATABASE_ENVIRONMENT_KEYS,
  "BENCHMARK_OUTPUT_DIR",
] as const;

type BenchmarkEnvironmentKey = (typeof BENCHMARK_ENVIRONMENT_KEYS)[number];
type Environment = Readonly<Record<string, string | undefined>>;

export type ParsedBenchmarkDatabaseUrl = {
  environmentKey: (typeof BENCHMARK_DATABASE_ENVIRONMENT_KEYS)[number];
  value: string;
  databaseName: string;
  username: string;
  hostname: string;
  port: string;
};

export type BenchmarkConfig = {
  ownerDatabaseUrl: string;
  appDatabaseUrl: string;
  appDatabaseUrlUnpooled: string;
  workflowDatabaseUrl: string;
  bourneDatabaseUrl: string;
  outputDir: string;
  databaseName: string;
};

export class BenchmarkConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkConfigurationError";
  }
}

function requiredEnvironment(environment: Environment, key: BenchmarkEnvironmentKey) {
  const value = environment[key]?.trim();
  if (!value) {
    throw new BenchmarkConfigurationError(`${key} is required. Benchmark configuration never falls back to application database settings.`);
  }
  return value;
}

function databaseNameFromUrl(url: URL, key: string) {
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw new BenchmarkConfigurationError(`${key} has an invalid encoded database name.`);
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new BenchmarkConfigurationError(`${key} must identify exactly one PostgreSQL database.`);
  }
  return databaseName;
}

function normalizedHost(hostname: string) {
  return hostname.toLowerCase().replace(/-pooler(?=\.)/g, "");
}

function parsePostgresUrl(key: string, value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BenchmarkConfigurationError(`${key} must be a valid PostgreSQL URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new BenchmarkConfigurationError(`${key} must use the postgres or postgresql protocol.`);
  }
  if (!url.hostname || !url.username) {
    throw new BenchmarkConfigurationError(`${key} must include a hostname and database role.`);
  }
  return {
    url,
    databaseName: databaseNameFromUrl(url, key),
    username: decodeURIComponent(url.username),
    hostname: normalizedHost(url.hostname),
    port: url.port || "5432",
  };
}

function requireSafeDatabaseName(key: string, databaseName: string) {
  if (!/(?:^|[_-])(?:benchmark|bench|synthetic|test)(?:$|[_-])/i.test(databaseName)) {
    throw new BenchmarkConfigurationError(
      `${key} database name must contain benchmark, bench, synthetic, or test.`,
    );
  }
}

function requireRole(key: string, actual: string, expected: string) {
  if (actual !== expected) {
    throw new BenchmarkConfigurationError(`${key} must use the ${expected} role.`);
  }
}

function requireWorkflowSsl(key: string, url: URL) {
  const sslMode = url.searchParams.get("sslmode")?.trim().toLowerCase();
  if (sslMode !== "require" && sslMode !== "verify-ca" && sslMode !== "verify-full") {
    throw new BenchmarkConfigurationError(`${key} must require PostgreSQL SSL.`);
  }
}

function couldBeSameDatabase(
  benchmark: Pick<ParsedBenchmarkDatabaseUrl, "databaseName" | "hostname" | "port">,
  normal: { databaseName: string; hostname: string; port: string },
) {
  return benchmark.databaseName.toLowerCase() === normal.databaseName.toLowerCase()
    && benchmark.hostname === normal.hostname
    && benchmark.port === normal.port;
}

export function parseBenchmarkProfile(value: string | undefined): BenchmarkProfile {
  const profile = value?.trim().toLowerCase();
  if (profile && BENCHMARK_PROFILES.includes(profile as BenchmarkProfile)) {
    return profile as BenchmarkProfile;
  }
  throw new BenchmarkConfigurationError(
    `Benchmark profile must be one of ${BENCHMARK_PROFILES.join(", ")}.`,
  );
}

export function benchmarkProfileFromArguments(
  arguments_: readonly string[],
  environment: Environment = process.env,
) {
  const profileArgument = arguments_.find((argument) => argument.startsWith("--profile="));
  return parseBenchmarkProfile(
    profileArgument?.slice("--profile=".length) ?? environment.npm_config_profile,
  );
}

export function benchmarkProfilesFromArguments(
  arguments_: readonly string[],
  environment: Environment = process.env,
) {
  const profileArgument = arguments_.find((argument) => argument.startsWith("--profile="));
  const profile = profileArgument?.slice("--profile=".length) ?? environment.npm_config_profile;
  return profile
    ? [parseBenchmarkProfile(profile)]
    : [...BENCHMARK_PROFILES];
}

export function parseBenchmarkDatabaseUrl(
  environmentKey: (typeof BENCHMARK_DATABASE_ENVIRONMENT_KEYS)[number],
  value: string,
): ParsedBenchmarkDatabaseUrl {
  const parsed = parsePostgresUrl(environmentKey, value);
  requireSafeDatabaseName(environmentKey, parsed.databaseName);
  return {
    environmentKey,
    value,
    databaseName: parsed.databaseName,
    username: parsed.username,
    hostname: parsed.hostname,
    port: parsed.port,
  };
}

export function loadBenchmarkConfig(environment: Environment = process.env): BenchmarkConfig {
  const values = Object.fromEntries(
    BENCHMARK_ENVIRONMENT_KEYS.map((key) => [key, requiredEnvironment(environment, key)]),
  ) as Record<BenchmarkEnvironmentKey, string>;

  const owner = parseBenchmarkDatabaseUrl("BENCHMARK_DATABASE_OWNER_URL", values.BENCHMARK_DATABASE_OWNER_URL);
  const app = parseBenchmarkDatabaseUrl("BENCHMARK_APP_DATABASE_URL", values.BENCHMARK_APP_DATABASE_URL);
  const appUnpooled = parseBenchmarkDatabaseUrl(
    "BENCHMARK_APP_DATABASE_URL_UNPOOLED",
    values.BENCHMARK_APP_DATABASE_URL_UNPOOLED,
  );
  const workflow = parseBenchmarkDatabaseUrl(
    "BENCHMARK_WORKFLOW_DATABASE_URL",
    values.BENCHMARK_WORKFLOW_DATABASE_URL,
  );
  const bourne = parseBenchmarkDatabaseUrl("BENCHMARK_BOURNE_DATABASE_URL", values.BENCHMARK_BOURNE_DATABASE_URL);

  if (["derya_app", "dashboard_api", "bourne_supply_chain"].includes(owner.username)) {
    throw new BenchmarkConfigurationError(
      "BENCHMARK_DATABASE_OWNER_URL must use a distinct database owner role.",
    );
  }
  requireRole(app.environmentKey, app.username, "derya_app");
  requireRole(appUnpooled.environmentKey, appUnpooled.username, "derya_app");
  requireRole(workflow.environmentKey, workflow.username, "dashboard_api");
  requireRole(bourne.environmentKey, bourne.username, "bourne_supply_chain");
  requireWorkflowSsl(workflow.environmentKey, new URL(workflow.value));

  const benchmarkUrls = [owner, app, appUnpooled, workflow, bourne];
  const databaseNames = new Set(benchmarkUrls.map((entry) => entry.databaseName.toLowerCase()));
  if (databaseNames.size !== 1) {
    throw new BenchmarkConfigurationError("All benchmark role URLs must identify the same benchmark database name.");
  }
  const databaseTargets = new Set(benchmarkUrls.map((entry) => (
    `${entry.hostname}:${entry.port}/${entry.databaseName.toLowerCase()}`
  )));
  if (databaseTargets.size !== 1) {
    throw new BenchmarkConfigurationError(
      "All benchmark role URLs must identify the same benchmark database host, port, and name.",
    );
  }

  for (const normalKey of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "WORKFLOW_DATABASE_URL"] as const) {
    const normalValue = environment[normalKey]?.trim();
    if (!normalValue) continue;
    const normal = parsePostgresUrl(normalKey, normalValue);
    for (const benchmark of benchmarkUrls) {
      if (benchmark.value === normalValue || couldBeSameDatabase(benchmark, normal)) {
        throw new BenchmarkConfigurationError(
          `${benchmark.environmentKey} must not identify the database configured by ${normalKey}.`,
        );
      }
    }
  }

  return {
    ownerDatabaseUrl: owner.value,
    appDatabaseUrl: app.value,
    appDatabaseUrlUnpooled: appUnpooled.value,
    workflowDatabaseUrl: workflow.value,
    bourneDatabaseUrl: bourne.value,
    outputDir: resolve(values.BENCHMARK_OUTPUT_DIR),
    databaseName: owner.databaseName,
  };
}

export function validateBenchmarkConfig(
  config: BenchmarkConfig,
  environment: Environment = process.env,
) {
  const validated = loadBenchmarkConfig({
    ...environment,
    BENCHMARK_DATABASE_OWNER_URL: config.ownerDatabaseUrl,
    BENCHMARK_APP_DATABASE_URL: config.appDatabaseUrl,
    BENCHMARK_APP_DATABASE_URL_UNPOOLED: config.appDatabaseUrlUnpooled,
    BENCHMARK_WORKFLOW_DATABASE_URL: config.workflowDatabaseUrl,
    BENCHMARK_BOURNE_DATABASE_URL: config.bourneDatabaseUrl,
    BENCHMARK_OUTPUT_DIR: config.outputDir,
  });
  if (validated.databaseName !== config.databaseName) {
    throw new BenchmarkConfigurationError("Benchmark configuration database name does not match its owner URL.");
  }
  return validated;
}

export function assertBenchmarkResetAllowed(environment: Environment = process.env) {
  if (environment.ALLOW_BENCHMARK_RESET?.trim() !== "1") {
    throw new BenchmarkConfigurationError("Benchmark reset requires ALLOW_BENCHMARK_RESET=1.");
  }
}

export function benchmarkConfigSummary(config: BenchmarkConfig) {
  return {
    databaseName: config.databaseName,
    outputDir: config.outputDir,
    roles: {
      app: "derya_app",
      workflow: "dashboard_api",
      bourne: "bourne_supply_chain",
    },
  };
}

export function safeBenchmarkErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[redacted database URL]");
}
