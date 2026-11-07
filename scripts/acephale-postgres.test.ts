import test from "node:test";
import assert from "node:assert/strict";
import { createResearchDatabase, researchDatabase, type ResearchClient, type ResearchPool } from "../src/lib/acephale/postgres-store";

function fixture() {
  const calls: { text: string; values: unknown[] }[] = [], releases: boolean[] = [];
  let ended = 0;
  const client: ResearchClient = { async query(text, values = []) { calls.push({ text, values }); return { rows: text.startsWith("SELECT $1") ? [{ value: values[0] }] : [] }; }, release(destroy = false) { releases.push(destroy); } };
  const pool: ResearchPool = { connect: async () => client, end: async () => { ended++; } };
  return { db: createResearchDatabase(pool), client, pool, calls, releases, ended: () => ended };
}

test("research transactions bind hostile values, configure read-only bounds, and commit once", async () => {
  const { db, calls, releases, ended } = fixture();
  const text = "'; DROP SCHEMA acephale CASCADE; --";
  const rows = await db.transaction(q => q.query<{ value: string }>("SELECT $1::text AS value", [text]), { readOnly: true, isolationLevel: "REPEATABLE READ", statementTimeoutMs: 100 });
  assert.equal(rows[0].value, text);
  assert.deepEqual(calls.map(row => row.text), ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", "SELECT set_config('statement_timeout', $1, true)", "SELECT $1::text AS value", "COMMIT"]);
  assert.deepEqual(calls[1].values, ["100"]); assert.deepEqual(calls[2].values, [text]);
  assert.ok(calls.every(row => !row.text.includes(text))); assert.deepEqual(releases, [false]);
  const close = db.close(); assert.equal(db.close(), close); await close; assert.equal(ended(), 1);
  await assert.rejects(db.query("SELECT 1"), /closing/);
});

test("transaction errors roll back and failed connections never return to the pool", async () => {
  const { db, calls, releases } = fixture();
  await assert.rejects(db.transaction(async () => { throw new Error("operation failed"); }), /operation failed/);
  assert.equal(calls.at(-1)!.text, "ROLLBACK"); assert.deepEqual(releases, [true]); await db.close();
});

test("cancelled physical query is destroyed, drained and never committed", async () => {
  const { pool, client, calls, releases } = fixture();
  let queryStarted!: () => void, fail!: (error: Error) => void;
  const started = new Promise<void>(resolve => { queryStarted = resolve; });
  const base = client.query;
  client.query = async (text, values) => {
    if (text === "SELECT pg_sleep(10)") { calls.push({ text, values: [] }); queryStarted(); return new Promise((_, reject) => { fail = reject; }); }
    return base(text, values);
  };
  client.release = destroy => { releases.push(Boolean(destroy)); if (destroy) fail(new Error("connection terminated")); };
  const db = createResearchDatabase(pool), controller = new AbortController();
  const operation = db.transaction(q => q.query("SELECT pg_sleep(10)"), { signal: controller.signal });
  const rejection = assert.rejects(operation, /terminated/); await started; controller.abort();
  await db.close(); await rejection; assert.deepEqual(releases, [true]); assert.ok(!calls.some(row => row.text === "COMMIT"));
});

test("late acquisitions are released after bounded timeout and invalid URLs never construct a pool", async () => {
  const { client, releases } = fixture(); let acquire!: (client: ResearchClient) => void;
  const db = createResearchDatabase({ connect: () => new Promise(resolve => { acquire = resolve; }), end: async () => {} });
  await assert.rejects(db.transaction(async () => {}, { acquireTimeoutMs: 1 }), /timed out/);
  acquire(client); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(releases, [true]); await db.close();
  for (const url of ["postgresql://localhost/production", "postgresql://localhost/acephale_test/extra", "https://localhost/acephale_test"]) assert.throws(() => researchDatabase(url), /Dedicated/);
});

const databaseUrl = process.env.ACEPHALE_TEST_DATABASE_URL;
test("real PostgreSQL enforces read-only transactions and isolates bound values", { skip: !databaseUrl }, async () => {
  if (!["localhost", "127.0.0.1"].includes(new URL(databaseUrl!).hostname)) throw new Error("Integration database must be local and disposable");
  const db = researchDatabase(databaseUrl!);
  try {
    const payload = "'; SELECT pg_sleep(30); --";
    const rows = await db.transaction(query => query.query<{ value: string; readonly: string }>(
      "SELECT $1::text AS value,current_setting('transaction_read_only') AS readonly", [payload]), { readOnly: true });
    assert.deepEqual(rows, [{ value: payload, readonly: "on" }]);
    await assert.rejects(db.transaction(query => query.query("CREATE TABLE acephale.readonly_probe (id int)"),
      { readOnly: true }), (error: unknown) => (error as { code?: string }).code === "25006");
    const timeout = await db.transaction(query => query.query<{ timeout: string }>("SELECT current_setting('statement_timeout') AS timeout"),
      { readOnly: true, statementTimeoutMs: 123 });
    assert.equal(timeout[0].timeout, "123ms");
  } finally { await db.close(); }
});
