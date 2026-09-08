import "dotenv/config";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  benchmarkConfigSummary,
  loadBenchmarkConfig,
  safeBenchmarkErrorMessage,
} from "../src/lib/supply-os/benchmark/config";
import {
  assertBenchmarkConnection,
  createBenchmarkClients,
} from "../src/lib/supply-os/benchmark/database";
import { prepareBenchmarkSchema } from "../src/lib/supply-os/benchmark/schema";

function run(command: string, arguments_: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Database preparation subprocess failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`));
    });
  });
}

function ownerPsqlEnvironment(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const sslMode = parsed.searchParams.get("sslmode");
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    ...(sslMode ? { PGSSLMODE: sslMode } : {}),
  };
}

function applicationRolePassword(databaseUrl: string) {
  const password = decodeURIComponent(new URL(databaseUrl).password);
  if (!password) {
    throw new Error("BENCHMARK_APP_DATABASE_URL must include the disposable derya_app password for role preparation.");
  }
  return password;
}

async function main() {
  const config = loadBenchmarkConfig();
  const clients = createBenchmarkClients(config);
  try {
    await assertBenchmarkConnection(clients.owner, { databaseName: config.databaseName });
    await assertBenchmarkConnection(clients.bourne, {
      databaseName: config.databaseName,
      role: "bourne_supply_chain",
    });
    await run(process.execPath, [
      join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
      "migrate",
      "deploy",
    ], {
      ...process.env,
      DATABASE_URL: config.ownerDatabaseUrl,
      DATABASE_URL_UNPOOLED: config.ownerDatabaseUrl,
      WORKFLOW_DATABASE_URL: config.workflowDatabaseUrl,
      BOURNE_DATABASE_URL: config.bourneDatabaseUrl,
    });
    await run("psql", [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=on",
      `--set=derya_app_password=${applicationRolePassword(config.appDatabaseUrl)}`,
      `--file=${join(process.cwd(), "scripts", "sql", "derya-app-role.sql")}`,
    ], ownerPsqlEnvironment(config.ownerDatabaseUrl));
    await run("psql", [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=on",
      `--file=${join(process.cwd(), "scripts", "sql", "bourne-procurement-communication-ledger.sql")}`,
    ], ownerPsqlEnvironment(config.ownerDatabaseUrl));
    const schema = await prepareBenchmarkSchema({ owner: clients.owner, config });
    console.log(JSON.stringify({
      ok: true,
      ...benchmarkConfigSummary(config),
      metadataTables: schema.tables,
    }, null, 2));
  } finally {
    await clients.disconnect();
  }
}

main().catch((error) => {
  console.error(`Benchmark database prepare failed: ${safeBenchmarkErrorMessage(error)}`);
  process.exitCode = 1;
});
