import assert from "node:assert/strict";
import {
  buildContextProcurementRequest,
  buildProcurementRequestSpecificContextSnapshot,
  normalizeContextProcurementDraft,
} from "../src/lib/supply-os/context-procurement";
import { stripCitationTokens } from "../src/lib/supply-os/context-agent";

const draft = normalizeContextProcurementDraft({
  material: "HD-ENC-01 enclosure",
  specification: "PC-ABS, black, textured finish",
  manufacturer: "Example Plastics",
  partNumber: "HD-ENC-01",
  quantity: 100,
  unit: "units",
  neededBy: "2026-09-15",
  deliveryLocation: "Los Angeles, CA",
  notes: "Run supplier research only after confirmation.",
});
assert(draft);
assert.equal(normalizeContextProcurementDraft({ ...draft, quantity: 0 }), null);
assert.equal(normalizeContextProcurementDraft({ ...draft, neededBy: "09/15/2026" })?.neededBy, null);
assert.equal(normalizeContextProcurementDraft({ ...draft, neededBy: "within 8 weeks" })?.neededBy, null);
assert.equal(normalizeContextProcurementDraft({ ...draft, neededBy: "2026-02-30" })?.neededBy, null);
assert.equal(normalizeContextProcurementDraft({ ...draft, neededBy: "2026-09-15 or later" })?.neededBy, null);

assert.equal(
  stripCitationTokens("Confirmed. [document:0ecd2b93-1] [message:37b81baf-2] The spec covers it."),
  "Confirmed. The spec covers it.",
);
assert.equal(
  stripCitationTokens("Is PC-ABS [document:abc] required?"),
  "Is PC-ABS required?",
);
assert.equal(
  normalizeContextProcurementDraft({ ...draft, specification: "PC-ABS \u2014 black" })?.specification,
  "PC-ABS - black",
);

const packet = {
  company: { id: "company-a", name: "HypnoDreamz" },
  documents: [{
    citationId: "document:relevant",
    name: "enclosure-spec.csv",
    summary: "PC-ABS enclosure specification.",
    markdown: "# Enclosure\n\nPart HD-ENC-01 uses PC-ABS.",
    processedAt: new Date("2026-08-20T10:00:00.000Z"),
  }, {
    citationId: "document:sibling",
    name: "unrelated-motor.txt",
    summary: "Motor requirement.",
    markdown: "This sibling part must not enter the request-specific snapshot.",
    processedAt: new Date("2026-08-20T10:00:00.000Z"),
  }],
  messages: [{
    citationId: "message:request",
    role: "OPERATOR" as const,
    body: "Start procurement for 100 HD-ENC-01 enclosures.",
    createdAt: new Date("2026-08-20T11:00:00.000Z"),
  }, {
    citationId: "message:unrelated",
    role: "OPERATOR" as const,
    body: "This is about a different part.",
    createdAt: new Date("2026-08-20T09:00:00.000Z"),
  }, {
    citationId: "message:agent",
    role: "AGENT" as const,
    body: "Generated text is not evidence.",
    createdAt: new Date("2026-08-20T11:01:00.000Z"),
  }],
};

const snapshot = buildProcurementRequestSpecificContextSnapshot({
  packet,
  draft,
  citationIds: ["message:request", "document:relevant", "message:agent"],
});
assert.equal(snapshot.priority, "request_specific");
assert.equal(snapshot.documents.length, 1);
assert.equal(snapshot.documents[0]?.citation_id, "document:relevant");
assert.equal(snapshot.operator_messages.length, 1);
assert.equal(snapshot.operator_messages[0]?.citation_id, "message:request");
assert.doesNotMatch(JSON.stringify(snapshot), /sibling part|Generated text/);
assert.equal(
  buildProcurementRequestSpecificContextSnapshot({
    packet,
    draft,
    citationIds: ["message:request", "document:relevant", "message:agent"],
  }).version,
  snapshot.version,
);

const request = buildContextProcurementRequest({
  actionId: "action-a",
  workspaceId: "workspace-a",
  companyName: "HypnoDreamz",
  draft,
  specificContext: snapshot,
});
assert.equal(request.material, "HD-ENC-01 enclosure");
assert.match(request.specification ?? "", /^\[Request-specific procurement context/);
assert.match(request.specification ?? "", /enclosure-spec\.csv/);
assert.doesNotMatch(request.specification ?? "", /unrelated-motor/);
assert.equal((request.requestContext.source as Record<string, unknown>).workspace_id, "workspace-a");
assert.equal(
  (request.requestContext.procurement_context as { version: string }).version,
  snapshot.version,
);
assert.equal(request.idempotencyKey, "supply-os-context-procurement:v1:action-a");

console.log("Supply OS Context procurement contract passed.");
