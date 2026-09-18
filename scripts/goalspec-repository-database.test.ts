import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { hash } from "../src/lib/goalspec/canonical";
import { researchDatabase, PostgresExperienceRepository } from "../src/lib/goalspec/postgres-store";
import { PostgresPublicationStore, type DatasetRecord, type EpisodeRecord, type PublishedExperience, type SnapshotPublication } from "../src/lib/goalspec/postgres-publication";
import type { ExecutionFrame, Scope } from "../src/lib/goalspec/contracts/generated";
import { PostgresTelemetryStore, type RunTelemetry } from "../src/lib/goalspec/postgres-telemetry";

test("actual pgvector repository enforces provenance, frozen publication, compatible retrieval and immutable feedback", async () => {
  const url = process.env.GOALSPEC_REPOSITORY_TEST_URL;
  assert.ok(url, "Set GOALSPEC_REPOSITORY_TEST_URL to a schema-initialized local goalspec_*_test database");
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) && /^\/goalspec_[a-z0-9_]+_test$/.test(parsed.pathname), "Only local dedicated test databases are accepted");
  const db = researchDatabase(url), store = new PostgresPublicationStore(db), repository = new PostgresExperienceRepository(db);
  const prefix = randomUUID(), id = (name: string) => `${prefix}:${name}`;
  const dataset: DatasetRecord = { id: id("dataset"), source: "synthetic-repository-integration-fixture", revision: "test-v1", contentHash: hash(id("dataset")),
    license: "test-fixture", parserVersion: "fixture-v1", rawCount: 4, admittedCount: 4, metadata: { syntheticTestOnly: true } };
  const scope: Scope = { tenantId: id("tenant"), principalId: id("principal"), authorizationVersion: "v1", environmentVersion: "native-test-v1", toolSchemaHash: hash("testtools") };
  const episodes: EpisodeRecord[] = ["a", "b", "heldout", "source"].map(name => ({ id: id(name), datasetId: dataset.id, sourceId: name, domain: "mock", familyId: id(`family:${name}`),
    split: name === "heldout" ? "test" : "train", environmentVersion: scope.environmentVersion, toolSchemaHash: scope.toolSchemaHash,
    verificationTier: name === "source" ? "source_reported" : "native_verified", transcriptUri: `fixture://${id(name)}`, contentHash: hash(id(name)), metadata: { syntheticTestOnly: true } }));
  const embedding = Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
  const snapshotId = id("snapshot");
  const records: PublishedExperience[] = ["a", "b"].map(name => ({ id: id(`pattern:${name}`), episodeId: id(name), familyId: id(`family:${name}`), split: "train", text: "look up account", embedding,
    pattern: { schemaVersion: 1, id: id(`pattern:${name}`), scope, snapshotId, verificationTier: "native_verified", prefix: [], tool: "lookup", binding: null,
      dataDependencies: [], policyPrerequisites: [], observedOrdering: [], branches: [], successes: 1, failures: 0 } }));
  const publication: SnapshotPublication = { id: snapshotId, records, episodeIds: [id("a"), id("b")], heldoutFamilies: [id("family:heldout")],
    transitions: [{ key: records[1].id, goal: "lookup", opportunities: 10, matches: 9, independentSupport: 2, sourceEpisodeIds: [id("a"), id("b")], outcomeStrata: {} }],
    errors: [{ key: records[0].id, tool: "lookup", observations: 10, errors: 8, sourceEpisodeIds: [id("a"), id("b")], details: {} }],
    compilerVersion: "test-v1", embeddingModelVersion: "synthetic-test-vector-v1", calibration: { syntheticTestOnly: true } };
  try {
    assert.equal((await store.importDataset(dataset, episodes)).imported, 4);
    assert.equal((await store.importDataset(dataset, episodes)).existing, 4);
    await assert.rejects(store.importDataset({ ...dataset, revision: "changed" }, episodes), /Immutable dataset/);
    const crossing = { ...dataset, id: id("crossing"), rawCount: 1, admittedCount: 1 };
    await assert.rejects(store.importDataset(crossing, [{ ...episodes[0], id: id("cross-episode"), datasetId: crossing.id, contentHash: hash(id("cross")), split: "test" }]), /crosses dataset splits/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.episode SET split = 'test' WHERE id = ${episodes[0].id}`, /Immutable/);
    await assert.rejects(store.publish(publication), /native verification|independently verified/);
    for (const episode of episodes.slice(0, 3)) await store.recordVerification({ episodeId: episode.id, verifierVersion: "mock-fixture-v1", verifierCodeHash: hash("fixture-code"),
      evidenceHash: hash(episode.id), evidenceUri: `fixture://${episode.id}/verdict`, success: true, constraintsSatisfied: true, verdict: { syntheticTestOnly: true } });
    await assert.rejects(store.recordVerification({ episodeId: episodes[3].id, verifierVersion: "mock-fixture-v1", verifierCodeHash: hash("fixture-code"),
      evidenceHash: hash("source"), evidenceUri: "fixture://source", success: true, constraintsSatisfied: true, verdict: {} }), /Source reported/);
    await assert.rejects(store.publish({ ...publication, episodeIds: [...publication.episodeIds, episodes[2].id] }), /held-out/);
    assert.equal((await store.publish(publication)).records, 2);
    assert.equal((await store.publish(publication)).existing, true);
    await assert.rejects(store.publish({ ...publication, calibration: { changed: true } }), /Immutable snapshot/);
    const nestedId = id("nested-snapshot");
    assert.equal((await store.publish({ ...publication, id: nestedId, records: records.map(record => ({ ...record, pattern: { ...record.pattern, snapshotId: nestedId } })) })).records, 2,
      "Nested snapshots preserve pattern identities without mutating the earlier snapshot");
    const frame: ExecutionFrame = { schemaVersion: 1, runId: "fixture", boundary: 0, scope, requestedObjective: "look up account", policy: "read only", sources: {},
      goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash("") }, snapshotId };
    const result = await repository.retrieve(frame, "look up account", embedding, 8);
    assert.match(await repository.verifyFrozenRecords(snapshotId, records), /^[a-f0-9]{64}$/);
    await assert.rejects(repository.verifyFrozenRecords(snapshotId, [{ ...records[0], text: "tampered" }, records[1]]), /differ/);
    assert.deepEqual(result.map(row => row.id), [records[1].id, records[0].id], "Frozen training transitions and previous errors alter ranking of the identical vector/lexical pool");
    assert.equal((await repository.retrieve({ ...frame, scope: { ...scope, tenantId: "other" } }, "look up account", embedding)).length, 0);
    assert.equal((await repository.retrieve({ ...frame, scope: { ...scope, authorizationVersion: "revoked" } }, "look up account", embedding)).length, 0);
    await assert.rejects(repository.retrieve({ ...frame, snapshotId: "missing" }, "look up account", embedding), /Frozen snapshot unavailable/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.repository_snapshot SET manifests = '{}' WHERE id = ${snapshotId}`, /Frozen/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.workflow_pattern SET text_content = 'changed' WHERE id = ${records[0].id}`, /Frozen/);
    await assert.rejects(db.$executeRaw`DELETE FROM goalspec.pattern_embedding WHERE pattern_id = ${records[0].id}`, /Frozen/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.goal_transition_stats SET matches = 0 WHERE snapshot_id = ${snapshotId}`, /Frozen/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.snapshot_prediction_error SET errors = 0 WHERE snapshot_id = ${snapshotId}`, /Frozen/);
    await assert.rejects(db.$executeRaw`DELETE FROM goalspec.snapshot_episode WHERE snapshot_id = ${snapshotId}`, /Frozen/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.episode_verification SET success = false WHERE episode_id = ${episodes[0].id}`, /Immutable/);
    const annotationId = await store.annotate(episodes[0].id, 0, hash("visible"), "fixture-teacher", { requestedObjective: "lookup" });
    await assert.rejects(db.$executeRaw`DELETE FROM goalspec.goal_annotation WHERE id = ${annotationId}`, /Immutable/);
    const telemetry = new PostgresTelemetryStore(db), runId = id("telemetry-run");
    const run: RunTelemetry = { runId, arm: "goalspec", phase: "test-fixture", nativeArtifactHash: hash("native-fixture"), nativeArtifactUri: "fixture://native",
      experiment: { schemaVersion: 1, id: runId, snapshotId, datasetHashes: [dataset.contentHash], sourceRevision: "2174a603f6d014ef94473ffa95957f6ce27100db", actorModel: "gpt-5.4-2026-03-05", predictorModel: "gpt-4.1-mini-2025-04-14", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536, actorReasoning: "medium", actorOutputCap: 4096, predictorOutputCap: 1024, actorInputBudget: 32768, predictorInputBudget: 8192, arms: ["base", "neutral_memory_prefetch", "goalspec"], seeds: [1], frozen: true, totalCeilingUsd: 500 },
      events: [{ type: "fixture", payload: { test: true }, artifactUri: "fixture://event" }],
      frames: [{ frame: { ...frame, runId }, provenance: "runtime", evidence: [] }], candidates: [{ boundary: 0, visibleInputHash: hash(frame), admission: "rejected", reason: "argument_or_scope_validation",
        candidate: { schemaVersion: 1, id: "invalid-source-proposal", invocation: { tool: "lookup", arguments: { id: "historical-id" }, scope: { ...scope, tenantId: "wrong-tenant" } }, probability: 0.8,
          bindings: [{ sourceId: "unavailable", path: [] }], hop: 1, patternId: null }, failureCause: "scope_mismatch", observedTool: "lookup" }],
      outcome: { schemaVersion: 1, runId, requestedObjective: "look up account", inferredGoals: frame.goals, achievedOutcomes: ["Fixture completed"], independentVerdict: { verifierId: "fixture-v1", success: true, constraintsSatisfied: true, evidenceRefs: ["fixture://verdict"] } }, independentEvidence: { syntheticTestOnly: true } };
    assert.equal((await telemetry.importRun(run)).frames, 1);
    assert.equal((await telemetry.importRun(run)).existing, true);
    assert.equal((await telemetry.exportRun(runId)).events instanceof Array, true);
    await assert.rejects(telemetry.importRun({ ...run, phase: "changed" }), /Immutable run/);
    await assert.rejects(telemetry.importRun({ ...run, candidates: run.candidates.map(candidate => ({ ...candidate, admission: "admitted" })) }), /incompatible scope/);
    await assert.rejects(db.$executeRaw`DELETE FROM goalspec.execution_frame WHERE run_id=${runId}`, /Immutable/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.goal_hypothesis SET revision_hash='changed' WHERE run_id=${runId}`, /Immutable/);
    await assert.rejects(db.$executeRaw`DELETE FROM goalspec.execution_event WHERE run_id=${runId}`, /Immutable/);
    await assert.rejects(db.$executeRaw`UPDATE goalspec.outcome_verdict SET achieved_outcomes='[]' WHERE run_id=${runId}`, /Immutable/);
  } finally { await db.$disconnect(); }
});
