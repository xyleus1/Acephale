import { PrismaClient } from "@prisma/client";
import {
  type BenchmarkConfig,
  BenchmarkConfigurationError,
  validateBenchmarkConfig,
} from "./config";
import { benchmarkPrismaDatabaseUrl } from "./pool-config";

export type BenchmarkSqlClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

export type DisconnectableBenchmarkSqlClient = BenchmarkSqlClient & {
  $disconnect(): Promise<void>;
};

export type BenchmarkClients = {
  owner: DisconnectableBenchmarkSqlClient;
  app: DisconnectableBenchmarkSqlClient;
  appUnpooled: DisconnectableBenchmarkSqlClient;
  dashboard: DisconnectableBenchmarkSqlClient;
  bourne: DisconnectableBenchmarkSqlClient;
  disconnect(): Promise<void>;
};

export type BenchmarkConnectionIdentity = {
  databaseName: string;
  role: string;
};

export type BenchmarkPostgresRuntimeConfiguration = {
  version: string;
  statementTimeout: string;
};

type ClientFactory = (databaseUrl: string) => DisconnectableBenchmarkSqlClient;

function prismaClient(databaseUrl: string): DisconnectableBenchmarkSqlClient {
  return new PrismaClient({ datasourceUrl: databaseUrl, log: [] }) as DisconnectableBenchmarkSqlClient;
}

export async function inspectBenchmarkConnection(
  client: BenchmarkSqlClient,
): Promise<BenchmarkConnectionIdentity> {
  const rows = await client.$queryRawUnsafe<Array<{
    databaseName: string;
    role: string;
  }>>(`
    SELECT
      current_database()::text AS "databaseName",
      current_user::text AS role
  `);
  const identity = rows[0];
  if (!identity?.databaseName || !identity.role) {
    throw new BenchmarkConfigurationError("Benchmark database connection identity could not be verified.");
  }
  return identity;
}

export async function inspectBenchmarkPostgresRuntimeConfiguration(
  client: BenchmarkSqlClient,
): Promise<BenchmarkPostgresRuntimeConfiguration> {
  const rows = await client.$queryRawUnsafe<Array<BenchmarkPostgresRuntimeConfiguration>>(`
    SELECT
      current_setting('server_version')::text AS version,
      current_setting('statement_timeout')::text AS "statementTimeout"
  `);
  const configuration = rows[0];
  if (!configuration?.version || !configuration.statementTimeout) {
    throw new BenchmarkConfigurationError("Benchmark app session runtime settings could not be verified.");
  }
  return configuration;
}

export async function assertBenchmarkConnection(
  client: BenchmarkSqlClient,
  expectation: { databaseName: string; role?: string },
) {
  const identity = await inspectBenchmarkConnection(client);
  if (identity.databaseName !== expectation.databaseName) {
    throw new BenchmarkConfigurationError(
      `Benchmark connection reached database ${identity.databaseName}, expected ${expectation.databaseName}.`,
    );
  }
  if (!/(?:^|[_-])(?:benchmark|bench|synthetic|test)(?:$|[_-])/i.test(identity.databaseName)) {
    throw new BenchmarkConfigurationError("Connected database name is not benchmark-safe.");
  }
  if (expectation.role && identity.role !== expectation.role) {
    throw new BenchmarkConfigurationError(
      `Benchmark connection uses role ${identity.role}, expected ${expectation.role}.`,
    );
  }
  return identity;
}

export function createBenchmarkClients(
  config: BenchmarkConfig,
  options: { environment?: Readonly<Record<string, string | undefined>>; clientFactory?: ClientFactory } = {},
): BenchmarkClients {
  const validated = validateBenchmarkConfig(config, options.environment ?? process.env);
  const factory = options.clientFactory ?? prismaClient;
  const clients = [
    factory(validated.ownerDatabaseUrl),
    factory(benchmarkPrismaDatabaseUrl(validated.appDatabaseUrl)),
    factory(benchmarkPrismaDatabaseUrl(validated.appDatabaseUrlUnpooled)),
    factory(benchmarkPrismaDatabaseUrl(validated.workflowDatabaseUrl)),
    factory(validated.bourneDatabaseUrl),
  ] as const;
  const [owner, app, appUnpooled, dashboard, bourne] = clients;
  let disconnected = false;
  return {
    owner,
    app,
    appUnpooled,
    dashboard,
    bourne,
    async disconnect() {
      if (disconnected) return;
      disconnected = true;
      const outcomes = await Promise.allSettled(clients.map((client) => client.$disconnect()));
      const rejection = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (rejection) throw rejection.reason;
    },
  };
}

export async function assertBenchmarkClientRoles(config: BenchmarkConfig, clients: BenchmarkClients) {
  const identities = await Promise.all([
    assertBenchmarkConnection(clients.owner, { databaseName: config.databaseName }),
    assertBenchmarkConnection(clients.app, { databaseName: config.databaseName, role: "derya_app" }),
    assertBenchmarkConnection(clients.appUnpooled, { databaseName: config.databaseName, role: "derya_app" }),
    assertBenchmarkConnection(clients.dashboard, { databaseName: config.databaseName, role: "dashboard_api" }),
    assertBenchmarkConnection(clients.bourne, { databaseName: config.databaseName, role: "bourne_supply_chain" }),
  ]);
  return {
    owner: identities[0],
    app: identities[1],
    appUnpooled: identities[2],
    dashboard: identities[3],
    bourne: identities[4],
  };
}
