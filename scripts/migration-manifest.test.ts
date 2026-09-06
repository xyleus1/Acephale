import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { COMMITTED_MIGRATIONS } from "@/lib/migration-manifest";

const migrationsDirectory = join(process.cwd(), "prisma", "migrations");

async function main() {
  const directories = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = (
    await Promise.all(
      directories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            await readFile(join(migrationsDirectory, entry.name, "migration.sql"));
            return entry.name;
          } catch {
            return null;
          }
        }),
    )
  ).filter((name): name is string => name !== null).sort();

  assert.deepEqual(
    COMMITTED_MIGRATIONS,
    migrations,
    "Committed migration manifest is stale; run npm run migrations:manifest",
  );
  console.log(`migration manifest verified: ${migrations.length} migrations`);
}

void main();
