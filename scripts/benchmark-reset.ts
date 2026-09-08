import "dotenv/config";
import {
  assertBenchmarkResetAllowed,
  loadBenchmarkConfig,
  safeBenchmarkErrorMessage,
} from "../src/lib/supply-os/benchmark/config";
import { createBenchmarkClients } from "../src/lib/supply-os/benchmark/database";
import { resetBenchmarkDatabase } from "../src/lib/supply-os/benchmark/schema";

async function main() {
  const config = loadBenchmarkConfig();
  assertBenchmarkResetAllowed();
  const clients = createBenchmarkClients(config);
  try {
    const result = await resetBenchmarkDatabase({ owner: clients.owner, config });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } finally {
    await clients.disconnect();
  }
}

main().catch((error) => {
  console.error(`Benchmark reset failed: ${safeBenchmarkErrorMessage(error)}`);
  process.exitCode = 1;
});
