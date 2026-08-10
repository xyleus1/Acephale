import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATLAS_ROBOTICS_INVENTORY,
  atlasInventorySummary,
  projectedAvailable,
  shortageQuantity,
} from "../src/lib/supply-os/atlas-robotics-inventory";
import { displayedSupplierQuote, supplierQuoteSignals } from "../src/lib/supply-os/quote-comparison";
import { hasDirtyWorkstream, markWorkstreamDraft, resolveWorkstreamDraft } from "../src/lib/supply-os/workstream-drafts";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const workbench = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx"), "utf8");
const procurement = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-procurement-workspace.tsx"), "utf8");
const researchRoute = readFileSync(resolve(root, "src/app/api/supply-os/supplier-research/route.ts"), "utf8");
const procurementCasesRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-cases/route.ts"), "utf8");
const procurementReviewRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-cases/[caseId]/review/route.ts"), "utf8");
const procurementApprovalRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-cases/[caseId]/approval/route.ts"), "utf8");
const quoteCycleRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-cases/[caseId]/quote-cycle/route.ts"), "utf8");
const quoteReleaseRoute = readFileSync(resolve(root, "src/app/api/supply-os/quote-cycles/[quoteCycleId]/release/route.ts"), "utf8");
const quoteResponseRoute = readFileSync(resolve(root, "src/app/api/supply-os/quote-cycles/[quoteCycleId]/responses/route.ts"), "utf8");
const evidenceRoute = readFileSync(resolve(root, "src/app/api/supply-os/evidence/[evidenceId]/route.ts"), "utf8");
const purchaseDraftRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-cases/[caseId]/purchase-draft/route.ts"), "utf8");
const purchaseActionRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-cases/[caseId]/purchase-action/route.ts"), "utf8");
const purchaseActionDecisionRoute = readFileSync(resolve(root, "src/app/api/supply-os/purchase-action-approvals/[approvalId]/decision/route.ts"), "utf8");
const purchaseAcknowledgmentRoute = readFileSync(resolve(root, "src/app/api/supply-os/purchase-actions/[actionId]/acknowledgments/route.ts"), "utf8");
const procurementDecisionRoute = readFileSync(resolve(root, "src/app/api/supply-os/procurement-approvals/[approvalId]/decision/route.ts"), "utf8");
const researchPersistence = readFileSync(resolve(root, "src/lib/supply-os/sourcing-research-persistence.ts"), "utf8");
const procurementPersistence = readFileSync(resolve(root, "src/lib/supply-os/procurement-case-persistence.ts"), "utf8");
const supplierCommunicationPersistence = readFileSync(resolve(root, "src/lib/supply-os/supplier-communication-persistence.ts"), "utf8");
const supplierEmailProvider = readFileSync(resolve(root, "src/lib/supply-os/supplier-email-provider.ts"), "utf8");
const supplierEmailDraftRoute = readFileSync(resolve(root, "src/app/api/supply-os/quote-cycles/[quoteCycleId]/email-draft/route.ts"), "utf8");
const supplierEmailApprovalRoute = readFileSync(resolve(root, "src/app/api/supply-os/supplier-email-drafts/[draftId]/approval/route.ts"), "utf8");
const supplierEmailDecisionRoute = readFileSync(resolve(root, "src/app/api/supply-os/supplier-email-approvals/[approvalId]/decision/route.ts"), "utf8");
const supplierEmailDeliveryRoute = readFileSync(resolve(root, "src/app/api/supply-os/supplier-email-actions/[actionId]/delivery/route.ts"), "utf8");
const supplierReplyPersistence = readFileSync(resolve(root, "src/lib/supply-os/supplier-reply-persistence.ts"), "utf8");
const connectedRepliesRoute = readFileSync(resolve(root, "src/app/api/supply-os/quote-cycles/[quoteCycleId]/connected-replies/route.ts"), "utf8");

assert.ok(ATLAS_ROBOTICS_INVENTORY.length >= 10, "the Atlas fixture should resemble a useful robotics component inventory");
assert.equal(new Set(ATLAS_ROBOTICS_INVENTORY.map((item) => item.sku)).size, ATLAS_ROBOTICS_INVENTORY.length, "inventory SKUs must be unique");
assert.ok(ATLAS_ROBOTICS_INVENTORY.every((item) => item.quantityPerRobot > 0 && item.onHand >= 0 && item.allocated >= 0 && item.confirmedInbound >= 0));
assert.ok(ATLAS_ROBOTICS_INVENTORY.every((item) => projectedAvailable(item) >= 0));

const shortages = ATLAS_ROBOTICS_INVENTORY.filter((item) => shortageQuantity(item) > 0);
assert.ok(shortages.length >= 4, "the demo needs multiple actionable shortages");

const quoteA = { responseHash: "older", price: "12", currency: "USD", unitOfMeasure: "EA", deliveryDate: "2026-09-20" };
const quoteB = { responseHash: "selected", price: "14", currency: "USD", unitOfMeasure: "EA", deliveryDate: "2026-09-18" };
assert.equal(displayedSupplierQuote([quoteA, quoteB], "older")?.responseHash, "older", "the quote inbox must display the selected response rather than the latest response");
assert.equal(displayedSupplierQuote([quoteA, quoteB], null)?.responseHash, "selected", "before a quote is selected, the inbox may display the latest response");
assert.equal(displayedSupplierQuote([quoteA, quoteB], "missing"), null, "a broken selected-response reference must fail closed");
assert.deepEqual(supplierQuoteSignals([
  { id: "a", requestHash: "same-request", response: quoteA },
  { id: "b", requestHash: "same-request", response: quoteB },
]), { bestPriceId: "a", earliestId: "b" });
assert.deepEqual(supplierQuoteSignals([
  { id: "a", requestHash: "same-request", response: quoteA },
  { id: "box", requestHash: "same-request", response: { ...quoteB, price: "5", unitOfMeasure: "BOX" } },
]), { bestPriceId: null, earliestId: null }, "different units must never receive comparison badges");
assert.deepEqual(supplierQuoteSignals([
  { id: "a", requestHash: "same-request", response: quoteA },
  { id: "eur", requestHash: "same-request", response: { ...quoteB, price: "5", currency: "EUR" } },
]), { bestPriceId: null, earliestId: "eur" }, "mixed currencies may compare delivery but not price");
assert.deepEqual(supplierQuoteSignals([
  { id: "a", requestHash: "request-a", response: quoteA },
  { id: "b", requestHash: "request-b", response: quoteB },
]), { bestPriceId: null, earliestId: null }, "different RFQ scopes must never receive comparison badges");

const dirtyQuoteRequest = markWorkstreamDraft(null, "case-a", "quote-request");
const dirtyQuoteAndEmail = markWorkstreamDraft(dirtyQuoteRequest, "case-a", "supplier-email-draft");
assert.equal(hasDirtyWorkstream(dirtyQuoteAndEmail, "case-a"), true);
const savedEmailOnly = resolveWorkstreamDraft(dirtyQuoteAndEmail, "case-a", "supplier-email-draft");
assert.deepEqual(savedEmailOnly, { caseId: "case-a", sections: ["quote-request"] }, "saving an email must not clear unsaved RFQ edits");
assert.equal(hasDirtyWorkstream(savedEmailOnly, "case-a"), true, "unrelated unsaved fields must keep supplier switching blocked");
assert.equal(resolveWorkstreamDraft(savedEmailOnly, "case-a", "quote-request"), null, "saving the final dirty section clears the workstream guard");
const dirtyEmailAndApproval = markWorkstreamDraft(
  markWorkstreamDraft(null, "case-a", "supplier-email-draft"),
  "case-a",
  "supplier-email-approval",
);
assert.deepEqual(
  resolveWorkstreamDraft(dirtyEmailAndApproval, "case-a", "supplier-email-draft"),
  { caseId: "case-a", sections: ["supplier-email-approval"] },
  "saving one email form must preserve another unsaved form in the same supplier workstream",
);
assert.ok(shortages.every((item) => item.candidates.length >= 2), "each shortage needs a basic candidate comparison");
assert.ok(shortages.every((item) => item.candidates.every((candidate) => (
  candidate.leadTimeDays > 0
  && candidate.minimumOrderQuantity > 0
  && candidate.modeledUnitCostUsd > 0
  && Number.isFinite(candidate.coordinates.longitude)
  && Number.isFinite(candidate.coordinates.latitude)
))));

const summary = atlasInventorySummary();
assert.equal(summary.itemCount, ATLAS_ROBOTICS_INVENTORY.length);
assert.equal(summary.shortageCount, shortages.length);
assert.ok(summary.buildableWithInbound < summary.demandUnits, "the fixture should expose a real build constraint");

assert.match(dashboard, /activePanel === "materials"[\s\S]*AtlasInventoryWorkspace/);
assert.match(dashboard, /activePanel === "materials" && selectedInventoryItem[\s\S]*AtlasSourcingInspector/);
assert.match(dashboard, /procurementRequest[\s\S]*AtlasProcurementWorkspace/);
assert.match(dashboard, /sourceMap=\{sourceMapContext[\s\S]*SupplyOsCommandMap/);
assert.match(workbench, /Show source/);
assert.match(workbench, /Hide map/);
assert.match(workbench, /New sourcing request/);
assert.match(workbench, /Sourcing queue/);
assert.match(workbench, /Start procurement/);
assert.match(workbench, /<th>Action<\/th>/);
assert.match(workbench, /Start research/);
assert.match(workbench, /View results/);
assert.match(workbench, /Retry research/);
assert.match(workbench, /Continue procurement/);
assert.match(workbench, /Open quote inbox/);
assert.match(workbench, /supplier workstream/);
assert.match(workbench, /Review order draft/);
assert.match(workbench, /Review purchase action/);
assert.match(workbench, /Review supplier acknowledgment/);
assert.match(workbench, /Review quote cycle/);
assert.match(workbench, /Awaiting supplier quote/);
assert.match(workbench, /Supplier acknowledged/);
assert.match(workbench, /Retry saved work/);
assert.doesNotMatch(workbench, /<th>Next step<\/th>/);
assert.doesNotMatch(workbench, /<th>On hand<\/th>|<th>Allocated<\/th>|<th>Inbound<\/th>|<th>Projected<\/th>/);
assert.doesNotMatch(workbench, /inventoryRailList/);
assert.match(procurement, /Approved source library/);
assert.match(procurement, /Manufacturer catalogs/);
assert.match(procurement, /Open web discovery/);
assert.match(procurement, /Price<\/th><th>Delivery<\/th><th>Quality/);
assert.match(procurement, /Create .*workstream/);
assert.match(procurement, /Competitive quote inbox/);
assert.match(procurement, /Only one can enter award approval/);
assert.match(procurement, /Request award approval/);
assert.match(procurement, /Price and delivery badges require the same currency, unit, and RFQ scope/);
assert.match(procurement, /Lowest quoted price/);
assert.match(procurement, /Earliest delivery/);
assert.match(procurement, /quoteCycleProjection/);
assert.match(procurement, /selectedResponseHash: quoteCycleProjection\.selectedResponseHash/);
assert.match(procurement, /Procurement brief/);
assert.match(procurement, /Supplier evidence/);
assert.match(procurement, /Commercial terms/);
assert.match(procurement, /Quality plan/);
assert.match(procurement, /Purchase approval/);
assert.match(procurement, /Confirm supplier evidence/);
assert.match(procurement, /Run the supplier quote cycle/);
assert.match(procurement, /responses\.at\(-1\)\?\.responseHash/);
assert.doesNotMatch(procurement, /quoteCycle\?\.resultHash/);
assert.match(procurement, /Save quote request/);
assert.match(procurement, /Record another channel/);
assert.match(procurement, /Send through connected Gmail/);
assert.match(procurement, /Request send approval/);
assert.match(procurement, /Check Gmail delivery/);
assert.match(procurement, /supplierEmailAction !== undefined/, "a server-cleared email action must not be restored from stale client state");
assert.match(procurement, /Record quote response/);
assert.match(procurement, /Use quote/);
assert.match(procurement, /Open release evidence/);
assert.match(procurement, /Open captured evidence/);
assert.match(procurement, /Open acknowledgment/);
assert.match(procurement, /\/api\/supply-os\/evidence\//);
assert.doesNotMatch(procurement, /price: String\(initialCase\?\.result\?\.selectedOption\.price/, "modeled research prices must not prefill an externally evidenced quote response");
assert.doesNotMatch(procurement, /evidenceUrl: initialCase\?\.result\?\.selectedOption\.sourceUrl/, "supplier homepages must not prefill quote-response evidence");
assert.match(procurement, /It does not contact the supplier/);
assert.match(procurement, /Use this only when the request was sent through a supplier portal/);
assert.match(procurement, /Save quality plan/);
assert.match(procurement, /Request award approval/);
assert.match(procurement, /Approve scope/);
assert.match(procurement, /Save order draft/);
assert.match(procurement, /Update order draft/);
assert.match(procurement, /Request final admin approval/);
assert.match(procurement, /Authorize exact order/);
assert.match(procurement, /Approved to issue/);
assert.match(procurement, /No supplier connector has executed it/);
assert.match(procurement, /Partial supplier acceptance/);
assert.match(procurement, /Record supplier acknowledgment/);
assert.match(procurement, /Ready for Logistics handoff/);
assert.match(procurement, /Derya did not send the release/);
assert.match(procurement, /remain internal/i);
assert.match(procurement, /\/api\/supply-os\/procurement-cases/);
assert.match(procurement, /\/api\/supply-os\/supplier-research/);
assert.match(procurement, /Live public web research is running/);
assert.match(procurement, /View source/);
assert.match(procurement, /Modeled[\s\S]*Sourced[\s\S]*Unknown/);
assert.match(procurement, /No purchase order, supplier contact, booking, or spend was created/);
assert.match(researchRoute, /getSession/);
assert.match(researchRoute, /export async function GET/);
assert.match(researchRoute, /ResearchRateLimiter/);
assert.match(researchRoute, /searchComponentSuppliers/);
assert.match(researchRoute, /startSourcingResearchRun/);
assert.match(researchRoute, /completeSourcingResearchRun/);
assert.match(researchRoute, /listProcurementCases/);
assert.match(researchRoute, /cache-control/);
assert.doesNotMatch(researchRoute, /body\?\.officeId|body\["officeId"\]/);
assert.match(researchPersistence, /SupplyCapabilityRun|supplyCapabilityRun/);
assert.match(researchPersistence, /officeId: context\.officeId/);
assert.match(researchPersistence, /capabilityKey: CAPABILITY_KEY/);
assert.match(researchPersistence, /orderBy: \{ createdAt: "desc" \}/);
assert.match(procurementCasesRoute, /getSession/);
assert.match(procurementCasesRoute, /saveProcurementShortlist/);
assert.match(procurementCasesRoute, /procurementCases/);
assert.doesNotMatch(procurementCasesRoute, /saveProcurementSelection/);
assert.match(procurementReviewRoute, /getSession/);
assert.match(procurementReviewRoute, /reviewProcurementGate/);
assert.match(procurementApprovalRoute, /requestProcurementApproval/);
assert.match(quoteCycleRoute, /getSession/);
assert.match(quoteCycleRoute, /saveSupplierQuoteRequest/);
assert.match(quoteReleaseRoute, /recordSupplierQuoteRelease/);
assert.match(quoteResponseRoute, /recordSupplierQuoteResponse/);
assert.match(evidenceRoute, /getSession/);
assert.match(evidenceRoute, /procurementEvidenceSource/);
assert.match(evidenceRoute, /NextResponse\.redirect/);
assert.match(purchaseDraftRoute, /getSession/);
assert.match(purchaseDraftRoute, /savePurchaseOrderDraft/);
assert.match(purchaseActionRoute, /getSession/);
assert.match(purchaseActionRoute, /requestPurchaseActionApproval/);
assert.match(purchaseActionDecisionRoute, /getSession/);
assert.match(purchaseActionDecisionRoute, /decidePurchaseActionApproval/);
assert.match(purchaseAcknowledgmentRoute, /getSession/);
assert.match(purchaseAcknowledgmentRoute, /recordPurchaseOrderAcknowledgment/);
assert.match(procurementDecisionRoute, /decideProcurementApproval/);
assert.match(supplierEmailDraftRoute, /getSession[\s\S]*saveSupplierEmailDraft/);
assert.match(supplierEmailApprovalRoute, /getSession[\s\S]*requestSupplierEmailApproval/);
assert.match(supplierEmailDecisionRoute, /getSession[\s\S]*decideSupplierEmailApproval/);
assert.match(supplierEmailDeliveryRoute, /SEND[\s\S]*RECONCILE[\s\S]*RESET/);
assert.match(connectedRepliesRoute, /getSession[\s\S]*captureConnectedSupplierReplies/);
assert.match(supplierCommunicationPersistence, /draftMessageHash[\s\S]*scopeHash/);
assert.match(supplierCommunicationPersistence, /CONNECTED_PROVIDER/);
assert.match(supplierCommunicationPersistence, /DELIVERY_UNKNOWN/);
assert.match(supplierCommunicationPersistence, /NOT_FOUND_REVIEW_REQUIRED/);
assert.match(supplierCommunicationPersistence, /confirmedNotSent/);
assert.match(supplierEmailProvider, /Message-ID/);
assert.match(supplierEmailProvider, /rfc822msgid/);
assert.match(supplierReplyPersistence, /SUPPLIER_QUOTE_REPLY_EMAIL/);
assert.match(supplierReplyPersistence, /CONNECTED_PROVIDER/);
assert.match(supplierReplyPersistence, /fromEmail\.trim\(\)\.toLowerCase\(\) === supplierEmail/);
assert.match(procurement, /Check connected inbox/);
assert.match(procurement, /Use as quote evidence/);
assert.match(procurementPersistence, /SupplyExecutionTask|supplyExecutionTask/);
assert.match(procurementPersistence, /SupplyExecutionEvent|supplyExecutionEvent/);
assert.match(procurementPersistence, /officeId: args\.context\.officeId/);
assert.match(procurementPersistence, /purchaseApproval = "BLOCKED"/);
assert.match(procurementPersistence, /canonicalSelection/);
assert.match(procurementPersistence, /selectionHash/);
assert.match(procurementPersistence, /requiresApproval: false/);
assert.match(procurementPersistence, /taskType: APPROVAL_TASK_TYPE/);
assert.match(procurementPersistence, /PURCHASE_ORDER_DRAFT/);
assert.match(procurementPersistence, /SUPPLIER_QUOTE_CYCLE/);
assert.match(procurementPersistence, /SUPPLIER_QUOTE_REQUEST_DRAFTED/);
assert.match(procurementPersistence, /SUPPLIER_QUOTE_REQUEST_RELEASE_RECORDED/);
assert.match(procurementPersistence, /SUPPLIER_QUOTE_RESPONSE_RECORDED/);
assert.match(procurementPersistence, /SUPPLIER_QUOTE_RESPONSE_SELECTED/);
assert.match(procurementPersistence, /PURCHASE_DRAFT_CREATED/);
assert.match(procurementPersistence, /PURCHASE_ORDER_ACTION/);
assert.match(procurementPersistence, /PURCHASE_ACTION_APPROVAL_REQUESTED/);
assert.match(procurementPersistence, /PURCHASE_ACTION_AUTHORIZED/);
assert.match(procurementPersistence, /SUPPLIER_ORDER_PARTIALLY_ACKNOWLEDGED/);
assert.match(procurementPersistence, /SUPPLIER_ORDER_ACKNOWLEDGED/);
assert.match(procurementPersistence, /SUPPLIER_SOURCE_REVIEW/);
assert.match(procurementPersistence, /SUPPLIER_QUOTE_RELEASE/);
assert.match(procurementPersistence, /SUPPLIER_QUOTE_RESPONSE/);
assert.match(procurementPersistence, /SUPPLIER_ORDER_ACKNOWLEDGMENT/);
assert.match(procurementPersistence, /RECORDED_ONLY/);
assert.match(procurementPersistence, /scopeHash/);
assert.match(procurementPersistence, /PrismaClientKnownRequestError/);
assert.match(dashboard, /researchRuns/);
assert.match(dashboard, /sourcingDataState/);
assert.match(dashboard, /initialRun=\{procurementRequest\.savedRun\}/);
assert.doesNotMatch(workbench, /approved supplier|live quote|supplier contacted/i);

console.log("Supply OS Atlas inventory and sourcing workflow contract passed.");
