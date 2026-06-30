import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { backfillCompanyBrainMemory } from "../src/lib/memory/backfill";

function argValue(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function main() {
  const officeId = argValue("office");
  const limitRaw = argValue("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const strict = process.argv.includes("--strict");

  const result = await backfillCompanyBrainMemory({
    officeId: officeId ?? undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    strict,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
