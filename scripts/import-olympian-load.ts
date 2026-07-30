import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import {
  importOlympianLoad,
  previewOlympianLoadImport,
  resolveOlympianImportOffice,
} from "../src/lib/olympian-load";

type CliArgs = {
  apply: boolean;
  officeId: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    apply: false,
    officeId: null,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      parsed.apply = true;
    } else if (arg.startsWith("--office=")) {
      parsed.officeId = arg.slice("--office=".length).trim() || null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const office = await resolveOlympianImportOffice(args.officeId);

  if (!args.apply) {
    const preview = await previewOlympianLoadImport(office.id);
    console.log(JSON.stringify(preview, null, 2));
    console.log("Dry run only. Add --apply to create the load in this office.");
    return;
  }

  const result = await importOlympianLoad({
    officeId: office.id,
    actor: {
      userId: null,
      email: "system@manual-import.invalid",
    },
  });
  console.log(JSON.stringify({
    ...result,
    office: office.name,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
