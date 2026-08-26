import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  externalPoState,
  externalSelectedVendorId,
  externalSourcingActive,
  externalVendorPoReady,
  externalVendorPoState,
  externalVendorResponseCount,
  groupActiveHistoricalSourcing,
  groupHistoricalSourcing,
  historicalPoState,
  historicalPoReady,
  historicalResponseCount,
  historicalSourcingActive,
  historicalSituation,
  historicalSupplierContacted,
  historicalSupplierResponded,
} from "../src/app/dashboard/supply-os/supply-os-active-sourcing-model";
import type { SavedProcurementCase } from "../src/app/dashboard/supply-os/supply-os-sourcing-research-types";
import type { CustomerProcurementListItem } from "../src/lib/supply-os/customer-procurement";
import type { CustomerProcurementRequestDetail } from "../src/lib/supply-os/customer-procurement-status";

function sourcingCase(input: {
  id: string;
  supplier: string;
  sent?: boolean;
  replies?: number;
  purchase?: "draft" | "pending" | "approved" | "released" | "acknowledged";
}) {
  return {
    id: input.id,
    status: "PLANNED",
    taskKey: `case:${input.id}`,
    input: {
      researchRunId: "run-1",
      researchInput: {
        componentItemKey: "PART-1",
        componentName: "Motor controller",
        manufacturer: null,
        mpn: null,
        specification: "48 V",
        targetCountry: null,
        requestText: "Source 20 motor controllers",
      },
    },
    result: {
      stage: input.purchase === "pending" ? "APPROVAL_PENDING" : input.purchase ? "PURCHASE_READY" : "COMMERCIAL_CONFIRMATION",
      selectedOption: { name: input.supplier },
      purchaseRelease: input.purchase === "released" || input.purchase === "acknowledged"
        ? { state: input.purchase === "acknowledged" ? "ACKNOWLEDGED" : "RELEASED" }
        : undefined,
    },
    quoteCycle: {
      result: {
        release: input.sent ? { channel: "EMAIL" } : null,
        responses: Array.from({ length: input.replies ?? 0 }, (_, index) => ({ responseHash: String(index) })),
        connectedReplies: [],
      },
    },
    supplierEmailAction: input.sent ? { result: { state: "SENT" } } : null,
    purchaseDraft: input.purchase === "draft" ? { id: "draft" } : null,
    purchaseAction: input.purchase === "approved" || input.purchase === "pending"
      ? { approval: { status: input.purchase === "approved" ? "APPROVED" : "PENDING" } }
      : null,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: `2026-08-21T00:00:0${input.id}.000Z`,
  } as unknown as SavedProcurementCase;
}

const contacted = sourcingCase({ id: "1", supplier: "Supplier one", sent: true });
const responded = sourcingCase({ id: "2", supplier: "Supplier two", sent: true, replies: 1, purchase: "draft" });
const released = sourcingCase({ id: "3", supplier: "Supplier three", sent: true, replies: 1, purchase: "released" });
assert.equal(historicalSupplierContacted(contacted), true);
assert.equal(historicalSupplierResponded(contacted), false);
assert.equal(historicalSupplierResponded(responded), true);
assert.equal(historicalResponseCount(responded), 1, "Stored responses must remain visible when connected replies is an empty array.");
assert.equal(historicalPoState(responded), "PO draft ready");
assert.equal(historicalPoState(released), "Purchase order sent");
assert.equal(historicalPoReady(sourcingCase({ id: "4", supplier: "Pending supplier", purchase: "pending" })), false);
assert.equal(historicalSourcingActive(released), true);
assert.equal(historicalSourcingActive(sourcingCase({ id: "5", supplier: "Complete supplier", purchase: "acknowledged" })), false);
assert.match(historicalSituation(contacted), /waiting for a supplier response/i);
assert.equal(externalPoState("awaiting_order_approval"), "Ready for PO approval");

const externalRequest = {
  id: "request-1",
  status: "awaiting_order_approval",
  progress: null,
  neededBy: null,
  quantity: 20,
  unit: "units",
  material: "Controller",
  specification: null,
  requestContext: {},
  supplierCount: 2,
  contactedCount: 2,
  responseCount: 2,
  updatedAt: "2026-08-21T00:00:00.000Z",
} satisfies CustomerProcurementListItem;
const externalDetail = {
  ...externalRequest,
  approvalRequestedAt: "2026-08-21T00:00:00.000Z",
  decisionSnapshot: { selection: { selected_vendor_id: "vendor-2" } },
  vendors: [],
} satisfies CustomerProcurementRequestDetail;
assert.equal(externalSelectedVendorId(externalDetail), "vendor-2");
assert.equal(externalVendorPoReady(externalRequest, externalDetail, "vendor-1"), false);
assert.equal(externalVendorPoReady(externalRequest, externalDetail, "vendor-2"), true);
assert.equal(externalVendorPoState(externalRequest, externalDetail, "vendor-1"), "Not selected for PO");
assert.equal(externalVendorPoState(externalRequest, { ...externalDetail, decisionSnapshot: null }, "vendor-1"), "PO approval pending, supplier selection not recorded");
assert.equal(externalSourcingActive(externalRequest), true);
assert.equal(externalSourcingActive({ ...externalRequest, status: "ordered" }), false);
assert.equal(externalSourcingActive({ ...externalRequest, status: "cancelled" }), false);
assert.equal(externalVendorResponseCount({ responseCount: 1, quote: null }), 1);
assert.equal(externalVendorResponseCount({ responseCount: 0, quote: { amount: 100 } }), 1);

const grouped = groupHistoricalSourcing([], [contacted, responded, released]);
assert.equal(grouped.length, 1);
assert.deepEqual({
  suppliers: grouped[0]?.supplierCount,
  contacted: grouped[0]?.contactedCount,
  responses: grouped[0]?.responseCount,
  poReady: grouped[0]?.poReadyCount,
}, { suppliers: 3, contacted: 3, responses: 2, poReady: 2 });
const activeGrouped = groupActiveHistoricalSourcing([], [contacted, responded, released, sourcingCase({
  id: "6",
  supplier: "Completed supplier",
  sent: true,
  replies: 1,
  purchase: "acknowledged",
})]);
assert.deepEqual({
  suppliers: activeGrouped[0]?.supplierCount,
  responses: activeGrouped[0]?.responseCount,
  poReady: activeGrouped[0]?.poReadyCount,
}, { suppliers: 3, responses: 2, poReady: 2 }, "Inactive suppliers must not inflate active sourcing totals.");

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const inventory = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx"), "utf8");
const active = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-active-sourcing.tsx"), "utf8");
const workflow = readFileSync(resolve(root, "src/lib/procurement-workflow.ts"), "utf8");
const conversation = readFileSync(resolve(root, "src/lib/procurement-conversation.ts"), "utf8");
const conversationModel = readFileSync(resolve(root, "src/lib/procurement-conversation-model.ts"), "utf8");
const replyDraft = readFileSync(resolve(root, "src/lib/procurement-reply-draft.ts"), "utf8");
const replySend = readFileSync(resolve(root, "src/lib/procurement-reply-send.ts"), "utf8");
const logisticsStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"), "utf8");
const communicationLedgerSql = readFileSync(resolve(root, "scripts/sql/bourne-procurement-communication-ledger.sql"), "utf8");
const workflowRoute = readFileSync(resolve(root, "src/app/api/procurement/requests/[orderId]/vendors/[vendorId]/conversation/route.ts"), "utf8");
const replySendRoute = readFileSync(resolve(root, "src/app/api/procurement/requests/[orderId]/vendors/[vendorId]/conversation/send/route.ts"), "utf8");
const procurementRouteHandlers = readFileSync(resolve(root, "src/lib/procurement-route-handlers.ts"), "utf8");
const historicalRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-cases/[caseId]/conversation/route.ts"), "utf8");

assert.match(inventory, /Tabs\.Trigger value="messages"[\s\S]*Messages/);
assert.match(inventory, /<ActiveSourcingWorkspace/);
assert.match(dashboard, /messageResearchRuns=\{researchRuns\}/);
assert.match(dashboard, /messageProcurementCases=\{procurementCases\}/);
assert.match(dashboard, /activeOnly: "true"/);
assert.match(dashboard, /params\.set\("sourceWorkspaceId", sourcingWorkspaceId\)/);
assert.match(active, /Reached out/);
assert.match(active, /Responded/);
assert.match(active, /Conversation/);
assert.match(active, /Situation read/);
assert.match(active, /Purchase order/);
assert.match(active, /activeWorkflowRequests/);
assert.match(active, /Historical totals cover loaded records/);
assert.match(active, /Draft reply/);
assert.match(active, /Send reply/);
assert.match(active, /Confirm send/);
assert.match(active, /confirmed: true/);
assert.match(active, /conversation\/send/);
assert.match(active, /Derya sends only after you confirm/);
assert.match(active, /externalVendorResponseCount\(vendor\)/);
assert.match(active, /sourceMessageId: displayedInbound\.id/);
assert.match(active, /error\.status === 409/);
assert.match(active, /setConversationRevision/);
assert.match(inventory, /value=\{activeView\}/);
assert.match(dashboard, /data-materials-view=\{activePanel === "materials" \? inventoryWorkspaceView : undefined\}/);
assert.match(dashboard, /inventoryWorkspaceView === "inventory"/);
assert.match(logisticsStyles, /data-materials-view="messages"[\s\S]*grid-template-areas: "materials"/);
assert.match(workflow, /AS "contactedCount"/);
assert.match(workflow, /AS "responseCount"/);
assert.match(workflow, /orders\.customer_id = \$3::uuid/);
assert.match(workflow, /getProcurementCommunicationMessagesFromDatabase/);
assert.match(workflow, /communication\.customer_id = \$1::uuid/);
assert.match(workflow, /communication\.order_id = \$2::uuid/);
assert.match(workflow, /communication\.vendor_id = \$3::uuid/);
assert.match(conversation, /thread: \{ officeId \}/);
assert.match(
  conversation,
  /localProviderThreadMessages\(args\.officeId, providerThreadId\)/,
  "stored mail stays office scoped even though mailboxes are shared",
);
assert.doesNotMatch(
  conversation,
  /emailAccount\.findMany\(\{\s*where: \{\s*officeId/,
  "the sending mailbox comes from the shared pool, so account lookups are global",
);
assert.match(conversationModel, /source: "BOURNE_LEDGER"/);
assert.match(conversationModel, /if \(ledgerMessages\?\.length\) return procurementConversationFromLedgerMessages\(ledgerMessages\)/);
assert.match(conversation, /const resolved = await resolveProcurementVendorConversation\(args/);
assert.match(conversation, /procurementConversationParticipantEmails\(anchor\)\.includes\(contactEmail\)/);
assert.match(conversationModel, /fromEmail\.toLowerCase\(\) === normalizedContact \? "INBOUND"/);
assert.match(communicationLedgerSql, /PRIMARY KEY \(customer_id, provider, account_email, provider_message_id\)/);
assert.match(communicationLedgerSql, /GRANT SELECT ON public\.procurement_communication_messages TO dashboard_api/);
assert.match(workflowRoute, /resolveProcurementCustomerId\(session\)/);
assert.match(workflowRoute, /export async function POST/);
assert.match(workflowRoute, /handleProcurementReplyDraft/);
assert.match(procurementRouteHandlers, /procurementReplyDraftRequestSchema\.safeParse/);
assert.match(procurementRouteHandlers, /expectedSourceMessageId: parsedInput\.data\.sourceMessageId/);
assert.match(procurementRouteHandlers, /draftProcurementSupplierReply/);
assert.doesNotMatch(workflowRoute, /gmail.*send|messages\.send/i);
assert.match(procurementRouteHandlers, /handleProcurementReplySend/);
assert.match(replySendRoute, /handleProcurementReplySend/);
assert.match(replySend, /PROCUREMENT_SUPPLIER_REPLY_EMAIL/);
assert.match(replySend, /pg_advisory_xact_lock/);
assert.match(replySend, /taskKey: \{ startsWith: `\$\{taskScopeKey\}:` \}/);
assert.match(replySend, /sourceMessageId: input\.sourceMessageId/);
assert.match(replySend, /operatorConfirmation/);
assert.match(replySend, /provider\.reconcile/);
assert.match(replySend, /Gmail delivery is still unresolved/);
assert.match(replySend, /tx\.emailMessage\.create/);
assert.match(replySend, /appendSupplierCommunicationEvent/);
assert.doesNotMatch(replySend, /procurement_communication_messages[\s\S]*(?:INSERT|UPDATE|DELETE)/i);
assert.match(replyDraft, /Do not accept commercial terms/);
assert.match(replyDraft, /latestInbound/);
assert.match(historicalRoute, /supplyAccessContext\(session\)/);
assert.doesNotMatch(active, /gmailMessageId|gmail_message_id/);

console.log("Supply OS active sourcing and conversation contract passed.");
