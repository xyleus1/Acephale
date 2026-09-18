import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLibrary, type RepositoryBundle } from "./goalspec-build-library";
import { hash } from "../src/lib/goalspec/canonical";
import type { MiningEpisode } from "../src/lib/goalspec/miner";
import type { ResearchManifest } from "../services/goalspec-runtime/research-bootstrap";

function fixture() {
  const tools = [{ type: "function" as const, function: { name: "get_order_details", parameters: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } } }];
  const episodes: MiningEpisode[] = [0, 1].map(index => ({ id: `episode-${index}`, family: `retail:family-${index}`, benchmark: "custom-tau", domain: "retail",
    canonicalGoalId: "read_order", verifiedSuccess: true, checkpoints: [{ prefix: { throughSeq: 1, signatures: ["get_user_details:success"],
      tools: tools.map(tool => ({ name: tool.function.name, parameters: tool.function.parameters })), events: [
        { seq: 0, kind: "tool_request", call_id: "actual-id", tool: "get_user_details", arguments: { user_id: `current-${index}` } },
        { seq: 1, kind: "tool_result", call_id: "actual-id", tool: "get_user_details", status: "success", result: { orders: [`ORDER-${index}`] } },
      ] }, targets: [{ tool: "get_order_details", arguments: { order_id: `ORDER-${index}` } }] }] }));
  const manifest: ResearchManifest = { schemaVersion: 1, snapshotId: "empty-training", heldoutFamilies: [], runs: episodes.map(episode => ({ runId: episode.id,
    arm: "base", domain: "retail", allocation: "training", maxCostMicrodollars: 1_250_000, maxBoundaries: 40, tools })) };
  const bundle: RepositoryBundle = { dataset: { id: "fixture", source: "unit-test", revision: "fixture", contentHash: "a".repeat(64), license: "test", parserVersion: "test", rawCount: 2, admittedCount: 2, metadata: {} },
    episodes: episodes.map(episode => ({ id: episode.id, datasetId: "fixture", sourceId: episode.id, domain: "retail", familyId: episode.family, split: "train",
      environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(tools), verificationTier: "native_verified", transcriptUri: "fixture-only", contentHash: "b".repeat(64), metadata: {} })),
    verifications: episodes.map(episode => ({ episodeId: episode.id, verifierVersion: "fixture", verifierCodeHash: "c".repeat(64), evidenceHash: "d".repeat(64),
      evidenceUri: "fixture-only", success: true, constraintsSatisfied: true, verdict: {} })) };
  return { episodes, manifest, bundle };
}

test("library requires two independent families and binds current observations", async () => {
  const { episodes, manifest, bundle } = fixture();
  let embeddings = 0;
  const result = await buildLibrary(episodes, bundle, manifest, ["retail:heldout"], async () => { embeddings++; return [1, ...Array(1535).fill(0)]; });
  assert.ok(result.records.length > 0);
  assert.equal(embeddings, result.records.length);
  assert.ok(result.records.every(record => record.pattern.tool === "get_order_details"));
  assert.ok(result.publication.records.every(record => record.supportingEpisodeIds?.length === 1));
  assert.ok(result.publication.transitions.every(row => row.independentSupport === 2));
  assert.ok(result.records.every(record => !JSON.stringify(record.pattern.binding).includes("ORDER-")));
  assert.ok(result.publication.errors.every(row => row.errors === 0 && row.details.independentTestEstimate === false));
});

test("library rejects heldout lineage and refuses to treat failed endpoints as verified", async () => {
  const { episodes, manifest, bundle } = fixture();
  await assert.rejects(buildLibrary(episodes, bundle, manifest, [episodes[0].family], async () => []), /provenance/);
  bundle.verifications[0].success = false;
  await assert.rejects(buildLibrary(episodes, bundle, manifest, [], async () => []), /provenance/);
  episodes[0].verifiedSuccess = false;
  const empty = await buildLibrary(episodes, bundle, manifest, [], async () => { throw new Error("Embedding must not be called without eligible patterns"); });
  assert.equal(empty.records.length, 0);
  assert.equal(empty.publication.episodeIds.length, 2);
});
