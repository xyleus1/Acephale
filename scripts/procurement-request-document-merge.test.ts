import assert from "node:assert/strict";
import {
  mergeRequestContextDocuments,
  requestContextDocumentEntries,
  requestContextWorkspaceId,
  REQUEST_DOCUMENT_LINK_LIMIT,
  type RequestDocumentEntry,
} from "../src/lib/procurement-request-document-merge";
import { procurementOrderIdError } from "../src/lib/procurement-order-id";

// Relinking a sourcing request to its Context files must never drop what the
// request already stated it was quoted from, and must never invent a citation.

function document(overrides: Partial<RequestDocumentEntry>): RequestDocumentEntry {
  return {
    citation_id: "document:ctx-1",
    name: "hypnodreamz order 1 doc 2.csv",
    summary: "Bill of materials",
    markdown: "Component lines: 34",
    ...overrides,
  };
}

const legacyContext: Record<string, unknown> = {
  schema_version: 1,
  source: { campaign: "CUSTOM", workspace_id: " workspace-1 " },
  logistics: { destination: "San Francisco or Los Angeles" },
};

assert.equal(requestContextWorkspaceId(legacyContext), "workspace-1");
assert.equal(requestContextWorkspaceId({}), null);
assert.equal(requestContextWorkspaceId({ source: { workspace_id: "  " } }), null);
assert.deepEqual(requestContextDocumentEntries(legacyContext), []);

const linked = mergeRequestContextDocuments(legacyContext, [
  document({ citation_id: "document:ctx-1" }),
  document({ citation_id: "document:ctx-2", name: "hypnodreamz order 1 doc 1.png" }),
]);
assert.deepEqual(linked.added.map((entry) => entry.citation_id), ["document:ctx-1", "document:ctx-2"]);
assert.equal(linked.documents.length, 2);
assert.deepEqual(linked.requestContext.logistics, legacyContext.logistics);
assert.deepEqual(linked.requestContext.source, legacyContext.source);
assert.equal(requestContextDocumentEntries(linked.requestContext).length, 2);

// A second run adds nothing, so the command is safe to repeat.
const rerun = mergeRequestContextDocuments(linked.requestContext, [
  document({ citation_id: "document:ctx-1", markdown: "rewritten by a later Context edit" }),
  document({ citation_id: "document:ctx-2", name: "hypnodreamz order 1 doc 1.png" }),
]);
assert.deepEqual(rerun.added, []);
assert.equal(
  requestContextDocumentEntries(rerun.requestContext).find(
    (entry) => entry.citation_id === "document:ctx-1",
  )?.markdown,
  "Component lines: 34",
);

// Entries that are not document citations never reach a supplier attachment.
const rejected = mergeRequestContextDocuments(legacyContext, [
  document({ citation_id: "message:ctx-9" }),
  document({ citation_id: "document:" }),
  document({ name: "   " }),
  { citation_id: "document:ctx-3", name: "spec.png", summary: null, markdown: "" },
]);
assert.deepEqual(rejected.added.map((entry) => entry.citation_id), ["document:ctx-3"]);

const flood = mergeRequestContextDocuments(
  legacyContext,
  Array.from({ length: REQUEST_DOCUMENT_LINK_LIMIT + 5 }, (_unused, index) => (
    document({ citation_id: `document:ctx-${index}`, name: `file-${index}.stl` })
  )),
);
assert.equal(flood.documents.length, REQUEST_DOCUMENT_LINK_LIMIT);

// Existing request context that is not an object must not crash the merge.
const fromBrokenContext = mergeRequestContextDocuments(
  { procurement_context: "not an object" },
  [document({ citation_id: "document:ctx-4" })],
);
assert.equal(fromBrokenContext.documents.length, 1);

assert.equal(procurementOrderIdError(""), "orderId is required.");
assert.equal(procurementOrderIdError("not-a-uuid"), "orderId must be a sourcing request id.");
assert.equal(procurementOrderIdError("24cb31bd-d974-4040-939c-cd8e76dd8967"), null);

console.log("Procurement request document relink passed.");
