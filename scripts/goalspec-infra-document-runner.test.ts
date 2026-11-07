import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hash } from "../src/lib/goalspec/canonical";
import { DOCUMENT_TOOLS, documentCandidates, validateDocumentBinding } from "../services/goalspec-runtime/document-adapter";
import { runDocumentTrial } from "../services/goalspec-runtime/infra-document-runner";
import { InfraTelemetry } from "../services/goalspec-runtime/infra-telemetry";
import type { InfraSessionPolicy } from "../src/lib/goalspec/infra-session";
const content = "Required runtime: Node 22.";
const body = { version: 1 as const, id: "fixture-corpus", documents: [{ id: "setup", title: "Setup", snippet: "runtime requirements", familyId: "install", url: `https://raw.githubusercontent.com/example/docs/${"a".repeat(40)}/README.md`, sha256: createHash("sha256").update(content).digest("hex") }] };
const corpus = { ...body, contentHash: hash(body) };
const scope = { tenantId: "research", principalId: "operator", authorizationVersion: "1", environmentVersion: "fixture", toolSchemaHash: hash(DOCUMENT_TOOLS) };

test("three infrastructure arms preserve actor inputs, physical observations and independent task verification", async () => {
  const directory = await mkdtemp(join(tmpdir(), "goalspec-infra-trial-"));
  const results = [];
  try {
    for (const arm of ["base", "neutral_memory_prefetch", "goalspec"] as const) {
      const telemetry = await InfraTelemetry.create(join(directory, arm));
      let step = 0;
      const policy: InfraSessionPolicy = { arm, memoryHash: hash({}), goalReliability: 0,
        opportunity: () => ({ toolMs: 1000, actorLeadMs: 1000, predictionMs: 0, schedulingMs: 0, validationMs: 0, contentionMs: 0 }),
        candidates: documentCandidates, validateBinding: validateDocumentBinding,
        rank: async (_, candidates) => ({ action: candidates.length ? "READ" : "NO_READ", scores: candidates.map(candidate => ({ candidateId: candidate.id, probability: 1 })) }) };
      const result = await runDocumentTrial({ runId: arm, task: { id: "task", familyId: "install", split: "test", prompt: "Find runtime requirements", expectedDocuments: ["setup"], answerContains: ["Node 22"] },
        corpus, scope, snapshotId: "snapshot", seed: 42, policy, telemetry, experimentKind: "execution_replay", fetch: async () => new Response(content),
        actor: async () => {
          await new Promise(resolve => setImmediate(resolve));
          if (step++ === 0) return { role: "assistant", tool_calls: [{ id: "actual-search", name: "search_documents", arguments: { query: "runtime" } }] };
          if (step === 2) return { role: "assistant", tool_calls: [{ id: "actual-fetch", name: "fetch_document", arguments: { document_id: "setup" } }] };
          return { role: "assistant", content: "Node 22 is required [setup]." };
        } });
      await telemetry.close(); results.push(result);
      assert.equal(result.success, true); assert.equal(result.logicalCalls, 2); assert.equal(result.physicalCalls, 2);
      assert.match(await readFile(join(directory, arm, "metrics.prom"), "utf8"), /goalspec_tasks_total/);
      const events = (await readFile(join(directory, arm, "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
      const generations = events.filter(event => event.type === "actor_generated");
      assert.equal(generations.length, 3);
      for (const event of generations) {
        assert.equal(event.runId, arm); assert.equal(event.boundaryId, `${arm}:${event.checkpoint}`);
        assert.equal(event.actorInputHashKind, "public_boundary_fixture");
        assert.match(event.actorResponseHash, /^[a-f0-9]{64}$/);
      }
      const fetchGenerated = events.findIndex(event => event.type === "actor_generated" && event.checkpoint === 1);
      const promotion = events.findIndex(event => event.type === "promotion_requested");
      if (arm !== "base") assert.ok(promotion > fetchGenerated);
    }
    assert.deepEqual(results[0].actorInputHashes, results[1].actorInputHashes);
    assert.deepEqual(results[1].actorInputHashes, results[2].actorInputHashes);
    assert.equal(results[0].speculativeStarts, 0); assert.equal(results[1].speculativeStarts, 1); assert.equal(results[1].useful, 1);
    assert.equal(results[2].transcriptHash, results[0].transcriptHash);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
