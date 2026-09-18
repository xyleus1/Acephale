// No application database is used. This creates a minimal dedicated loopback DB.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { createHash } = require("node:crypto");
const psql = resolve("research/goalspec/runs/pg17-local-v1/bin/psql.exe");
const database = "goalspec_derya_v5_default_off_test";
const directory = resolve("research/goalspec/runs/local-v5-epoch-default-off-20260916");
const migration = resolve("prisma/migrations/20260916180000_goalspec_read_epochs/migration.sql");
const activation = resolve("scripts/sql/goalspec-enable-epoch-shadow.sql");
const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");
function sql(statement, target = database) {
  return execFileSync(psql, ["-h", "127.0.0.1", "-p", "55440", "-U", "goalspec_owner", "-d", target, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", statement], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function file(path) { execFileSync(psql, ["-h", "127.0.0.1", "-p", "55440", "-U", "goalspec_owner", "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-f", path], { stdio: ["ignore", "pipe", "pipe"] }); }
mkdirSync(directory);
sql(`CREATE DATABASE ${database}`, "postgres");
const tables = ["User", "Job", "Company", "Inquiry", "CarrierQuote", "EmailThread", "EmailMessage", "JobMilestone", "JobDocument"];
sql(tables.map(table => `CREATE TABLE public."${table}" (id text PRIMARY KEY)`).join(";"));
file(migration);
const state = () => JSON.parse(sql(`SELECT json_build_object('disabled', (SELECT count(*) FROM pg_trigger WHERE tgname='goalspec_read_epoch_v1' AND tgenabled='D'), 'always', (SELECT count(*) FROM pg_trigger WHERE tgname='goalspec_read_epoch_v1' AND tgenabled='A'), 'counterTotal', (SELECT sum(epoch) FROM goalspec_read_guard.epochs), 'incarnation', (SELECT incarnation FROM goalspec_read_guard.metadata WHERE id=1))`));
sql(tables.map(table => `INSERT INTO public."${table}" VALUES ('default-write')`).join(";"));
const defaultState = state();
assert.equal(defaultState.disabled, 9); assert.equal(defaultState.always, 0); assert.equal(defaultState.counterTotal, 0);
file(activation);
sql(`INSERT INTO public."User" VALUES ('explicit-shadow-write')`);
const shadowState = state();
assert.equal(shadowState.disabled, 0); assert.equal(shadowState.always, 9); assert.equal(shadowState.counterTotal, 1);
assert.notEqual(defaultState.incarnation, shadowState.incarnation);
const receipt = { version: 1, database, fixture: "Nine minimal isolated test tables, no app/customer data", passed: true,
  defaultState, shadowState, productionActivated: false,
  sources: [__filename, migration, activation].map(path => ({ path, sha256: sha256(path) })) };
writeFileSync(join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ passed: true, defaultTriggersDisabled: 9, defaultCounterWrites: 0, explicitShadowTriggers: 9, incarnationRotated: true, receipt: join(directory, "receipt.json") }));
