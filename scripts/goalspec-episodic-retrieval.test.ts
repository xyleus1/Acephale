import test from "node:test";
import assert from "node:assert/strict";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { buildMemoryArtifact, compatibleMemoryRuns, type MemoryEpisode, type MemoryRun } from "../src/lib/goalspec/experience-memory";
import { buildEpisodeEmbeddings, createEpisodicRetriever, episodePrefixText, normalizeEpisodeVector, rankEpisodicHits,
  validateEpisodeEmbeddings, type FrozenEpisodeEmbeddings, type EpisodicSearchHit } from "../src/lib/goalspec/episodic-retrieval";
import { BudgetLedger } from "../src/lib/goalspec/budget";
import { createBudgetedEmbedding } from "../services/goalspec-runtime/provider";
import { createInfraMemoryServices } from "../services/goalspec-runtime/infra-memory-services";
import { extractCausalMemoryMisses } from "../src/lib/goalspec/causal-memory";
import type OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import { postgresEpisodicSearch, publishEpisodicMemory } from "../src/lib/goalspec/episodic-postgres";
import { researchDatabase } from "../src/lib/goalspec/postgres-store";
import { Prisma } from "@prisma/client";
import { buildPaidEmbeddings, embeddingsFromCache } from "./goalspec-infra-embeddings";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const scope = { tenantId: "test", principalId: "actor", authorizationVersion: "v1", environmentVersion: "native", toolSchemaHash: hash("tools") };
const vector = () => Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
function fixture() {
  const source = { path: "sealed.json", sha256: hash("source") };
  const runs: MemoryRun[] = [], episodes: MemoryEpisode[] = [];
  for (let index = 0; index < 5; index++) {
    const run: MemoryRun = { id: `run-${index}`, familyId: `family-${index}`, stage: "v5-training", split: "train", scope,
      policyHash: hash("Policy"), sourceFiles: [source], success: index !== 1 && index !== 2, outcomeVerified: true,
      constraintViolations: 0, termination: "agent_stop", publicMessageCount: 4, episodeCount: 1, verificationTier: "native_verified" };
    const prefix: MemoryEpisode["prefix"] = [
      { index: 0, role: "user", content: `Find order ${index}`, calls: [], callId: null, observation: null },
      { index: 1, role: "assistant", content: null, calls: [{ id: "a", tool: "search", arguments: {} }], callId: null, observation: null },
      { index: 2, role: "tool", content: null, calls: [], callId: "a", observation: { order_id: `old-${index}` } },
    ];
    runs.push(run); episodes.push({ id: `ep-${index}`, runId: run.id, boundary: 0, scope, prefixHash: hash(prefix), prefix,
      requirements: [prefix[0].content!], previousTool: "search", nextActions: [{ id: "b", tool: "details", arguments: { order_id: "FUTURE_SECRET" } }],
      nextMessage: null, resultingObservations: [], argumentSources: [], lesson: "historical only" });
  }
  const memory = buildMemoryArtifact({ repositorySnapshotId: "snapshot", sourceFiles: [source], runs, episodes, misses: [] }, { profile: "v5" });
  const frame: ExecutionFrame = { schemaVersion: 1, runId: "unseen", boundary: 1, snapshotId: "snapshot", scope, policy: "Policy",
    requestedObjective: "Find an order", sources: { "requirement:0": "Find an order", _binding_events: [{ kind: "tool_request", tool: "search" }] },
    goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
  return { memory, frame, families: runs.map(run => run.familyId) };
}
const build = (memory: ReturnType<typeof fixture>["memory"]) => buildEpisodeEmbeddings(memory, "pinned-embedding-profile", async () => vector(), new AbortController().signal);
function rehash(input: FrozenEpisodeEmbeddings) { return { ...input, contentHash: hash(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "contentHash"))) }; }
const hit = (episode: MemoryEpisode, rank: number): EpisodicSearchHit => ({ episodeId: episode.id, episodeHash: hash(episode), lexicalRank: rank, denseRank: rank });

test("embedding cancellation retains unknown billing reservations and forwards SDK signal", async () => {
  const budget = new BudgetLedger(), controller = new AbortController(), events: unknown[] = [];
  const client = { embeddings: { create: async (_input: unknown, options: { signal: AbortSignal }) => {
    assert.equal(options.signal, controller.signal); controller.abort(); throw new Error("transport interrupted");
  } } } as unknown as Pick<OpenAI, "embeddings">;
  const embed = createBudgetedEmbedding(client, budget, "development", event => events.push(event), () => undefined);
  await assert.rejects(embed("public prefix", controller.signal), /reservation retained/);
  assert.equal(budget.snapshot().length, 1); assert.equal(budget.snapshot()[0].actual, undefined);
  assert.equal((events[0] as Record<string, unknown>).reservationRetained, true);
  await assert.rejects(embed("public prefix", controller.signal)); assert.equal(budget.snapshot().length, 1);
});

test("known embedding usage is settled even when cancellation discards the vector", async () => {
  const budget = new BudgetLedger(), controller = new AbortController();
  const client = { embeddings: { create: async () => {
    controller.abort(); return { model: "text-embedding-3-small", usage: { total_tokens: 2 }, data: [{ embedding: vector() }] };
  } } } as unknown as Pick<OpenAI, "embeddings">;
  await assert.rejects(createBudgetedEmbedding(client, budget, "development", () => undefined, () => undefined)("prefix", controller.signal));
  assert.equal(budget.snapshot()[0].actual, 1);
});

test("paid embedding build binds the original ledger checkpoint before provider dispatch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-embedding-budget-"));
  const ledgerPath = resolve(directory, "ledger.jsonl"), checkpointPath = join(directory, "checkpoint.json"), memoryPath = join(directory, "memory.json");
  const budget = new DurableBudget(ledgerPath); budget.ledger.reserve("prior-training", "training", 123);
  const original = budget.ledger.snapshot(); budget.close();
  writeFileSync(memoryPath, JSON.stringify(fixture().memory));
  writeFileSync(checkpointPath, JSON.stringify({ version: 1, ledgerPathHash: hash(ledgerPath), entries: [], entriesHash: hash([]) }));
  let dispatched = false;
  const factory = (() => { dispatched = true; throw new Error("No real provider permitted"); }) as typeof import("../services/goalspec-runtime/provider").researchProvider;
  await assert.rejects(buildPaidEmbeddings(memoryPath, "encoder-version", ledgerPath, checkpointPath, join(directory, "rejected"), factory), /Original ledger/);
  assert.equal(dispatched, false);
  const recovered = new DurableBudget(ledgerPath); assert.deepEqual(recovered.ledger.snapshot(), original); recovered.close();
  writeFileSync(checkpointPath, JSON.stringify({ version: 1, ledgerPathHash: hash(ledgerPath), entries: original, entriesHash: hash(original) }));
  const mock = ((_ledger: BudgetLedger, _allocation: unknown, record: (event: unknown) => void) => ({ model: {}, embed: async () => {
    record({ type: "mock_embedding", billed: false }); return vector();
  } })) as unknown as typeof import("../services/goalspec-runtime/provider").researchProvider;
  const completed = join(directory, "completed");
  await buildPaidEmbeddings(memoryPath, "encoder-version", ledgerPath, checkpointPath, completed, mock);
  const manifest = JSON.parse(readFileSync(join(completed, "manifest.json"), "utf8"));
  assert.equal(manifest.complete, true); assert.equal(manifest.rows, 5);
  assert.equal(readFileSync(join(completed, "episode-embeddings.jsonl"), "utf8").trim().split("\n").length, 5);
});

test("offline embedding cache requires exact prefix provenance and produces an immutable artifact", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-embedding-cache-")), { memory } = fixture();
  const artifact = await build(memory), memoryPath = join(directory, "memory.json"), cachePath = join(directory, "cache.json"), output = join(directory, "embeddings.json");
  writeFileSync(memoryPath, JSON.stringify(memory));
  writeFileSync(cachePath, JSON.stringify({ version: 1, model: artifact.model, modelVersion: artifact.modelVersion, rows: artifact.rows }));
  const receipt = await embeddingsFromCache(memoryPath, artifact.modelVersion, cachePath, output);
  assert.equal(receipt.contentHash, artifact.contentHash);
  assert.equal(validateEpisodeEmbeddings(JSON.parse(readFileSync(output, "utf8")), memory).rows.length, 5);
  await assert.rejects(embeddingsFromCache(memoryPath, artifact.modelVersion, cachePath, output), /New/);
});

test("shared services isolate per-run caches and close only after managed work drains", async () => {
  const { memory, frame, families } = fixture(), embeddings = await build(memory), events: unknown[] = [];
  let release!: (value: number[]) => void, calls = 0;
  const services = createInfraMemoryServices({ memory, embeddings, budget: new BudgetLedger(), allocation: "development", allowedFamilies: families,
    embed: async () => { calls++; return new Promise(resolve => { release = resolve; }); }, search: async () => [], record: event => events.push(event) });
  assert.equal(services.perRun("base", "base", "new-family"), undefined);
  const run = services.perRun(frame.runId, "goalspec", "new-family")!;
  const pending = run.retrieve(frame, new AbortController().signal); void pending.catch(() => undefined);
  let closed = false; const close = services.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, false); assert.equal(calls, 1);
  release(vector()); await assert.rejects(pending, /closed/); await close;
  const count = events.length; await new Promise(resolve => setImmediate(resolve)); assert.equal(events.length, count);
  assert.throws(() => services.perRun("later", "goalspec", "new-family"), /Invalid/);
});

function causalFixture() {
  const { memory } = fixture(), episode = memory.episodes[0], runId = episode.runId, boundaryId = "native-0";
  const publicInput = { runId, boundaryId, policy: "Policy", messages: [], tools: [] };
  const actorInputHash = hash("compiled-serving-input");
  const response = { role: "assistant", content: null, tool_calls: episode.nextActions.map(row => ({ id: row.id, name: row.tool, arguments: row.arguments, requestor: "assistant" })),
    raw_data: { goalspecCompiler: { inputHash: actorInputHash } } };
  const candidate = { schemaVersion: 1, id: "primary", invocation: { tool: "wrong_read", arguments: {}, scope }, probability: 0.8, bindings: [], hop: 1, patternId: null };
  const identity = { runId, checkpoint: 0, boundary: 0, frameHash: hash("frame") };
  const events: Record<string, unknown>[] = [
    { type: "infra_native_checkpoint", ...identity, boundaryId, publicInputHash: hash(publicInput) },
    { type: "infra_ranking", ...identity, candidatePool: [candidate], poolHash: hash([candidate]), probabilitySemantics: "independent_next_batch_hit", decision: { action: "READ", scores: [{ candidateId: candidate.id, probability: 0.8 }] } },
    { type: "actor_generated", ...identity, boundaryId, publicInputHash: hash(publicInput), actorInputHash, actorInputHashKind: "compiled_model_input", actorResponseHash: hash(response), toolCalls: response.tool_calls.map(call => ({ id: call.id, name: call.name, arguments: call.arguments })) },
    { type: "infra_native_service_closed" },
  ].map((row, sequence) => ({ ...row, sequence, monotonicNs: String(sequence), processClockId: "test-clock" }));
  const publicRows = [{ type: "public_checkpoint", ...publicInput, inputHash: hash(publicInput) },
    { type: "public_response", runId, boundaryId, response: { ...response, _goalspecPromotions: {} } }];
  return { memory, events, publicRows, source: { path: "events.jsonl", sha256: hash(events) } };
}

test("Postgres retrieval applies compatibility filters before exact dense and lexical ranking", async () => {
  const { memory, frame, families } = fixture(), embeddings = await build(memory), queries: Prisma.Sql[] = [];
  const tx = { $executeRaw: async (sql: Prisma.Sql) => { queries.push(sql); return 0; }, $queryRaw: async (sql: Prisma.Sql) => {
    queries.push(sql); return [{ id: memory.episodes[0].id, episode_hash: hash(memory.episodes[0]), lexical_rank: 1, dense_rank: 1 }];
  } };
  const db = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>, options: { maxWait: number }) => {
    assert.equal(options.maxWait, 100); return fn(tx);
  } } as unknown as PrismaClient;
  const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: families, excludeFamilies: ["family-1"],
    embed: async () => vector(), search: postgresEpisodicSearch(db) });
  assert.equal((await retriever.retrieve(frame, new AbortController().signal)).episodes[0].episode.id, "ep-0");
  assert.match(queries[0].sql, /READ ONLY/);
  const query = queries[2];
  assert.match(query.sql, /compatible AS MATERIALIZED/); assert.match(query.sql, /FROM compatible ORDER BY distance,id LIMIT 32/);
  for (const predicate of ["scope_hash", "policy_hash", "model_version", "projection_hash", "family_id", "outcome_verified", "c.id IN", "c.run_id<>"]) assert.ok(query.sql.includes(predicate));
  assert.ok(query.values.includes(memory.contentHash)); assert.ok(query.values.includes(embeddings.contentHash));
  assert.ok(query.values.includes(hash(frame.scope))); assert.ok(query.values.includes(hash(frame.policy)));
  retriever.close();
});

test("Postgres publication freezes the complete embedding cohort and rejects immutable conflicts", async () => {
  const { memory } = fixture(), embeddings = await build(memory), writes: { sql?: string; values?: unknown[] }[] = [];
  let previous: { content_hash: string; publication_state: string; manifests?: unknown }[] = [];
  const tx = { $executeRaw: async (sql: unknown) => { writes.push(sql as { sql?: string; values?: unknown[] }); return 0; }, $queryRaw: async (sql: Prisma.Sql) => sql.sql.includes("FROM goalspec.memory_checkpoint") ? [] : previous };
  const db = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  const receipt = await publishEpisodicMemory(db, memory, embeddings);
  assert.equal(receipt.rows, 5); assert.equal(receipt.existing, false);
  assert.equal(writes.filter(row => row.sql?.includes("INSERT INTO goalspec.memory_checkpoint")).length, 5);
  assert.match(writes.at(-1)!.sql!, /publication_state='frozen'/);
  const manifest = JSON.parse(String(writes.find(row => row.sql?.includes("INSERT INTO goalspec.repository_snapshot"))!.values![2]));
  previous = [{ content_hash: receipt.contentHash, publication_state: "frozen", manifests: manifest }];
  await assert.rejects(publishEpisodicMemory(db, memory, embeddings), /incomplete/);
  previous = [{ content_hash: hash("different memory"), publication_state: "frozen" }];
  await assert.rejects(publishEpisodicMemory(db, memory, embeddings), /conflict/);
});

const episodicDatabaseUrl = process.env.GOALSPEC_TEST_DATABASE_URL;
test("real pgvector publication, scoped retrieval, and immutable SQL guards", { skip: !episodicDatabaseUrl, timeout: 30000 }, async t => {
  if (!["127.0.0.1", "localhost"].includes(new URL(episodicDatabaseUrl!).hostname)) throw new Error("Integration test requires a disposable local goalspec_ database");
  const db = researchDatabase(episodicDatabaseUrl!, process.env.DATABASE_URL);
  try {
    const available = await db.$queryRaw<{ installed: boolean; relation: string | null }[]>`SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS installed,to_regclass('goalspec.memory_checkpoint')::text AS relation`;
    if (!available[0]?.installed || !available[0]?.relation) { t.skip("Apply research schema and 002-episodic-memory migration with pgvector before this test"); return; }
    const input = copy(fixture().memory); input.repositorySnapshotId = `integration-episodic:${crypto.randomUUID()}`;
    const memory = buildMemoryArtifact(input, { profile: "v5" }), embeddings = await build(memory);
    const receipt = await publishEpisodicMemory(db, memory, embeddings); assert.equal(receipt.rows, 5);
    const { frame, families } = fixture(); frame.snapshotId = memory.repositorySnapshotId;
    const retrievalEvents: Record<string, unknown>[] = [];
    const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: families, excludeFamilies: ["family-1"], embed: async () => vector(), search: postgresEpisodicSearch(db), record: event => retrievalEvents.push(event) });
    const result = await retriever.retrieve(frame, new AbortController().signal);
    assert.ok(result.episodes.length > 0); assert.ok(result.episodes.every(row => row.run.familyId !== "family-1"));
    assert.equal(retrievalEvents[0]?.mode, "hybrid", "Live SQL must complete, lexical fallback is not database verification");
    await assert.rejects(db.$executeRaw(Prisma.sql`UPDATE goalspec.memory_checkpoint SET text_content='tampered' WHERE snapshot_id=${memory.repositorySnapshotId}`), /Frozen/);
    assert.equal((await publishEpisodicMemory(db, memory, embeddings)).existing, true); retriever.close();
    // Frozen test rows intentionally remain until the disposable database is dropped.
  } finally { await db.$disconnect(); }
});

test("causal memory joins actual response identity and counts only the primary pre-response prediction", () => {
  const { memory, events, publicRows, source } = causalFixture();
  const misses = extractCausalMemoryMisses(memory, events, publicRows, source);
  assert.equal(misses.length, 1); assert.equal(misses[0].fullMatch, false); assert.equal(misses[0].toolMatch, false);
  assert.equal(misses[0].eventHash, hash(events[1]));
  const artifact = buildMemoryArtifact({ ...memory, sourceFiles: [...memory.sourceFiles, source], misses }, { profile: "v5" });
  assert.equal(artifact.confusions[0].count, 1); assert.deepEqual(artifact.confusions[0].runIds, ["run-0"]);
  const late = copy(events); [late[1], late[2]] = [late[2], late[1]];
  late.forEach((row, index) => { row.sequence = index; row.monotonicNs = String(index); });
  assert.equal(extractCausalMemoryMisses(memory, late, publicRows, source).length, 0);
});

test("causal memory rejects changed pool, actor IDs, frame hashes, and sequence gaps", () => {
  for (const change of [(rows: Record<string, unknown>[]) => { rows[1].poolHash = hash("different"); },
    (rows: Record<string, unknown>[]) => { (rows[2].toolCalls as { id: string }[])[0].id = "fabricated"; },
    (rows: Record<string, unknown>[]) => { rows[2].frameHash = hash("other frame"); },
    (rows: Record<string, unknown>[]) => { rows[1].sequence = 9; },
    (rows: Record<string, unknown>[]) => { rows[2].actorInputHashKind = "public_boundary_fixture"; }]) {
    const { memory, events, publicRows, source } = causalFixture(); change(events);
    assert.throws(() => extractCausalMemoryMisses(memory, events, publicRows, source));
  }
});

test("frozen embeddings use only public prefixes and bind the entire declared corpus", async () => {
  const { memory } = fixture(), embeddings = await build(memory);
  assert.equal(embeddings.rows.length, 5);
  assert.ok(embeddings.rows.every(row => !row.text.includes("FUTURE_SECRET")));
  const changed = copy(memory.episodes[0]); changed.nextActions[0].arguments.order_id = "DIFFERENT_FUTURE";
  assert.equal(episodePrefixText(changed), episodePrefixText(memory.episodes[0]));
  const truncated = copy(embeddings); truncated.rows.pop();
  assert.throws(() => validateEpisodeEmbeddings(rehash(truncated), memory), /incomplete/);
  const tampered = copy(embeddings); tampered.rows[0].text += "future label"; tampered.rows[0].textHash = hash(tampered.rows[0].text);
  assert.throws(() => validateEpisodeEmbeddings(rehash(tampered), memory), /prefix/);
  assert.throws(() => normalizeEpisodeVector(Array(1536).fill(0)), /nonzero/);
  const dense = normalizeEpisodeVector(Array.from({ length: 1536 }, (_, index) => Math.sin(index * 13.13)));
  assert.deepEqual(normalizeEpisodeVector(dense), dense);
});

test("unknown, non-native and censored endpoints cannot produce embedding rows", async () => {
  const input = copy(fixture().memory);
  input.runs[0].termination = "budget_exhausted";
  input.runs[1].outcomeVerified = false;
  input.runs[2].verificationTier = "source_reported";
  const memory = buildMemoryArtifact(input, { profile: "v5" }), embeddings = await build(memory);
  assert.deepEqual(embeddings.rows.map(row => row.episodeId), ["ep-3", "ep-4"]);
});

test("strict compatibility filters scope, policy, current run and families before ranking and statistics", async () => {
  const { memory, frame, families } = fixture(), embeddings = await build(memory);
  assert.equal(compatibleMemoryRuns({ ...frame, policy: "changed" }, memory, { strictPolicy: true }).length, 0);
  let searched = false;
  const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: families, excludeFamilies: ["family-1"], embed: async () => vector(),
    search: async request => { searched = true; assert.deepEqual(request.allowedEpisodeIds, ["ep-0", "ep-2", "ep-3", "ep-4"]);
      assert.equal(request.policyHash, hash(frame.policy)); return memory.episodes.filter(row => request.allowedEpisodeIds.includes(row.id)).map((row, index) => hit(row, index + 1)); } });
  const result = await retriever.retrieve(frame, new AbortController().signal);
  assert.equal(searched, true); assert.equal(result.episodes.length, 4); assert.equal(result.transitions[0].failures, 1);
  assert.ok(result.episodes.every(row => row.run.familyId !== "family-1"));
  assert.equal((await retriever.retrieve({ ...frame, policy: "changed" }, new AbortController().signal)).episodes.length, 0);
  retriever.close();
});

test("hybrid rank fusion is deterministic and never exposes more than one negative example", async () => {
  const { memory, frame, families } = fixture(), embeddings = await build(memory);
  const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: families, embed: async () => vector(),
    search: async () => [1, 2, 0, 3, 4].map((index, rank) => hit(memory.episodes[index], rank + 1)) });
  const result = await retriever.retrieve(frame, new AbortController().signal);
  assert.equal(result.episodes.length, 4); assert.equal(result.episodes.filter(row => !row.run.success).length, 1);
  assert.equal(result.transitions[0].failures, 2);
  assert.deepEqual(rankEpisodicHits([{ ...hit(memory.episodes[0], 1), denseRank: null }, { ...hit(memory.episodes[1], 1), lexicalRank: null }]), ["ep-0", "ep-1"]);
  retriever.close();
});

test("timeout falls back promptly and late embeddings cannot warm the run cache", async () => {
  const { memory, frame, families } = fixture(), embeddings = await build(memory);
  let release!: (value: number[]) => void, calls = 0;
  const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: families, timeoutMs: 5,
    embed: async () => { calls++; return calls === 1 ? new Promise(resolve => { release = resolve; }) : vector(); },
    search: async () => memory.episodes.map((row, index) => hit(row, index + 1)) });
  const first = await retriever.retrieve(frame, new AbortController().signal); assert.ok(first.episodes.length > 0);
  release(vector()); await new Promise(resolve => setImmediate(resolve));
  await retriever.retrieve(frame, new AbortController().signal); assert.equal(calls, 2);
  await retriever.retrieve(frame, new AbortController().signal); assert.equal(calls, 2);
  retriever.close();
});

test("a database returning an excluded row fails closed instead of falling back", async () => {
  const { memory, frame, families } = fixture(), embeddings = await build(memory);
  const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: families, excludeFamilies: ["family-1"],
    embed: async () => vector(), search: async () => [hit(memory.episodes[1], 1)] });
  await assert.rejects(retriever.retrieve(frame, new AbortController().signal), /incompatible/);
  retriever.close();
});

test("caller cancellation and shutdown fence retrieval", async () => {
  const { memory, frame, families } = fixture(), embeddings = await build(memory);
  const retriever = createEpisodicRetriever({ memory, embeddings, allowedFamilies: families, embed: async () => vector(), search: async () => [] });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(retriever.retrieve(frame, controller.signal));
  retriever.close(); await assert.rejects(retriever.retrieve(frame, new AbortController().signal), /closed/);
});
