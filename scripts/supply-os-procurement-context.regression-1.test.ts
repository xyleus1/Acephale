// Regression: ISSUE-002 - Supplier research could not see saved company Context.
// Found by /qa on 2026-08-20
// Report: .gstack/qa-reports/qa-report-app-derya-ai-2026-08-20.md

import assert from "node:assert/strict";
import { procurementRequestSchema } from "../src/lib/procurement-contract";
import type { ProcurementRequestInput } from "../src/lib/procurement-contract";
import { handleProcurementPost } from "../src/lib/procurement-route-handlers";
import { ProcurementWorkflowError } from "../src/lib/procurement-workflow";
import { SupplyPersistenceError } from "../src/lib/supply-os/persistence";
import {
  buildProcurementCompanyContextSnapshot,
  contextualizeProcurementRequest,
} from "../src/lib/supply-os/procurement-company-context";

const input = procurementRequestSchema.parse({
  material: "PCB assembly",
  specification: "4-layer FR-4",
  quantity: 100,
  unit: "units",
  neededBy: null,
  notes: "Find qualified suppliers.",
  requestContext: {
    schema_version: 1,
    source: { campaign: "CUSTOM", workspace_id: "workspace-a" },
  },
  idempotencyKey: "context-regression-request",
});

const packet = {
  company: { id: "company-a", name: "HypnoDreamz" },
  documents: [{
    citationId: "document:file-a",
    name: "order-spec.png",
    summary: "PCB fabrication requirements.",
    markdown: "# PCB\n\n68.4 x 21.6 mm, four layers, black solder mask.",
    processedAt: new Date("2026-08-20T10:00:00.000Z"),
  }],
  messages: [{
    citationId: "message:operator-a",
    role: "OPERATOR" as const,
    body: "The supplier must support turnkey assembly.",
    createdAt: new Date("2026-08-20T11:00:00.000Z"),
  }, {
    citationId: "message:agent-a",
    role: "AGENT" as const,
    body: "This generated answer must not become evidence.",
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
  }],
};

const snapshot = buildProcurementCompanyContextSnapshot(packet);
assert(snapshot);
assert.equal(snapshot.company.name, "HypnoDreamz");
assert.equal(snapshot.trust, "untrusted_source_material");
assert.equal(snapshot.captured_at, "2026-08-20T11:00:00.000Z");
assert.equal(snapshot.documents[0]?.citation_id, "document:file-a");
assert.equal(snapshot.operator_messages.length, 1);
assert.doesNotMatch(JSON.stringify(snapshot), /generated answer/i);
assert.equal(buildProcurementCompanyContextSnapshot(packet)?.version, snapshot.version);
assert.notEqual(buildProcurementCompanyContextSnapshot({
  ...packet,
  documents: [{ ...packet.documents[0], processedAt: new Date("2026-08-20T13:00:00.000Z") }],
})?.version, snapshot.version);

async function main() {
  const dependencies = {
    resolveAccess: async (context: {
      userId: string;
      officeId: string;
      role: string;
      canViewWholeOffice: boolean;
    }) => ({
      ...context,
      role: "ADMIN",
      canViewWholeOffice: true,
    }),
    assemble: async () => packet,
  };
  const enriched = await contextualizeProcurementRequest({
    session: { userId: "user-a", officeId: "office-a" },
    input,
  }, dependencies);
  assert.match(enriched.specification ?? "", /order-spec\.png \[document:file-a\]/);
  assert.match(enriched.specification ?? "", /turnkey assembly/);
  assert.equal(
    (enriched.requestContext.company_context as { version: string }).version,
    snapshot.version,
  );

  let submitted: ProcurementRequestInput | null = null;
  const response = await handleProcurementPost(new Request("http://test.local/api/procurement/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }), {
    session: async () => ({ userId: "user-a", officeId: "office-a" }),
    resolveCustomerId: async () => "11111111-1111-4111-8111-111111111111",
    contextualize: (args) => contextualizeProcurementRequest(args, dependencies),
    submit: async (_customerId, request) => {
      submitted = request;
      return {
        orderId: "22222222-2222-4222-8222-222222222222",
        status: "new",
        created: true,
        retryWake: false,
        workflowWakeRequested: true,
      };
    },
    list: async () => [],
  });
  assert.equal(response.status, 201);
  assert(submitted);
  assert.match(submitted.specification ?? "", /order-spec\.png/);
  assert.equal(
    (submitted.requestContext.company_context as { version: string }).version,
    snapshot.version,
  );

  const unrelated = procurementRequestSchema.parse({
    ...input,
    requestContext: { source: { campaign: "GUILD2" } },
  });
  assert.equal(await contextualizeProcurementRequest({
    session: { userId: "user-a", officeId: "office-a" },
    input: unrelated,
  }, dependencies), unrelated);

  await assert.rejects(
    contextualizeProcurementRequest({
      session: { userId: "user-a", officeId: "office-a" },
      input,
    }, {
      ...dependencies,
      assemble: async () => {
        throw new SupplyPersistenceError("Supply workspace not found.", "not_found");
      },
    }),
    (error: unknown) => error instanceof ProcurementWorkflowError && error.code === "not_found",
  );

  console.log("Supply OS procurement Context regression passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
