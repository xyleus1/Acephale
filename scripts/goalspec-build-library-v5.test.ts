import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLibrary, type RepositoryBundle } from "./goalspec-build-library";
import { dispatchLibraryV5, mergePriorPublication, prepareLibraryV5, selectV5Training } from "./goalspec-build-library-v5";
import { copy, hash } from "../src/lib/goalspec/canonical";
import type { MiningEpisode } from "../src/lib/goalspec/miner";
import { researchScope, type ResearchManifest } from "../services/goalspec-runtime/research-bootstrap";
import { FrozenRepository } from "../src/lib/goalspec/repository";

const mockEmbedding = async () => [1, ...Array(1535).fill(0)];
function fixture() {
  const tools = [{ type: "function" as const, function: { name: "get_order_details", parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } } }];
  const episodes: MiningEpisode[] = Array.from({ length: 40 }, (_, index) => ({ id: `episode-${index}`, family: `retail:family-${Math.floor(index / 2)}`, benchmark: "custom-tau", domain: "retail",
    canonicalGoalId: "read_order", verifiedSuccess: index !== 0, checkpoints: [{ prefix: { throughSeq: 1, signatures: ["get_user_details:success"],
      tools: tools.map(tool => ({ name: tool.function.name, parameters: tool.function.parameters })), events: [
        { seq: 0, kind: "tool_request", call_id: "actual-id", tool: "get_user_details", arguments: { user_id: `current-${index}` } },
        { seq: 1, kind: "tool_result", call_id: "actual-id", tool: "get_user_details", status: "success", result: { orders: [`ORDER-${index}`] } },
      ] }, targets: [{ tool: "get_order_details", arguments: { order_id: `ORDER-${index}` } }] }] }));
  const manifest: ResearchManifest = { schemaVersion: 1, snapshotId: "empty-training", heldoutFamilies: [], runs: episodes.map(episode => ({ runId: episode.id, familyId: episode.family,
    arm: "base", domain: "retail", allocation: "training", maxCostMicrodollars: 1_250_000, maxBoundaries: 40, tools })) };
  const bundle: RepositoryBundle = { dataset: { id: "fixture", source: "unit-test", revision: "fixture", contentHash: "a".repeat(64), license: "test", parserVersion: "test", rawCount: 40, admittedCount: 40, metadata: {} },
    episodes: episodes.map(episode => ({ id: episode.id, datasetId: "fixture", sourceId: episode.id, domain: "retail", familyId: episode.family, split: "train",
      environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(tools), verificationTier: "native_verified", transcriptUri: "fixture-only", contentHash: "b".repeat(64),
      metadata: { fixtureHash: hash(episode.id), requestedGoalAnnotation: "separate-original-annotation" } })),
    verifications: episodes.map(episode => ({ episodeId: episode.id, verifierVersion: "fixture", verifierCodeHash: "c".repeat(64), evidenceHash: "d".repeat(64),
      evidenceUri: "fixture-only", success: episode.verifiedSuccess, constraintsSatisfied: episode.verifiedSuccess, verdict: {} })) };
  const learningFamilySplit: Record<string, "train" | "calibration" | "development"> = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`retail:family-${i}`, i < 16 ? "train" : "calibration"]));
  learningFamilySplit["retail:untouched-development"] = "development";
  const fixtures = { learningFamilySplit, tasks: episodes.map(episode => ({ taskId: episode.id, familyId: episode.family, split: "train", learningSplit: learningFamilySplit[episode.family], fixtureHash: hash(episode.id) })) };
  return { episodes, manifest, bundle, fixtures };
}

test("v5 fitting excludes every calibration family before mining and retains failed endpoints and annotations", async () => {
  const input = fixture(), selected = selectV5Training(input.episodes, input.bundle, input.manifest, input.fixtures);
  assert.equal(selected.episodes.length, 32); assert.equal(selected.excludedCalibrationEpisodeIds.length, 8);
  assert.equal(selected.episodes.filter(episode => !episode.verifiedSuccess).length, 1);
  assert.equal(selected.bundle.episodes[0].metadata.requestedGoalAnnotation, "separate-original-annotation");
  const result = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, selected.heldoutFamilies, mockEmbedding, 256, "native-training-v5-20260916");
  assert.ok(result.records.length > 0);
  assert(result.records.every(record => record.pattern.snapshotId === "native-training-v5-20260916"));
  assert(result.publication.episodeIds.includes("episode-0"));
  assert(result.publication.errors.some(row => (row.details.failedEndpointEpisodes as string[]).includes("episode-0")));
  assert([...result.publication.transitions, ...result.publication.errors].every(row => row.sourceEpisodeIds.every(id => selected.selectedEpisodeIds.includes(id))));
  assert(result.publication.records.every(row => [row.episodeId, ...(row.supportingEpisodeIds ?? [])].every(id => id !== "episode-0" && selected.selectedEpisodeIds.includes(id))));
  assert.equal(input.bundle.episodes.length, 40);
});

test("v5 selection rejects duplicates, changed scopes, fixture mismatches and calibration relabeling", () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.bundle.episodes[1].sourceId = f.bundle.episodes[0].sourceId; },
    (f: ReturnType<typeof fixture>) => { f.bundle.verifications[1].episodeId = f.bundle.verifications[0].episodeId; },
    (f: ReturnType<typeof fixture>) => { f.bundle.episodes[0].environmentVersion = "changed"; },
    (f: ReturnType<typeof fixture>) => { f.bundle.episodes[0].metadata.fixtureHash = "changed"; },
    (f: ReturnType<typeof fixture>) => { f.fixtures.tasks[32].learningSplit = "train"; },
    (f: ReturnType<typeof fixture>) => { f.manifest.runs[0].arm = "goalspec"; },
    (f: ReturnType<typeof fixture>) => { f.bundle.verifications[0].success = true; },
    (f: ReturnType<typeof fixture>) => { f.episodes.pop(); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures)); }
});

test("actual fitting-family allowlist excludes selection and calibration before every mining statistic", async () => {
  const f = fixture(), allowed = Array.from({ length: 12 }, (_, index) => `retail:family-${index}`);
  const selected = selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures, allowed);
  assert.equal(selected.episodes.length, 24);
  assert.equal(selected.excludedSelectionEpisodeIds.length, 8);
  assert.equal(selected.excludedCalibrationEpisodeIds.length, 8);
  const result = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, selected.heldoutFamilies, mockEmbedding, 256, "new-v5");
  assert.equal(result.publication.episodeIds.length, 24);
  assert(result.publication.episodeIds.includes("episode-0"));
  assert([...result.publication.transitions, ...result.publication.errors].every(row => row.sourceEpisodeIds.every(id => selected.selectedEpisodeIds.includes(id))));
  assert(selected.heldoutFamilies.includes("retail:family-12") && selected.heldoutFamilies.includes("retail:family-16"));
});

test("default v1 identity stays stable and a new snapshot deterministically rescopes patterns", async () => {
  const f = fixture(), selected = selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures);
  const previous = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, [], mockEmbedding);
  const current = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, [], mockEmbedding, 256, "new-v5");
  assert.equal(previous.summary.snapshotId, "native-training-v1-20260915");
  assert.equal(current.summary.snapshotId, "new-v5");
  assert.deepEqual(previous.records.map(row => row.embedding), current.records.map(row => row.embedding));
  assert.deepEqual(previous.records.map(row => row.id), current.records.map(row => row.id));
  await assert.rejects(buildLibrary(selected.episodes, selected.bundle, selected.manifest, [], mockEmbedding, 256, "invalid snapshot"));
});

test("explicit unavailable failures remain present without inventing an independent verification", async () => {
  const f = fixture();
  f.bundle.verifications = f.bundle.verifications.filter(row => row.episodeId !== "episode-0");
  f.bundle.episodes[0].verificationTier = "source_reported"; f.bundle.episodes[0].metadata.verifierAvailable = false;
  const selected = selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures);
  assert.equal(selected.episodes.length, 32); assert.equal(selected.bundle.verifications.length, 31);
  assert.equal(selected.episodes[0].checkpoints.length, 0); assert.equal(f.episodes[0].checkpoints.length, 1);
  const result = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, selected.heldoutFamilies, mockEmbedding, 256, "new-v5");
  assert(result.publication.episodeIds.includes("episode-0"));
  assert(result.publication.records.every(row => ![row.episodeId, ...(row.supportingEpisodeIds ?? [])].includes("episode-0")));
  f.episodes[0].verifiedSuccess = true;
  assert.throws(() => selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures), /mismatch/);
});

test("compatible prior vectors retain exact bytes and source lineage even without fresh eligible patterns", async () => {
  const f = fixture(), selected = selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures);
  const prior = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, [], mockEmbedding);
  const fresh = { ...copy(prior.publication), id: "new-v5", records: [], transitions: [], errors: [], episodeIds: [] };
  const merged = mergePriorPublication(fresh, prior.publication, selected.bundle, prior.records, prior.summary, [researchScope(f.manifest.runs[0])]);
  assert.equal(merged.publication.records.length, prior.records.length);
  assert.deepEqual(merged.publication.records.map(row => row.embedding), prior.records.map(row => row.embedding));
  assert.deepEqual(merged.publication.episodeIds, prior.publication.episodeIds);
  assert(merged.publication.records.every(row => row.id.startsWith("legacy:") && row.pattern.snapshotId === "new-v5"));
  const stripped = merged.publication.records.map(({ episodeId: _id, supportingEpisodeIds: _support, goalEmbedding: _goal, ...row }) => row);
  new FrozenRepository("new-v5", stripped, merged.publication.heldoutFamilies);
  const other = mergePriorPublication(fresh, prior.publication, selected.bundle, prior.records, prior.summary, [{ ...researchScope(f.manifest.runs[0]), toolSchemaHash: "another-schema" }]);
  assert.equal(other.publication.records.length, 0);
  assert(other.omittedPriorPatterns.every(row => row.reason === "incompatible_current_scope_or_tool_schema"));
});

test("prior merge rejects tampered vectors and out-of-split failure/statistic lineage", async () => {
  const f = fixture(), selected = selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures);
  const prior = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, [], mockEmbedding);
  const fresh = { ...copy(prior.publication), id: "new-v5", records: [], transitions: [], errors: [], episodeIds: [] };
  const scopes = [researchScope(f.manifest.runs[0])];
  const changed = copy(prior.records); changed[0].embedding[0] = 2;
  assert.throws(() => mergePriorPublication(fresh, prior.publication, selected.bundle, changed, prior.summary, scopes), /identity/);
  assert.throws(() => mergePriorPublication({ ...fresh, heldoutFamilies: [selected.episodes[0].family] }, prior.publication, selected.bundle, prior.records, prior.summary, scopes), /lineage/);
  const bad = copy(prior.publication); bad.transitions[0].sourceEpisodeIds.push("unseen-calibration");
  assert.throws(() => mergePriorPublication(fresh, bad, selected.bundle, prior.records, prior.summary, scopes), /lineage/);
  const missing = copy(selected.bundle); missing.verifications.pop();
  assert.throws(() => mergePriorPublication(fresh, prior.publication, missing, prior.records, prior.summary, scopes), /lineage/);
});

test("prior patterns with excluded positive or failure statistics are omitted without reusing their fitted values", async () => {
  const f = fixture(), selected = selectV5Training(f.episodes, f.bundle, f.manifest, f.fixtures);
  const prior = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, [], mockEmbedding);
  const fresh = { ...copy(prior.publication), id: "new-v5", records: [], transitions: [], errors: [], episodeIds: [] };
  const allowed = [...new Set(selected.episodes.map(episode => episode.family))].filter(family => family !== "retail:family-15");
  const merged = mergePriorPublication(fresh, prior.publication, selected.bundle, prior.records, prior.summary, [researchScope(f.manifest.runs[0])], allowed);
  assert.equal(merged.publication.records.length, 0);
  assert(merged.omittedPriorPatterns.length > 0);
  assert(merged.omittedPriorPatterns.every(row => row.reason === "support_or_statistics_outside_actual_fitting_families"));
  assert.equal(merged.publication.episodeIds.length, 30);
  assert(merged.publication.heldoutFamilies.includes("retail:family-15"));
  assert.deepEqual(prior.publication.episodeIds.length, 32);
});

test("prepare writes a source-bound symbolic plan without vectors or provider dispatch; changed sources reject before ledger access", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-library-v5-")), exported = join(directory, "export");
  mkdirSync(exported);
  const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
  const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const f = fixture(), fixturePath = join(directory, "fixtures.json"), manifestPath = join(directory, "service.json"), inputPath = join(directory, "inputs.json");
  write(fixturePath, f.fixtures); write(manifestPath, f.manifest);
  f.bundle.dataset.metadata.fixtureManifestHash = fileHash(fixturePath);
  for (const episode of f.bundle.episodes) {
    const verdict = f.bundle.verifications.find(row => row.episodeId === episode.id)!;
    const path = join(directory, `${episode.id}.json`);
    write(path, { record: { runId: episode.id, taskId: episode.sourceId, familyId: episode.familyId, domain: episode.domain, arm: "base", success: verdict.success }, verdict: verdict.verdict });
    episode.transcriptUri = path; episode.contentHash = fileHash(path); verdict.evidenceUri = path; verdict.evidenceHash = fileHash(path);
  }
  write(join(exported, "mining-episodes.json"), f.episodes); write(join(exported, "repository-bundle.json"), f.bundle); write(join(exported, "export-manifest.json"), { episodes: 40 });
  const ledger = join(directory, "test-ledger-existence-only.jsonl"); writeFileSync(ledger, "");
  const receiptPath = join(directory, "pipeline.json");
  const oldFit = Array.from({ length: 11 }, (_, index) => `retail:old-${index}`);
  const freshSplits = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`retail:family-${index}`, index < 12 ? "train" : index < 16 ? "selection" : "calibration"]));
  const receiptBody = { version: "goalspec-v5-post-closure-training-pipeline-v1", freshSplits,
    oldObservedFittingFamilies: oldFit, allowedMemoryFamilies: [...oldFit, ...Object.keys(freshSplits).filter(family => freshSplits[family] === "train")],
    excludedMemoryFamilies: Object.keys(freshSplits).filter(family => freshSplits[family] !== "train"),
    inputs: [fixturePath, manifestPath].map(path => ({ path, sha256: fileHash(path) })), source: { path: manifestPath, sha256: fileHash(manifestPath) } };
  write(receiptPath, { ...receiptBody, contentHash: hash(receiptBody) });
  const inputs = { exportDirectory: exported, fixtureManifest: fixturePath, serviceManifest: manifestPath, snapshotId: "native-training-v5-test", budgetJournal: ledger };
  write(inputPath, inputs);
  await assert.rejects(prepareLibraryV5(inputPath, join(directory, "rejected-missing-receipt")), /receipt required/);
  write(inputPath, { ...inputs, eligibilityReceipt: receiptPath });
  const wrong = { ...receiptBody, allowedMemoryFamilies: [...receiptBody.allowedMemoryFamilies, "retail:family-12"] };
  write(receiptPath, { ...wrong, contentHash: hash(wrong) });
  await assert.rejects(prepareLibraryV5(inputPath, join(directory, "rejected-selection-family")), /Invalid actual fitting-family/);
  write(receiptPath, { ...receiptBody, contentHash: hash(receiptBody) });
  const planDirectory = join(directory, "plan");
  const plan = await prepareLibraryV5(inputPath, planDirectory);
  assert.equal(plan.selectedEpisodeIds.length, 24); assert.equal(plan.excludedCalibrationEpisodeIds.length, 8); assert.equal(plan.excludedSelectionEpisodeIds.length, 8);
  assert(plan.sources.some(item => item.path === receiptPath && item.sha256 === fileHash(receiptPath)));
  assert(plan.freshPatternPlan.length > 0); assert(plan.maximumEmbeddingMicrodollars < plan.reservationMicrodollars);
  assert(!readFileSync(join(planDirectory, "plan.json"), "utf8").includes('"embedding":'));
  assert.equal(readFileSync(ledger, "utf8"), "");
  write(fixturePath, { changedAfterFreeze: true });
  await assert.rejects(dispatchLibraryV5(join(planDirectory, "plan.json"), join(directory, "never-dispatched")), /Frozen library source changed/);
  assert.equal(readFileSync(ledger, "utf8"), "");
});
