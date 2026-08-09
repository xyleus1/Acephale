import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const retiredSlug = ["supply", "os"].join("-");
const retiredDisplayName = ["Supply", "OS"].join(" ");

function filesBelow(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

const activeSourceFiles = filesBelow(path.join(root, "src"));
const publicFiles = fs.existsSync(path.join(root, "public"))
  ? filesBelow(path.join(root, "public"))
  : [];
const retiredPaths = [...activeSourceFiles, ...publicFiles]
  .map((file) => path.relative(root, file))
  .filter((file) => file.toLowerCase().includes(retiredSlug));

assert.deepEqual(retiredPaths, [], "retired source paths must not return");

const retiredDisplayMentions = activeSourceFiles.flatMap((file) => {
  const source = fs.readFileSync(file, "utf8");
  return source.includes(retiredDisplayName) ? [path.relative(root, file)] : [];
});

assert.deepEqual(
  retiredDisplayMentions,
  [],
  "retired product name must not return to active source",
);

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const retiredScripts = Object.entries(packageJson.scripts ?? {}).filter(
  ([name, command]) =>
    name.toLowerCase().includes(retiredSlug) ||
    command.toLowerCase().includes(retiredSlug),
);
assert.deepEqual(retiredScripts, [], "retired package scripts must not return");

const removedDependencies = [
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-tabs",
  "@radix-ui/react-tooltip",
  "@vis.gl/react-maplibre",
  "maplibre-gl",
  "motion",
  "recharts",
];
const declaredDependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
};
assert.deepEqual(
  removedDependencies.filter((name) => name in declaredDependencies),
  [],
  "retired feature-only dependencies must not return",
);

const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
assert.doesNotMatch(
  schema,
  new RegExp("model\\s+Supply[A-Z]"),
  "retired Prisma models must not return",
);

const migrationsDirectory = path.join(root, "prisma/migrations");
const migrationFiles = fs
  .readdirSync(migrationsDirectory)
  .map((directory) => path.join(migrationsDirectory, directory, "migration.sql"))
  .filter((file) => fs.existsSync(file));
const retirementMigration = migrationFiles.find((file) =>
  file.includes("retire_parallel_procurement_prototype"),
);
assert.ok(retirementMigration, "retirement migration must exist");

const historicalSql = migrationFiles
  .filter((file) => file !== retirementMigration)
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
const retirementSql = fs.readFileSync(retirementMigration, "utf8");

const createdTables = Array.from(
  historicalSql.matchAll(/CREATE TABLE "(Supply[A-Za-z0-9_]+)"/g),
  (match) => match[1],
).sort();
const droppedTables = Array.from(
  retirementSql.matchAll(/^\s*"(Supply[A-Za-z0-9_]+)"[,;]?$/gm),
  (match) => match[1],
).sort();
assert.equal(createdTables.length, 26, "historical retired table count changed");
assert.deepEqual(droppedTables, createdTables, "every retired table must be dropped");

const createdFunctions = Array.from(
  historicalSql.matchAll(/CREATE FUNCTION (supply_[a-z0-9_]+)\(\)/g),
  (match) => match[1],
).sort();
const droppedFunctions = Array.from(
  retirementSql.matchAll(/DROP FUNCTION (supply_[a-z0-9_]+)\(\);/g),
  (match) => match[1],
).sort();
assert.equal(createdFunctions.length, 18, "historical retired function count changed");
assert.deepEqual(
  droppedFunctions,
  createdFunctions,
  "every retired database function must be dropped",
);
assert.doesNotMatch(
  retirementSql,
  /\bDROP\b[^;]*\bCASCADE\b/si,
  "retirement must fail on unexpected external dependencies",
);

console.log("retired product boundary checks passed");
