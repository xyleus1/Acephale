import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

import {
  BENCHMARK_VECTOR_DIMENSIONS,
  BENCHMARK_VECTOR_MODEL_DTYPE,
  BENCHMARK_VECTOR_MODEL_ID,
  BENCHMARK_VECTOR_MODEL_REVISION,
  BENCHMARK_VECTOR_RUNTIME_PACKAGE,
  BENCHMARK_VECTOR_RUNTIME_VERSION,
  benchmarkVectorModelLoadRequest,
  benchmarkVectorIndexRowMatchesScope,
  compileBenchmarkVectorScopeFilter,
  type BenchmarkVectorIndexEntry,
} from "../src/lib/supply-os/benchmark/local-vector";

const record: BenchmarkVectorIndexEntry = {
  id: "chunk-a",
  officeId: "office-a",
  objectId: "object-a",
  objectOfficeId: "office-a",
  sourceType: "SUPPLIER_DOCUMENT",
  sourceExternalId: "source-a",
  canonicalType: "SUPPLIER_FACT",
  title: "Canonical supplier evidence",
  entityType: "company",
  entityId: "company-a",
  companyId: "company-a",
  contactId: null,
  inquiryId: null,
  jobId: null,
  emailThreadId: null,
  emailMessageId: null,
  jobDocumentId: null,
  strategyAssessmentId: null,
  agentProposalId: null,
  occurredAt: "2026-08-01T00:00:00.000Z",
  mentions: [
    { entityType: "workspace", entityId: "workspace-a" },
    { entityType: "supplier_key", entityId: "atlas-fasteners" },
    { entityType: "procurement_order", entityId: "order-a" },
  ],
};

assert.equal(BENCHMARK_VECTOR_RUNTIME_PACKAGE, "@huggingface/transformers");
assert.equal(BENCHMARK_VECTOR_RUNTIME_VERSION, "4.2.0");
assert.equal(BENCHMARK_VECTOR_MODEL_ID, "Xenova/all-MiniLM-L6-v2");
assert.match(BENCHMARK_VECTOR_MODEL_REVISION, /^[a-f0-9]{40}$/);
assert.equal(BENCHMARK_VECTOR_MODEL_DTYPE, "q8");
assert.equal(BENCHMARK_VECTOR_DIMENSIONS, 384);

const remoteModelRequest = benchmarkVectorModelLoadRequest({
  modelCache: join("benchmark-output", "model-cache"),
  allowRemoteModels: true,
});
assert.equal(remoteModelRequest.model, BENCHMARK_VECTOR_MODEL_ID);
assert.deepEqual(remoteModelRequest.options, {
  revision: BENCHMARK_VECTOR_MODEL_REVISION,
  dtype: BENCHMARK_VECTOR_MODEL_DTYPE,
});

const offlineModelRequest = benchmarkVectorModelLoadRequest({
  modelCache: join("benchmark-output", "model-cache"),
  allowRemoteModels: false,
});
assert.equal(isAbsolute(offlineModelRequest.model), true);
assert.equal(
  offlineModelRequest.model.endsWith(normalize(join(
    "Xenova",
    "all-MiniLM-L6-v2",
    BENCHMARK_VECTOR_MODEL_REVISION,
  ))),
  true,
);
assert.deepEqual(offlineModelRequest.options, {
  dtype: BENCHMARK_VECTOR_MODEL_DTYPE,
  local_files_only: true,
});

assert.equal(benchmarkVectorIndexRowMatchesScope(record, {
  officeId: "office-a",
  companyId: "company-a",
  workspaceId: "workspace-a",
  supplierKey: "atlas-fasteners",
}), true);
assert.equal(benchmarkVectorIndexRowMatchesScope(record, {
  officeId: "office-b",
  companyId: "company-a",
}), false, "Scope filtering must reject a same-identity row from another office before scoring.");
assert.equal(benchmarkVectorIndexRowMatchesScope(record, {
  officeId: "office-a",
  companyId: "company-b",
}), false, "Scope filtering must reject another company before scoring.");
assert.equal(benchmarkVectorIndexRowMatchesScope(record, {
  officeId: "office-a",
  companyId: "company-a",
  workspaceId: "workspace-a",
  supplierKey: "atlas-fastener",
}), false, "A similar supplier key must not establish an entity relationship.");
assert.equal(benchmarkVectorIndexRowMatchesScope(record, {
  officeId: "office-a",
  companyId: "company-a",
  workspaceId: "workspace-a",
  procurementOrderId: "order-a",
  dateRange: {
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-09-01T00:00:00.000Z",
  },
}), true);
assert.equal(benchmarkVectorIndexRowMatchesScope(record, {
  officeId: "office-a",
  companyId: "company-a",
  dateRange: { from: "2026-09-01T00:00:00.000Z" },
}), false);

const matchingDocument = {
  ...record,
  canonicalType: "company_document",
  sourceType: "DOCUMENT",
};
const filterDocuments = compileBenchmarkVectorScopeFilter({
  officeId: "office-a",
  companyId: "company-a",
  workspaceId: "workspace-a",
  supplierKey: "atlas-fasteners",
  canonicalTypes: ["company_document"],
  sourceTypes: ["DOCUMENT"],
  dateRange: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T00:00:00.000Z" },
});
assert.deepEqual([
  matchingDocument,
  { ...matchingDocument, occurredAt: "2026-08-31T00:00:00.000Z" },
  { ...matchingDocument, officeId: "office-b" },
  { ...matchingDocument, objectOfficeId: "office-b" },
  { ...matchingDocument, companyId: "company-b", entityId: "company-b" },
  { ...matchingDocument, mentions: [] },
  { ...matchingDocument, sourceType: "GMAIL" },
  { ...matchingDocument, canonicalType: "email_message" },
  { ...matchingDocument, occurredAt: "invalid" },
  { ...matchingDocument, occurredAt: "2026-07-31T23:59:59.999Z" },
  { ...matchingDocument, occurredAt: "2026-08-31T00:00:00.001Z" },
].map(filterDocuments), [true, true, false, false, false, false, false, false, false, false, false],
"A reused vector filter must retain both tenant checks, exact scope intersections, type filters and inclusive dates.");

async function assertSourceBoundaries() {
  const source = await readFile(
    join(process.cwd(), "src", "lib", "supply-os", "benchmark", "local-vector.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /benchmark\.(?:cases|runs|results)\b/i);
  assert.doesNotMatch(source, /gold_facts|gold_evidence|gold_dependencies/i);
  assert.match(source, /resolve\(config\.outputDir, "vector-runtime"\)/);
  assert.match(source, /refType: "knowledge_chunk"/);
  const runtimeSource = await readFile(
    join(process.cwd(), "src", "lib", "supply-os", "benchmark", "runtime.ts"),
    "utf8",
  );
  assert.match(runtimeSource, /retrieveVectorMemory/);
}

assertSourceBoundaries()
  .then(() => console.log("Supply state vector baseline tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
