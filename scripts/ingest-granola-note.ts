import "dotenv/config";
import fs from "fs/promises";
import { applyBrainIngest } from "../src/lib/brain-ops/ingest";
import type { BrainIngestPayload } from "../src/lib/brain-ops/types";
import { prisma } from "../src/lib/prisma";

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main() {
  const officeId = argValue("office");
  const file = argValue("file");
  const userId = argValue("user");

  if (!officeId || !file) {
    throw new Error("Usage: npm run brain:ingest:granola -- --office=<officeId> --file=<payload.json> [--user=<userId>]");
  }

  const raw = await fs.readFile(file, "utf8");
  const payload = JSON.parse(raw) as BrainIngestPayload;
  const source = payload.source ?? {};
  const result = await applyBrainIngest({
    officeId,
    userId,
    payload: {
      ...payload,
      mode: payload.mode ?? "calibration",
      source: {
        ...source,
        source_type: source.source_type ?? "granola_meeting_note",
      },
    },
  });

  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  if (!result.ok) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
