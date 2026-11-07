import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hash } from "../src/lib/acephale/canonical";
import { DOCUMENT_TOOLS, DocumentReadExecutor, documentCandidates, validateDocumentBinding, verifyDocumentCorpus } from "../services/acephale-runtime/document-adapter";
import type { ExecutionFrame, Invocation } from "../src/lib/acephale/contracts/generated";
import { SpeculationScheduler } from "../src/lib/acephale/scheduler";
const text = "Immutable public documentation.";
const sha256 = createHash("sha256").update(text).digest("hex");
const body = { version: 1 as const, id: "corpus", documents: [{ id: "current-doc", title: "Setup", snippet: "Installation requirements", familyId: "family-a", url: `https://raw.githubusercontent.com/example/docs/${"a".repeat(40)}/README.md`, sha256 }] };
const corpus = { ...body, contentHash: hash(body) };
const scope = { tenantId: "office", principalId: "operator", authorizationVersion: "v1", environmentVersion: "docs-v1", toolSchemaHash: hash(DOCUMENT_TOOLS) };
const frame: ExecutionFrame = { schemaVersion: 1, runId: "run", boundary: 0, scope, requestedObjective: "Read setup", policy: "Read", snapshotId: "frozen",
  sources: { "requirement:0": "Read setup", "observation:1": [{ document_id: "current-doc", title: "Setup" }] }, goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
const invocation: Invocation = { tool: "fetch_document", arguments: { document_id: "current-doc" }, scope };
test("immutable documents execute once and validate without another HTTP request", async () => {
  let calls = 0;
  const executor = new DocumentReadExecutor(corpus, scope, { fetch: async () => { calls++; return new Response(text); } }); executor.updateFrame(frame);
  const scheduler = new SpeculationScheduler("run", executor, () => {});
  scheduler.admit(documentCandidates(frame));
  const value = await scheduler.authoritative(invocation, async () => { throw new Error("Duplicate physical read"); });
  assert.equal((value as { content: string }).content, text); assert.equal(calls, 1);
  await scheduler.close();
});
test("source bindings reject historical values, hidden IDs and changed scope", async () => {
  const executor = new DocumentReadExecutor(corpus, scope); executor.updateFrame({ ...frame, sources: {} });
  assert.equal(executor.eligible(invocation), false);
  const candidate = documentCandidates(frame)[0]; assert.equal(validateDocumentBinding(candidate, frame), true);
  assert.equal(validateDocumentBinding({ ...candidate, invocation: { ...invocation, arguments: { document_id: "historical" } } }, frame), false);
  assert.throws(() => executor.updateFrame({ ...frame, scope: { ...scope, tenantId: "another" } }));
});
test("content changes, revocation and forged evidence fail closed", async () => {
  let allowed = true;
  const executor = new DocumentReadExecutor(corpus, scope, { authorize: () => allowed, fetch: async () => new Response(text) }); executor.updateFrame(frame);
  const previous = await executor.read(invocation, new AbortController().signal);
  assert.equal((await executor.validateFreshness(invocation, { ...(previous as object), content: "tampered" }, new AbortController().signal)).status, "stale");
  allowed = false;
  assert.equal((await executor.validateFreshness(invocation, previous, new AbortController().signal)).status, "denied");
  const changed = new DocumentReadExecutor(corpus, scope, { fetch: async () => new Response("changed") }); changed.updateFrame(frame);
  await assert.rejects(changed.read(invocation, new AbortController().signal), /content changed/);
});
test("only pinned HTTPS documents are allowed and byte caps stop oversized responses", async () => {
  const changed = { ...body, documents: [{ ...body.documents[0], url: "http://127.0.0.1/private" }] };
  assert.throws(() => verifyDocumentCorpus({ ...changed, contentHash: hash(changed) }));
  const executor = new DocumentReadExecutor(corpus, scope, { maxBytes: 3, fetch: async () => new Response(text) }); executor.updateFrame(frame);
  await assert.rejects(executor.read(invocation, new AbortController().signal), /byte budget/);
});
test("completed immutable documents are not proposed again", () => {
  assert.equal(documentCandidates({ ...frame, sources: { ...frame.sources, "observation:3": { document_id: "current-doc", content: text, sha256 } } }).length, 0);
});
test("speculation deduplication preserves a later authoritative repeat", async () => {
  let physicalReads = 0;
  const executor = new DocumentReadExecutor(corpus, scope, { fetch: async () => { physicalReads++; return new Response(text); } });
  executor.updateFrame(frame);
  const observation = await executor.read(invocation, new AbortController().signal);
  executor.updateFrame({ ...frame, boundary: 1, sources: { ...frame.sources, "observation:3": observation } });
  assert.equal(executor.eligible(invocation), false);
  assert.deepEqual(await executor.read(invocation, new AbortController().signal), observation);
  assert.equal(physicalReads, 2);
});
