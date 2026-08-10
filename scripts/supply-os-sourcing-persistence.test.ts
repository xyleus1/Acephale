import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createSupplyWorkspace, listSupplyWorkspaces, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import {
  decidePurchaseActionApproval,
  decideProcurementApproval,
  listProcurementCases,
  procurementEvidenceSource,
  recordSupplierQuoteRelease,
  recordSupplierQuoteResponse,
  recordPurchaseOrderAcknowledgment,
  requestPurchaseActionApproval,
  requestProcurementApproval,
  reviewProcurementGate,
  savePurchaseOrderDraft,
  saveProcurementSelection,
  saveSupplierQuoteRequest,
} from "../src/lib/supply-os/procurement-case-persistence";
import {
  completeSourcingResearchRun,
  listSourcingResearchRuns,
  startSourcingResearchRun,
} from "../src/lib/supply-os/sourcing-research-persistence";
import {
  decideSupplierEmailApproval,
  reconcileSupplierEmailAction,
  requestSupplierEmailApproval,
  resetSupplierEmailForRetry,
  saveSupplierEmailDraft,
  sendSupplierEmailAction,
} from "../src/lib/supply-os/supplier-communication-persistence";
import { gmailSupplierEmailProvider, type SupplierEmailProvider } from "../src/lib/supply-os/supplier-email-provider";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

async function cleanup() {
  const ids = [officeId, foreignOfficeId].filter(Boolean);
  if (ids.length) await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
    await tx.office.deleteMany({ where: { id: { in: ids } } });
  }).catch(() => undefined);
}

async function makeContext(label: string) {
  const office = await prisma.office.create({ data: { name: `Sourcing ${label} ${suffix}` } });
  const user = await prisma.user.create({
    data: {
      officeId: office.id,
      email: `sourcing-${label}-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: `${label} operator`,
      role: "ADMIN",
      canViewWholeOffice: true,
    },
  });
  return {
    officeId: office.id,
    userId: user.id,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice,
  } satisfies SupplyAccessContext;
}

async function main() {
  try {
    const context = await makeContext("owner");
    officeId = context.officeId;
    const visibleWorkspace = await createSupplyWorkspace(context, { name: "Visible robotics workspace" });
    const input = {
      componentItemKey: "VIS-DPT-410",
      componentName: "Stereo depth camera",
      manufacturer: null,
      mpn: null,
      specification: "Industrial stereo depth camera",
      targetCountry: "United States",
      requestText: "Find four stereo depth cameras",
    };
    const started = await startSourcingResearchRun(context, input);
    const observedAt = new Date().toISOString();
    const futureDate = (days: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const quoteDeliveryDate = futureDate(20);
    const quoteValidUntil = futureDate(15);
    const qualityTargetDate = futureDate(10);
    const source = { url: "https://example.com/product", sourceType: "OFFICIAL" };
    const supported = <T>(value: T) => ({
      value,
      state: "SUPPORTED",
      confidence: 0.9,
      sources: [source],
      observedAt,
      freshness: "FRESH",
    });
    await completeSourcingResearchRun({
      context,
      runId: started.id,
      workspaceId: started.workspaceId,
      output: {
        candidates: [{
          id: "candidate-1",
          companyName: "Example supplier",
          website: "https://example.com/",
          sourceUrls: ["https://example.com/product"],
          price: supported(125),
          currency: supported("USD"),
          minimumOrderQuantity: supported(4),
          leadTimeDays: supported(14),
          status: "REVIEW_REQUIRED",
        }, {
          id: "candidate-2",
          companyName: "Weak evidence supplier",
          website: null,
          sourceUrls: ["https://example.com/weak"],
          price: { ...supported(99), state: "PARTIAL" },
          currency: supported("USD"),
          minimumOrderQuantity: supported(2),
          leadTimeDays: { ...supported(7), freshness: "STALE" },
          status: "UNSUPPORTED",
        }],
        degraded: false,
        warnings: [],
      },
    });

    const stale = await startSourcingResearchRun(context, { ...input, componentItemKey: "STALE-1" });
    await prisma.supplyCapabilityRun.update({
      where: { id: stale.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1_000) },
    });
    const runs = await listSourcingResearchRuns(context);
    assert.equal(runs.length, 2);
    const completed = runs.find((run) => run.id === started.id);
    assert.equal((completed?.input as typeof input).componentItemKey, "VIS-DPT-410");
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(((completed?.output as { candidates?: unknown[] })?.candidates ?? []).length, 2);
    assert.equal(runs.find((run) => run.id === stale.id)?.status, "FAILED", "stale research must become retryable");
    const stored = await prisma.supplyCapabilityRun.findUniqueOrThrow({ where: { id: started.id } });
    assert.ok(stored.inputHash);
    assert.ok(stored.outputHash);

    const procurementCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:candidate-1",
        name: "Client-authored name",
        sourceClass: "New",
        sourceUrl: "https://untrusted.example/",
        price: 999,
        currency: "EUR",
        minimumOrderQuantity: 999,
        priceType: "Sourced",
        deliveryDate: "Aug 23",
        deliveryType: "Sourced",
        quality: "Strong",
      },
    });
    const procurementResult = procurementCase.result as {
      stage: string;
      selectedOption: { name: string; sourceClass: string; sourceUrl: string; price: number; currency: string; minimumOrderQuantity: number; deliveryDate: string; quality: string };
      gates: { commercialTerms: string; purchaseApproval: string };
    };
    assert.equal(procurementResult.selectedOption.name, "Example supplier", "persisted evidence must override client-authored supplier identity");
    assert.equal(procurementResult.selectedOption.sourceClass, "Official");
    assert.equal(procurementResult.selectedOption.sourceUrl, "https://example.com/");
    assert.equal(procurementResult.selectedOption.price, 125);
    assert.equal(procurementResult.selectedOption.currency, "USD");
    assert.equal(procurementResult.selectedOption.minimumOrderQuantity, 4);
    assert.notEqual(procurementResult.selectedOption.deliveryDate, "Aug 23", "sourced delivery must not trust a browser-authored date");
    assert.match(procurementResult.selectedOption.deliveryDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(procurementResult.selectedOption.quality, "Conditional");
    assert.equal(procurementResult.gates.commercialTerms, "REVIEW_REQUIRED", "web evidence is not a confirmed quote");
    assert.equal(procurementResult.gates.purchaseApproval, "BLOCKED");

    const sourceReviewed = await reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "SOURCE_EVIDENCE",
        expectedSelectionHash: (procurementCase.result as { selectionHash: string }).selectionHash,
        note: "Verified the official supplier domain and matching product page.",
      },
    });
    assert.equal((sourceReviewed.result as { stage: string }).stage, "COMMERCIAL_CONFIRMATION");
    const sourceReview = (sourceReviewed.result as { reviews: { sourceEvidence: { evidenceId: string } } }).reviews.sourceEvidence;
    assert.ok(sourceReview.evidenceId, "supplier review must create independently addressable evidence");
    const sourceReviewEvidence = await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: sourceReview.evidenceId } });
    assert.equal(sourceReviewEvidence.confidence, null, "captured operator evidence must not claim verification confidence");
    assert.equal(sourceReviewEvidence.kind, "SUPPLIER_SOURCE_REVIEW");
    assert.equal(sourceReviewEvidence.sourceType, "OFFICIAL");
    const selectionHash = (procurementCase.result as { selectionHash: string }).selectionHash;
    const quoteRequestInput = {
      expectedSelectionHash: selectionHash,
      expectedRevision: 0,
      quantity: 8,
      unitOfMeasure: "EA",
      needBy: quoteDeliveryDate,
      shipTo: "Atlas Austin assembly plant",
      responseDue: futureDate(3),
      requirements: "Quote calibrated stereo depth cameras with serial traceability and delivery to Austin.",
      note: "Return calibration and warranty terms with the quote.",
    } as const;
    await assert.rejects(() => saveSupplierQuoteRequest({
      context,
      caseId: procurementCase.id,
      input: { ...quoteRequestInput, expectedSelectionHash: "stale-selection-hash" },
    }), /selection changed/i, "quote requests must fail closed against stale supplier state");
    await assert.rejects(() => saveSupplierQuoteRequest({
      context,
      caseId: procurementCase.id,
      input: { ...quoteRequestInput, responseDue: futureDate(25) },
    }), /cannot be after the need-by date/i, "quote response deadlines must fit the operating requirement");
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "COMMERCIAL_TERMS",
        expectedSelectionHash: selectionHash,
        price: 125,
        currency: "USD",
        evidenceUrl: "https://untrusted.example/browser-terms",
      },
    }), /quote cycle task id is required/i, "browser-authored terms cannot bypass the persistent quote cycle");
    const quoteDraft = await saveSupplierQuoteRequest({ context, caseId: procurementCase.id, input: quoteRequestInput });
    assert.equal(quoteDraft.quoteCycle.status, "PLANNED");
    assert.equal((quoteDraft.quoteCycle.result as { revision: number; state: string; externalSideEffect: boolean }).revision, 1);
    assert.equal((quoteDraft.quoteCycle.result as { state: string }).state, "DRAFT");
    assert.equal((quoteDraft.quoteCycle.result as { externalSideEffect: boolean }).externalSideEffect, false);
    assert.equal((await listProcurementCases(context))[0]?.quoteCycle?.id, quoteDraft.quoteCycle.id, "the sourcing queue must restore the quote-request draft");
    const quoteDraftEvents = await prisma.supplyExecutionEvent.count({ where: { executionTaskId: quoteDraft.quoteCycle.id } });
    const repeatedQuoteDraft = await saveSupplierQuoteRequest({ context, caseId: procurementCase.id, input: quoteRequestInput });
    assert.equal((repeatedQuoteDraft.quoteCycle.result as { revision: number }).revision, 1);
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: quoteDraft.quoteCycle.id } }), quoteDraftEvents, "identical quote-request retries must not append history");
    await assert.rejects(() => saveSupplierQuoteRequest({
      context,
      caseId: procurementCase.id,
      input: { ...quoteRequestInput, expectedRevision: 0, requirements: "Stale overwrite attempt." },
    }), /changed in another session/i, "stale quote-request edits must not overwrite a newer revision");
    const quoteReleaseInput = {
      expectedRequestHash: (quoteDraft.quoteCycle.result as { requestHash: string }).requestHash,
      channel: "EMAIL",
      releasedOn: futureDate(0),
      evidenceUrl: "https://example.com/quote-requests/atlas-410",
      note: "Buyer sent the quote request from the supplier thread.",
    } as const;
    const quoteReleased = await recordSupplierQuoteRelease({ context, quoteCycleId: quoteDraft.quoteCycle.id, input: quoteReleaseInput });
    assert.equal(quoteReleased.quoteCycle.status, "RUNNING");
    assert.equal((quoteReleased.quoteCycle.result as { state: string; externalSideEffect: string }).state, "AWAITING_RESPONSE");
    assert.equal((quoteReleased.quoteCycle.result as { externalSideEffect: string }).externalSideEffect, "RECORDED_ONLY");
    const quoteReleaseEvidenceId = (quoteReleased.release as { evidenceId: string }).evidenceId;
    const quoteReleaseEvidence = await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: quoteReleaseEvidenceId } });
    assert.equal(quoteReleaseEvidence.executionTaskId, quoteDraft.quoteCycle.id);
    assert.equal(quoteReleaseEvidence.kind, "SUPPLIER_QUOTE_RELEASE");
    assert.equal(quoteReleaseEvidence.sourceUri, quoteReleaseInput.evidenceUrl);
    const releaseEvidenceCount = await prisma.supplyEvidence.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, kind: "SUPPLIER_QUOTE_RELEASE" } });
    const releaseEventCount = await prisma.supplyExecutionEvent.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, eventType: "SUPPLIER_QUOTE_REQUEST_RELEASE_RECORDED" } });
    await recordSupplierQuoteRelease({ context, quoteCycleId: quoteDraft.quoteCycle.id, input: quoteReleaseInput });
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, eventType: "SUPPLIER_QUOTE_REQUEST_RELEASE_RECORDED" } }), releaseEventCount, "identical release retries must be idempotent");
    assert.equal(await prisma.supplyEvidence.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, kind: "SUPPLIER_QUOTE_RELEASE" } }), releaseEvidenceCount, "identical release retries must not duplicate evidence");
    await assert.rejects(() => saveSupplierQuoteRequest({
      context,
      caseId: procurementCase.id,
      input: { ...quoteRequestInput, expectedRevision: 1, requirements: "Released request mutation." },
    }), /already released/i, "released quote requests must be immutable");
    const quoteResponseInput = {
      expectedRequestHash: quoteReleaseInput.expectedRequestHash,
      receivedOn: futureDate(0),
      price: 125,
      currency: "USD",
      minimumOrderQuantity: 4,
      unitOfMeasure: "EA",
      deliveryDate: quoteDeliveryDate,
      quoteReference: "Q-ATLAS-410",
      validUntil: quoteValidUntil,
      evidenceUrl: "https://example.com/quote/atlas-410",
      note: "Supplier quote includes calibration records.",
    } as const;
    await assert.rejects(() => recordSupplierQuoteResponse({
      context,
      quoteCycleId: quoteDraft.quoteCycle.id,
      input: { ...quoteResponseInput, validUntil: futureDate(-1) },
    }), /cannot be in the past/i, "expired quotes must never enter the response ledger");
    await assert.rejects(() => recordSupplierQuoteResponse({
      context,
      quoteCycleId: quoteDraft.quoteCycle.id,
      input: { ...quoteResponseInput, deliveryDate: futureDate(-1) },
    }), /delivery date cannot be in the past/i, "missed delivery dates must never enter the response ledger");
    await assert.rejects(() => recordSupplierQuoteResponse({
      context,
      quoteCycleId: quoteDraft.quoteCycle.id,
      input: { ...quoteResponseInput, receivedOn: futureDate(-1) },
    }), /cannot precede the recorded quote-request release/i, "supplier responses cannot be backdated before the request release");
    await assert.rejects(() => recordSupplierQuoteResponse({
      context,
      quoteCycleId: quoteDraft.quoteCycle.id,
      input: { ...quoteResponseInput, unitOfMeasure: "KG" },
    }), /must match the requested unit EA/i, "supplier quote units cannot silently change the commercial basis");
    const firstQuoteResponse = await recordSupplierQuoteResponse({
      context,
      quoteCycleId: quoteDraft.quoteCycle.id,
      input: {
        ...quoteResponseInput,
        price: 130,
        quoteReference: "Q-ATLAS-410-DRAFT",
        evidenceUrl: "https://example.com/quote/atlas-410-draft",
      },
    });
    assert.equal((firstQuoteResponse.quoteCycle.result as { responses: unknown[] }).responses.length, 1);
    const quoteResponse = await recordSupplierQuoteResponse({ context, quoteCycleId: quoteDraft.quoteCycle.id, input: quoteResponseInput });
    const storedQuoteResponse = quoteResponse.response as { responseHash: string; evidenceId: string };
    assert.ok(storedQuoteResponse.evidenceId, "every supplier quote response must create canonical evidence");
    assert.equal((await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: storedQuoteResponse.evidenceId } })).contentHash, storedQuoteResponse.responseHash);
    assert.equal((quoteResponse.quoteCycle.result as { responses: unknown[] }).responses.length, 2, "quote revisions must remain available for comparison");
    assert.equal(((await listProcurementCases(context))[0]?.result as { quoteCycle: { responseCount: number } }).quoteCycle.responseCount, 2);
    const responseEventCount = await prisma.supplyExecutionEvent.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, eventType: "SUPPLIER_QUOTE_RESPONSE_RECORDED" } });
    const responseEvidenceCount = await prisma.supplyEvidence.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, kind: "SUPPLIER_QUOTE_RESPONSE" } });
    await recordSupplierQuoteResponse({ context, quoteCycleId: quoteDraft.quoteCycle.id, input: quoteResponseInput });
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, eventType: "SUPPLIER_QUOTE_RESPONSE_RECORDED" } }), responseEventCount, "identical supplier responses must be idempotent");
    assert.equal(await prisma.supplyEvidence.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, kind: "SUPPLIER_QUOTE_RESPONSE" } }), responseEvidenceCount, "identical supplier responses must not duplicate evidence");
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: { gate: "COMMERCIAL_TERMS", expectedSelectionHash: selectionHash, quoteCycleTaskId: quoteDraft.quoteCycle.id, responseHash: "missing-response" },
    }), /response was not found/i, "commercial review must select a canonical stored response");
    const termsReviewed = await reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "COMMERCIAL_TERMS",
        expectedSelectionHash: selectionHash,
        quoteCycleTaskId: quoteDraft.quoteCycle.id,
        responseHash: storedQuoteResponse.responseHash,
      },
    });
    assert.equal((termsReviewed.result as { stage: string }).stage, "QUALITY_REVIEW");
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "QUALITY_PLAN",
        expectedSelectionHash: (procurementCase.result as { selectionHash: string }).selectionHash,
        method: "SAMPLE",
        acceptanceCriteria: "This plan is already late.",
        owner: "Atlas vision engineering",
        targetDate: futureDate(-1),
      },
    }), /quality target date cannot be in the past/i, "an expired quality plan must never become approval-ready");
    const qualityReviewed = await reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "QUALITY_PLAN",
        expectedSelectionHash: (procurementCase.result as { selectionHash: string }).selectionHash,
        method: "SAMPLE",
        acceptanceCriteria: "Verify calibration, connector fit, image depth accuracy, and serial traceability.",
        owner: "Atlas vision engineering",
        targetDate: qualityTargetDate,
      },
    });
    assert.equal((qualityReviewed.result as { stage: string }).stage, "APPROVAL");

    const manager = await prisma.user.create({
      data: {
        officeId: context.officeId,
        email: `sourcing-manager-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Procurement manager",
        role: "MANAGER",
        canViewWholeOffice: true,
      },
    });
    const managerContext = { ...context, userId: manager.id, role: manager.role };
    const requested = await requestProcurementApproval({
      context,
      caseId: procurementCase.id,
      input: {
        expectedSelectionHash: (procurementCase.result as { selectionHash: string }).selectionHash,
        reason: "Best supported option for the September production requirement.",
      },
    });
    assert.equal((requested.procurementCase.result as { stage: string }).stage, "APPROVAL_PENDING");
    const approvalTask = await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: requested.approval.executionTaskId! },
    });
    const approvalInput = approvalTask.input as {
      selectedOption: { name: string };
      confirmedTerms: { price: number; currency: string; minimumOrderQuantity: number; unitOfMeasure: string };
      qualityPlan: { method: string };
    };
    assert.equal(approvalTask.taskType, "PROCUREMENT_APPROVAL");
    assert.equal(approvalTask.inputHash, requested.approval.scopeHash, "approval must bind the exact immutable task input");
    assert.equal(approvalInput.selectedOption.name, "Example supplier");
    assert.deepEqual(approvalInput.confirmedTerms, {
      price: 125,
      currency: "USD",
      minimumOrderQuantity: 4,
      unitOfMeasure: "EA",
      deliveryDate: quoteDeliveryDate,
      evidenceUrl: "https://example.com/quote/atlas-410",
      evidenceId: storedQuoteResponse.evidenceId,
      quoteReference: "Q-ATLAS-410",
      validUntil: quoteValidUntil,
      quoteCycleTaskId: quoteDraft.quoteCycle.id,
      responseHash: storedQuoteResponse.responseHash,
      evidenceClass: "OPERATOR_RECORDED_EXTERNAL",
    });
    assert.equal(approvalInput.qualityPlan.method, "SAMPLE");
    await assert.rejects(() => decideProcurementApproval({
      context,
      approvalId: requested.approval.id,
      input: { decision: "APPROVE", note: "Self approval attempt" },
    }), /different eligible approver/i, "requesters cannot approve their own request when another approver exists");
    const approved = await decideProcurementApproval({
      context: managerContext,
      approvalId: requested.approval.id,
      input: { decision: "APPROVE", note: "Scope and quality plan approved." },
    });
    const approvedResult = approved.procurementCase.result as { stage: string; gates: { purchaseApproval: string } };
    assert.equal(approvedResult.stage, "PURCHASE_READY");
    assert.equal(approvedResult.gates.purchaseApproval, "APPROVED");
    assert.equal((await prisma.supplyApproval.findUniqueOrThrow({ where: { id: requested.approval.id } })).status, "APPROVED");
    assert.equal(approvalTask.externalRef, null, "approval must not create a PO, booking, or external action");
    const approvalEventCount = await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: procurementCase.id, eventType: "PROCUREMENT_APPROVED" },
    });
    const approvedRetry = await decideProcurementApproval({
      context: managerContext,
      approvalId: requested.approval.id,
      input: { decision: "APPROVE", note: "Scope and quality plan approved." },
    });
    assert.equal(approvedRetry.approval.status, "APPROVED", "an identical decision retry must return the committed result");
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: procurementCase.id, eventType: "PROCUREMENT_APPROVED" },
    }), approvalEventCount, "an identical decision retry must not append duplicate history");

    const purchaseDraftInput = {
      expectedApprovalId: requested.approval.id,
      expectedApprovalScopeHash: requested.approval.scopeHash,
      expectedRevision: 0,
      quantity: 8,
      needBy: quoteDeliveryDate,
      shipTo: "Atlas Austin assembly plant, receiving dock 2",
      incoterm: "DAP",
      paymentTerms: "Net 30 after receipt",
      buyerReference: "ATLAS-VIS-410",
      notes: "Keep calibration records with the shipment.",
    } as const;
    await assert.rejects(() => savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: { ...purchaseDraftInput, quantity: 1 },
    }), /approved MOQ of 4/i, "order preparation must enforce the approved supplier MOQ");
    const purchasePrepared = await savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: purchaseDraftInput,
    });
    assert.ok(purchasePrepared.purchaseDraft);
    const preparedResult = purchasePrepared.purchaseDraft!.result as {
      revision: number;
      supplier: { name: string; sourceUrl: string };
      commercial: { unitPrice: string; currency: string; quoteReference: string; quoteCycleTaskId: string; quoteResponseHash: string; evidenceClass: string };
      totals: { materialSubtotal: string; currency: string };
    };
    assert.equal(purchasePrepared.purchaseDraft!.status, "PLANNED");
    assert.equal(preparedResult.revision, 1);
    assert.deepEqual((purchasePrepared.procurementCase.result as { purchasePreparation: unknown }).purchasePreparation, {
      draftTaskId: purchasePrepared.purchaseDraft!.id,
      state: "DRAFT",
      revision: 1,
      orderHash: (purchasePrepared.purchaseDraft!.result as { orderHash: string }).orderHash,
    }, "the parent case must project the active draft for queue ordering and resume state");
    assert.equal(preparedResult.supplier.name, "Example supplier", "draft supplier identity must come from the approved immutable scope");
    assert.equal(preparedResult.supplier.sourceUrl, "https://example.com/");
    assert.equal(preparedResult.commercial.unitPrice, "125");
    assert.equal(preparedResult.commercial.currency, "USD");
    assert.equal(preparedResult.commercial.quoteReference, "Q-ATLAS-410");
    assert.equal(preparedResult.commercial.quoteCycleTaskId, quoteDraft.quoteCycle.id);
    assert.equal(preparedResult.commercial.quoteResponseHash, storedQuoteResponse.responseHash);
    assert.equal((preparedResult.commercial as { quoteEvidenceId?: string }).quoteEvidenceId, storedQuoteResponse.evidenceId);
    assert.equal(preparedResult.commercial.evidenceClass, "OPERATOR_RECORDED_EXTERNAL");
    assert.equal(preparedResult.totals.materialSubtotal, "1000");
    assert.notEqual(purchasePrepared.purchaseDraft!.inputHash, requested.approval.scopeHash, "purchase draft has its own provenance input hash");
    const storedPurchaseDraft = await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: purchasePrepared.purchaseDraft!.id },
    });
    assert.equal(storedPurchaseDraft.taskType, "PURCHASE_ORDER_DRAFT");
    assert.equal(storedPurchaseDraft.capabilityKey, "draft.purchase_order");
    assert.equal(storedPurchaseDraft.requiresApproval, false, "the internal draft itself has no side effect to approve");
    assert.equal(storedPurchaseDraft.externalRef, null, "a purchase draft must not create an external purchase order");
    assert.equal(storedPurchaseDraft.externalSystem, null);
    const purchaseEventCount = await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: purchasePrepared.purchaseDraft!.id },
    });
    const identicalPurchaseDraft = await savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: purchaseDraftInput,
    });
    assert.equal((identicalPurchaseDraft.purchaseDraft!.result as { revision: number }).revision, 1, "identical retries must not create fake draft revisions");
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: purchasePrepared.purchaseDraft!.id },
    }), purchaseEventCount, "identical draft retries must not append fake history");
    const updatedPurchaseDraft = await savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: { ...purchaseDraftInput, expectedRevision: 1, quantity: 10 },
    });
    assert.equal((updatedPurchaseDraft.purchaseDraft!.result as { revision: number }).revision, 2);
    assert.equal((updatedPurchaseDraft.purchaseDraft!.result as { totals: { materialSubtotal: string } }).totals.materialSubtotal, "1250");
    assert.equal((await listProcurementCases(context))[0]?.purchaseDraft?.id, updatedPurchaseDraft.purchaseDraft!.id, "queue reads must restore the active order draft");
    await assert.rejects(() => savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: { ...purchaseDraftInput, expectedRevision: 1, quantity: 12 },
    }), /changed in another session/i, "stale draft edits must not overwrite a newer revision");

    await assert.rejects(() => requestPurchaseActionApproval({
      context,
      caseId: procurementCase.id,
      input: {
        expectedDraftTaskId: updatedPurchaseDraft.purchaseDraft!.id,
        expectedDraftResultHash: updatedPurchaseDraft.purchaseDraft!.resultHash,
        expectedDraftRevision: 1,
        reason: "Stale final approval request.",
      },
    }), /purchase draft changed/i, "final approval must reject a stale draft revision");
    const firstPurchaseAction = await requestPurchaseActionApproval({
      context,
      caseId: procurementCase.id,
      input: {
        expectedDraftTaskId: updatedPurchaseDraft.purchaseDraft!.id,
        expectedDraftResultHash: updatedPurchaseDraft.purchaseDraft!.resultHash,
        expectedDraftRevision: 2,
        reason: "Authorize the exact supported order scope.",
      },
    });
    assert.equal(firstPurchaseAction.purchaseAction.status, "PLANNED");
    assert.equal(firstPurchaseAction.purchaseAction.taskType, "PURCHASE_ORDER_ACTION");
    assert.equal(firstPurchaseAction.purchaseAction.capabilityKey, "authorize.purchase_order");
    assert.equal(firstPurchaseAction.approval.status, "PENDING");
    assert.equal(firstPurchaseAction.approval.requiredRole, "ADMIN");
    assert.equal(firstPurchaseAction.approval.scopeHash, firstPurchaseAction.purchaseAction.inputHash);
    const immutablePurchaseInput = firstPurchaseAction.purchaseAction.input as {
      action: string;
      purchaseDraftRevision: number;
      order: { quantity: string; shipTo: string };
      supplier: { name: string };
      commercial: { unitPrice: string; quoteReference: string; quoteCycleTaskId: string; quoteResponseHash: string };
      totals: { materialSubtotal: string };
      qualityPlan: { method: string };
    };
    assert.equal(immutablePurchaseInput.action, "PLACE_ORDER");
    assert.equal(immutablePurchaseInput.purchaseDraftRevision, 2);
    assert.equal(immutablePurchaseInput.order.quantity, "10");
    assert.equal(immutablePurchaseInput.order.shipTo, purchaseDraftInput.shipTo);
    assert.equal(immutablePurchaseInput.supplier.name, "Example supplier");
    assert.equal(immutablePurchaseInput.commercial.unitPrice, "125");
    assert.equal(immutablePurchaseInput.commercial.quoteReference, "Q-ATLAS-410");
    assert.equal(immutablePurchaseInput.commercial.quoteCycleTaskId, quoteDraft.quoteCycle.id);
    assert.equal(immutablePurchaseInput.commercial.quoteResponseHash, storedQuoteResponse.responseHash);
    assert.equal(immutablePurchaseInput.totals.materialSubtotal, "1250");
    assert.equal(immutablePurchaseInput.qualityPlan.method, "SAMPLE");
    assert.equal(firstPurchaseAction.purchaseAction.externalSystem, null);
    assert.equal(firstPurchaseAction.purchaseAction.externalRef, null, "requesting approval must not issue a PO");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: firstPurchaseAction.purchaseAction.id } })).requiresApproval, true);
    const repeatedPurchaseAction = await requestPurchaseActionApproval({
      context,
      caseId: procurementCase.id,
      input: {
        expectedDraftTaskId: updatedPurchaseDraft.purchaseDraft!.id,
        expectedDraftResultHash: updatedPurchaseDraft.purchaseDraft!.resultHash,
        expectedDraftRevision: 2,
        reason: "Retry should return the same pending action.",
      },
    });
    assert.equal(repeatedPurchaseAction.purchaseAction.id, firstPurchaseAction.purchaseAction.id, "identical approval retries must be idempotent");
    assert.equal(repeatedPurchaseAction.approval.id, firstPurchaseAction.approval.id);

    const revisedPurchaseDraft = await savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: { ...purchaseDraftInput, expectedRevision: 2, quantity: 12 },
    });
    assert.equal((revisedPurchaseDraft.purchaseDraft!.result as { revision: number }).revision, 3);
    assert.equal((await prisma.supplyApproval.findUniqueOrThrow({ where: { id: firstPurchaseAction.approval.id } })).status, "CANCELLED", "editing a draft must cancel its pending final approval");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: firstPurchaseAction.purchaseAction.id } })).status, "CANCELLED");
    assert.equal(revisedPurchaseDraft.procurementCase.purchaseAction, null);
    await assert.rejects(() => decidePurchaseActionApproval({
      context,
      approvalId: firstPurchaseAction.approval.id,
      input: { decision: "APPROVE", note: "Stale action must not authorize." },
    }), /already been decided/i, "a cancelled final approval cannot authorize an edited draft");

    const finalPurchaseAction = await requestPurchaseActionApproval({
      context,
      caseId: procurementCase.id,
      input: {
        expectedDraftTaskId: revisedPurchaseDraft.purchaseDraft!.id,
        expectedDraftResultHash: revisedPurchaseDraft.purchaseDraft!.resultHash,
        expectedDraftRevision: 3,
        reason: "Authorize revised quantity and exact commercial scope.",
      },
    });
    await assert.rejects(() => decidePurchaseActionApproval({
      context: managerContext,
      approvalId: finalPurchaseAction.approval.id,
      input: { decision: "APPROVE", note: "Manager cannot authorize spend." },
    }), /only an admin/i, "a manager approval cannot substitute for final admin authorization");
    const secondAdmin = await prisma.user.create({
      data: {
        officeId: context.officeId,
        email: `sourcing-admin-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Purchase administrator",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const secondAdminContext = { ...context, userId: secondAdmin.id, role: secondAdmin.role };
    await assert.rejects(() => decidePurchaseActionApproval({
      context,
      approvalId: finalPurchaseAction.approval.id,
      input: { decision: "APPROVE", note: "Self authorization attempt." },
    }), /different admin/i, "the requester cannot self-authorize when another admin is available");
    const rejectedPurchase = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: finalPurchaseAction.approval.id,
      input: { decision: "REJECT", note: "Increase the quantity to cover the production buffer." },
    });
    assert.equal(rejectedPurchase.purchaseAction.status, "BLOCKED");
    assert.equal(rejectedPurchase.purchaseDraft.status, "PLANNED", "a rejected action must leave the draft editable");
    assert.equal((rejectedPurchase.procurementCase.result as { purchaseAuthorization: { status: string } }).purchaseAuthorization.status, "REJECTED");
    await assert.rejects(() => requestPurchaseActionApproval({
      context,
      caseId: procurementCase.id,
      input: {
        expectedDraftTaskId: rejectedPurchase.purchaseDraft.id,
        expectedDraftResultHash: rejectedPurchase.purchaseDraft.resultHash,
        expectedDraftRevision: 3,
        reason: "Retry rejected scope without revision.",
      },
    }), /exact order scope was rejected/i, "a rejected immutable scope cannot be resubmitted unchanged");
    const draftAfterRejection = await savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: { ...purchaseDraftInput, expectedRevision: 3, quantity: 14 },
    });
    assert.equal((draftAfterRejection.purchaseDraft!.result as { revision: number }).revision, 4);
    const authorizedAction = await requestPurchaseActionApproval({
      context,
      caseId: procurementCase.id,
      input: {
        expectedDraftTaskId: draftAfterRejection.purchaseDraft!.id,
        expectedDraftResultHash: draftAfterRejection.purchaseDraft!.resultHash,
        expectedDraftRevision: 4,
        reason: "Authorize revised buffered quantity and exact commercial scope.",
      },
    });
    await assert.rejects(() => decidePurchaseActionApproval({
      context,
      approvalId: authorizedAction.approval.id,
      input: { decision: "APPROVE", note: "Self authorization attempt." },
    }), /different admin/i, "the requester cannot self-authorize a revised scope when another admin is available");
    const authorizedPurchase = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: authorizedAction.approval.id,
      input: { decision: "APPROVE", note: "Exact quantity, supplier, quote, and destination authorized." },
    });
    assert.equal(authorizedPurchase.purchaseAction.status, "READY");
    assert.equal(authorizedPurchase.purchaseDraft.status, "READY", "authorization freezes the approved draft");
    assert.equal((authorizedPurchase.purchaseAction.result as { state: string; externalSideEffect: boolean }).state, "AUTHORIZED");
    assert.equal((authorizedPurchase.purchaseAction.result as { externalSideEffect: boolean }).externalSideEffect, false);
    assert.equal(authorizedPurchase.purchaseAction.externalRef, null, "authorization must not claim that a PO was issued");
    assert.equal((authorizedPurchase.procurementCase.result as { purchaseAuthorization: { status: string } }).purchaseAuthorization.status, "APPROVED");
    const authorizedEventCount = await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: authorizedAction.purchaseAction.id, eventType: "PURCHASE_ACTION_AUTHORIZED" },
    });
    const authorizedRetry = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: authorizedAction.approval.id,
      input: { decision: "APPROVE", note: "Exact quantity, supplier, quote, and destination authorized." },
    });
    assert.equal(authorizedRetry.purchaseAction.status, "READY");
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: authorizedAction.purchaseAction.id, eventType: "PURCHASE_ACTION_AUTHORIZED" },
    }), authorizedEventCount, "an identical authorization retry must not append fake history");
    const restoredAuthorizedCase = (await listProcurementCases(context))[0];
    assert.equal(restoredAuthorizedCase?.purchaseAction?.id, authorizedAction.purchaseAction.id, "the sourcing queue must restore the approved purchase action");
    assert.equal(restoredAuthorizedCase?.purchaseAction?.approval?.status, "APPROVED");
    await assert.rejects(() => savePurchaseOrderDraft({
      context,
      caseId: procurementCase.id,
      input: { ...purchaseDraftInput, expectedRevision: 4, quantity: 16 },
    }), /only an active purchase draft/i, "an authorized order scope must be frozen against later draft edits");

    const weakEvidenceCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:candidate-2",
        name: "Client tries to promote weak evidence",
        sourceClass: "Official",
        sourceUrl: "https://example.com/weak",
        price: 99,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Sourced",
        deliveryDate: "Aug 16",
        deliveryType: "Sourced",
        quality: "Strong",
      },
    });
    const weakEvidenceResult = weakEvidenceCase.result as {
      selectedOption: { price: number | null; deliveryDate: string | null; priceType: string; deliveryType: string };
      gates: { commercialTerms: string; purchaseApproval: string };
    };
    assert.equal(weakEvidenceResult.selectedOption.price, null, "partial price evidence must remain unknown");
    assert.equal(weakEvidenceResult.selectedOption.deliveryDate, null, "stale lead-time evidence must remain unknown");
    assert.equal(weakEvidenceResult.selectedOption.priceType, "Unknown");
    assert.equal(weakEvidenceResult.selectedOption.deliveryType, "Unknown");
    assert.equal(weakEvidenceResult.gates.commercialTerms, "REVIEW_REQUIRED");
    assert.equal(weakEvidenceResult.gates.purchaseApproval, "BLOCKED");
    assert.equal((weakEvidenceCase.result as { quoteCycle?: unknown }).quoteCycle, undefined, "supplier changes must remove the stale quote-cycle projection");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: quoteDraft.quoteCycle.id } })).status, "CANCELLED", "supplier changes must cancel the active quote cycle");
    assert.equal((await prisma.supplyApproval.findUniqueOrThrow({ where: { id: requested.approval.id } })).status, "APPROVED", "historical approval remains immutable after the case changes");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: updatedPurchaseDraft.purchaseDraft!.id },
    })).status, "CANCELLED", "changing supplier scope must cancel the active order draft");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: authorizedAction.purchaseAction.id },
    })).status, "CANCELLED", "changing supplier scope must invalidate an approved but unexecuted purchase action");
    assert.equal((await listProcurementCases(context))[0]?.purchaseDraft, null, "cancelled order drafts must leave the active sourcing queue");
    await assert.rejects(() => saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:not-in-research",
        name: "Invented supplier",
        sourceClass: "New",
        sourceUrl: null,
        price: 100,
        currency: "USD",
        minimumOrderQuantity: 1,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Unverified",
      },
    }), /not present in the research run/);

    const updatedCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "modeled-option",
        name: "Modeled alternative",
        sourceClass: "Trusted",
        sourceUrl: null,
        price: 110,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Strong",
      },
    });
    const updatedResult = updatedCase.result as {
      selectedOption: { sourceClass: string; quality: string };
      gates: { sourceEvidence: string; commercialTerms: string; purchaseApproval: string };
    };
    assert.equal(updatedCase.id, procurementCase.id, "one research run must resume one procurement case");
    assert.equal(updatedResult.selectedOption.sourceClass, "New", "client-modeled suppliers cannot become trusted records");
    assert.equal(updatedResult.selectedOption.quality, "Unverified", "client-modeled quality cannot become evidence");
    assert.equal(updatedResult.gates.sourceEvidence, "BLOCKED");
    assert.equal(updatedResult.gates.commercialTerms, "REVIEW_REQUIRED");
    assert.equal(updatedResult.gates.purchaseApproval, "BLOCKED");
    const replayedCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "modeled-option",
        name: "Modeled alternative",
        sourceClass: "Trusted",
        sourceUrl: null,
        price: 110,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Strong",
      },
    });
    assert.equal(replayedCase.id, updatedCase.id);
    const returnedCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:candidate-1",
        name: "Client-authored name again",
        sourceClass: "New",
        sourceUrl: "https://untrusted.example/again",
        price: 888,
        currency: "EUR",
        minimumOrderQuantity: 888,
        priceType: "Sourced",
        deliveryDate: "Sep 30",
        deliveryType: "Sourced",
        quality: "Strong",
      },
    });
    assert.equal((returnedCase.result as { selectedOption: { name: string } }).selectedOption.name, "Example supplier", "operators must be able to return to a prior supplier safely");
    const returnedHash = (returnedCase.result as { selectionHash: string }).selectionHash;
    await reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: { gate: "SOURCE_EVIDENCE", expectedSelectionHash: returnedHash, note: "Verified supplier source for approval retry." },
    });
    const retryQuoteDraft = await saveSupplierQuoteRequest({
      context,
      caseId: returnedCase.id,
      input: {
        expectedSelectionHash: returnedHash,
        expectedRevision: 0,
        quantity: 14,
        unitOfMeasure: "EA",
        needBy: quoteDeliveryDate,
        shipTo: "Atlas Austin assembly plant",
        responseDue: futureDate(3),
        requirements: "Return a revised quote for calibrated cameras with serial traceability.",
        note: "Approval retry quote cycle.",
      },
    });
    const retryRequestHash = (retryQuoteDraft.quoteCycle.result as { requestHash: string }).requestHash;
    const senderAccount = await prisma.emailAccount.create({
      data: {
        officeId: context.officeId,
        email: `buyer-${suffix}@example.test`,
        provider: "GMAIL",
        accessToken: "test-only-token",
      },
    });
    const supplierEmailDraft = await saveSupplierEmailDraft({
      context,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      input: {
        expectedRequestHash: retryRequestHash,
        expectedRevision: 0,
        senderAccountId: senderAccount.id,
        recipient: "quotes@example.com",
        subject: "Quote request: calibrated stereo depth cameras",
        body: "Please quote 14 EA calibrated stereo depth cameras for delivery to Austin.",
      },
    });
    assert.equal((await listProcurementCases(context))[0]?.supplierEmailDraft?.id, supplierEmailDraft.id, "the sourcing queue must restore the connected email draft");
    const emailApprovalRequest = await requestSupplierEmailApproval({
      context,
      draftId: supplierEmailDraft.id,
      input: { expectedResultHash: supplierEmailDraft.resultHash, reason: "Release the exact supplier quote request through the connected buyer inbox." },
    });
    const emailScope = emailApprovalRequest.action.input as { message: { recipient: string; subject: string; body: string }; draftMessageHash: string };
    assert.equal(emailScope.message.recipient, "quotes@example.com");
    assert.equal(emailScope.message.subject, "Quote request: calibrated stereo depth cameras");
    assert.ok(emailScope.draftMessageHash, "approval must bind the exact draft message hash");
    await assert.rejects(() => decideSupplierEmailApproval({
      context,
      approvalId: emailApprovalRequest.approval.id,
      input: { decision: "APPROVE" },
    }), /different eligible approver/i, "supplier email self-approval must be blocked when another approver is available");
    const approvedEmail = await decideSupplierEmailApproval({
      context: managerContext,
      approvalId: emailApprovalRequest.approval.id,
      input: { decision: "APPROVE", note: "Exact recipient and message approved." },
    });
    await prisma.emailAccount.update({ where: { id: senderAccount.id }, data: { email: `changed-${suffix}@example.test` } });
    const changedSenderResult = await gmailSupplierEmailProvider.send({
      officeId: context.officeId,
      accountId: senderAccount.id,
      senderEmail: senderAccount.email,
      recipient: "quotes@example.com",
      subject: "Quote request: calibrated stereo depth cameras",
      body: "Please quote 14 EA calibrated stereo depth cameras for delivery to Austin.",
      rfcMessageId: "<sender-change-test@derya.ai>",
    });
    assert.equal(changedSenderResult.state, "REJECTED", "a sender identity change must invalidate the approved message before Gmail is called");
    await prisma.emailAccount.update({ where: { id: senderAccount.id }, data: { email: senderAccount.email } });
    let uncertainSendCount = 0;
    let releaseProviderSend: (() => void) | null = null;
    let markProviderStarted: (() => void) | null = null;
    const providerStarted = new Promise<void>((resolve) => { markProviderStarted = resolve; });
    const providerRelease = new Promise<void>((resolve) => { releaseProviderSend = resolve; });
    const uncertainProvider: SupplierEmailProvider = {
      async send() {
        uncertainSendCount += 1;
        markProviderStarted?.();
        await providerRelease;
        return { state: "UNKNOWN", error: "Provider timed out after accepting the request." };
      },
      async reconcile() {
        return { state: "NOT_FOUND" };
      },
    };
    const firstSend = sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: uncertainProvider });
    await providerStarted;
    await assert.rejects(
      () => sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: uncertainProvider }),
      /reconcile/i,
      "a concurrent send must observe the durable SENDING claim before Gmail can be called again",
    );
    assert.equal(uncertainSendCount, 1, "concurrent delivery attempts must call the provider exactly once");
    releaseProviderSend?.();
    const uncertainEmail = await firstSend;
    assert.equal((uncertainEmail.result as { state: string }).state, "DELIVERY_UNKNOWN");
    assert.equal(uncertainEmail.status, "RUNNING", "unknown delivery must hold the action in an unresolved state");
    await assert.rejects(() => sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: uncertainProvider }), /reconcile/i, "unknown delivery must block automatic resend");
    assert.equal(uncertainSendCount, 1);
    const notFoundEmail = await reconcileSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: uncertainProvider });
    assert.equal((notFoundEmail.result as { state: string }).state, "NOT_FOUND_REVIEW_REQUIRED");
    await assert.rejects(() => resetSupplierEmailForRetry({
      context: managerContext,
      actionId: approvedEmail.action.id,
      input: { confirmedNotSent: true, note: "short" },
    }), /must explain/i, "non-delivery recovery requires a meaningful operator note");
    const retryReadyEmail = await resetSupplierEmailForRetry({
      context: managerContext,
      actionId: approvedEmail.action.id,
      input: { confirmedNotSent: true, note: "Verified the stable message ID was absent from the connected Gmail sent folder." },
    });
    assert.equal((retryReadyEmail.result as { state: string }).state, "RETRY_READY");
    let providerSendCount = 0;
    let retriedMessageId = "";
    const sentProvider: SupplierEmailProvider = {
      async send(input) {
        providerSendCount += 1;
        assert.match(input.rfcMessageId, /^<supply-/);
        assert.equal(input.senderEmail, senderAccount.email);
        retriedMessageId = input.rfcMessageId;
        return { state: "SENT", provider: "GMAIL", providerMessageId: "gmail-test-message", providerThreadId: "gmail-test-thread", sourceUrl: "https://mail.google.com/mail/u/test/#sent/gmail-test-thread" };
      },
      async reconcile() {
        throw new Error("Reconciliation should not run for a confirmed send.");
      },
    };
    const sentEmail = await sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: sentProvider });
    assert.equal(sentEmail.status, "SUCCEEDED");
    assert.match(retriedMessageId, /-2@derya\.ai>$/, "a reviewed retry must use a new stable message ID");
    assert.equal(providerSendCount, 1);
    await sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: sentProvider });
    assert.equal(providerSendCount, 1, "an identical send retry must not call Gmail twice");
    const connectedQuoteCycle = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: retryQuoteDraft.quoteCycle.id } });
    assert.equal(connectedQuoteCycle.status, "RUNNING");
    assert.equal((connectedQuoteCycle.result as { externalSideEffect: string }).externalSideEffect, "CONNECTED_PROVIDER");
    const connectedEvidence = await prisma.supplyEvidence.findFirstOrThrow({ where: { executionTaskId: retryQuoteDraft.quoteCycle.id, sourceType: "CONNECTED_PROVIDER" } });
    assert.equal(connectedEvidence.sourceRecordId, "gmail-test-message");
    assert.equal(await prisma.emailMessage.count({ where: { gmailMessageId: "gmail-test-message", thread: { officeId: context.officeId } } }), 1);
    const retryQuoteResponse = await recordSupplierQuoteResponse({
      context,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      input: {
        expectedRequestHash: retryRequestHash,
        receivedOn: futureDate(0),
        price: 126,
        currency: "USD",
        minimumOrderQuantity: 4,
        unitOfMeasure: "EA",
        deliveryDate: quoteDeliveryDate,
        evidenceUrl: "https://example.com/quote/retry",
        quoteReference: "Q-RETRY",
        validUntil: quoteValidUntil,
        note: null,
      },
    });
    await reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: {
        gate: "COMMERCIAL_TERMS",
        expectedSelectionHash: returnedHash,
        quoteCycleTaskId: retryQuoteDraft.quoteCycle.id,
        responseHash: (retryQuoteResponse.response as { responseHash: string }).responseHash,
      },
    });
    const retryQualityPlan = {
      method: "SAMPLE",
      acceptanceCriteria: "Approve calibration, traceability, and connector-fit sample results.",
      owner: "Atlas quality engineering",
      targetDate: qualityTargetDate,
    } as const;
    await reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: { gate: "QUALITY_PLAN", expectedSelectionHash: returnedHash, ...retryQualityPlan },
    });
    const firstPendingAttempt = await requestProcurementApproval({
      context,
      caseId: returnedCase.id,
      input: { expectedSelectionHash: returnedHash, reason: "Approval retry lifecycle test." },
    });
    await reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: {
        gate: "QUALITY_PLAN",
        expectedSelectionHash: returnedHash,
        ...retryQualityPlan,
        acceptanceCriteria: "Changed plan that invalidates the pending approval.",
      },
    });
    assert.equal((await prisma.supplyApproval.findUniqueOrThrow({ where: { id: firstPendingAttempt.approval.id } })).status, "CANCELLED");
    await assert.rejects(() => decideProcurementApproval({
      context: managerContext,
      approvalId: firstPendingAttempt.approval.id,
      input: { decision: "APPROVE" },
    }), /already been decided/i, "a cancelled approval cannot approve changed scope");
    await reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: { gate: "QUALITY_PLAN", expectedSelectionHash: returnedHash, ...retryQualityPlan },
    });
    const secondPendingAttempt = await requestProcurementApproval({
      context,
      caseId: returnedCase.id,
      input: { expectedSelectionHash: returnedHash, reason: "Restored exact scope requires a new attempt." },
    });
    assert.notEqual(secondPendingAttempt.approval.id, firstPendingAttempt.approval.id);
    assert.equal(secondPendingAttempt.approval.scopeHash, firstPendingAttempt.approval.scopeHash, "restored scope keeps the same immutable hash");
    assert.equal(secondPendingAttempt.approval.status, "PENDING");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
      await tx.supplyApproval.update({
        where: { id: secondPendingAttempt.approval.id },
        data: { expiresAt: new Date(secondPendingAttempt.approval.requestedAt.getTime() + 1) },
      });
    });
    const expiredDecision = await decideProcurementApproval({
      context: managerContext,
      approvalId: secondPendingAttempt.approval.id,
      input: { decision: "APPROVE", note: "Too late" },
    });
    const expiredResult = expiredDecision.procurementCase.result as {
      stage: string;
      gates: { purchaseApproval: string };
      approval: { status: string };
    };
    assert.equal(expiredDecision.approval.status, "EXPIRED");
    assert.equal(expiredResult.stage, "APPROVAL", "an expired request must return the case to an actionable review stage");
    assert.equal(expiredResult.gates.purchaseApproval, "BLOCKED");
    assert.equal(expiredResult.approval.status, "EXPIRED");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: secondPendingAttempt.approval.executionTaskId! },
    })).status, "CANCELLED");

    const releaseScopeRequest = await requestProcurementApproval({
      context,
      caseId: returnedCase.id,
      input: { expectedSelectionHash: returnedHash, reason: "Authorize the restored scope for supplier acknowledgment testing." },
    });
    await decideProcurementApproval({
      context: managerContext,
      approvalId: releaseScopeRequest.approval.id,
      input: { decision: "APPROVE", note: "Restored scope approved for order preparation." },
    });
    const releaseDraft = await savePurchaseOrderDraft({
      context,
      caseId: returnedCase.id,
      input: {
        ...purchaseDraftInput,
        expectedApprovalId: releaseScopeRequest.approval.id,
        expectedApprovalScopeHash: releaseScopeRequest.approval.scopeHash,
        quantity: 14,
      },
    });
    const releaseActionRequest = await requestPurchaseActionApproval({
      context,
      caseId: returnedCase.id,
      input: {
        expectedDraftTaskId: releaseDraft.purchaseDraft!.id,
        expectedDraftResultHash: releaseDraft.purchaseDraft!.resultHash,
        expectedDraftRevision: 1,
        reason: "Authorize the exact order before recording external supplier acceptance.",
      },
    });
    const releaseAction = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: releaseActionRequest.approval.id,
      input: { decision: "APPROVE", note: "Exact released order scope authorized." },
    });
    const acknowledgmentBase = {
      channel: "EMAIL",
      releasedOn: futureDate(0),
      acknowledgedOn: futureDate(0),
      supplierOrderReference: "ACK-001-A",
      acceptedQuantity: 6,
      confirmedDeliveryDate: quoteDeliveryDate,
      evidenceUrl: "https://example.com/acknowledgments/part-1",
      note: "Supplier accepted the first allocation.",
    } as const;
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...acknowledgmentBase, releasedOn: futureDate(1), acknowledgedOn: futureDate(1) },
    }), /cannot be in the future/i, "future-dated supplier releases must be rejected");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...acknowledgmentBase, releasedOn: futureDate(-1) },
    }), /cannot precede final purchase authorization/i, "supplier release evidence cannot be backdated before authorization");
    await prisma.user.update({ where: { id: secondAdmin.id }, data: { isActive: false } });
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: releaseAction.purchaseAction.id,
      input: acknowledgmentBase,
    }), /active admin decision/i, "supplier release must not start from an authorization whose deciding admin is inactive");
    await prisma.user.update({ where: { id: secondAdmin.id }, data: { isActive: true } });
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...acknowledgmentBase, acceptedQuantity: 15 },
    }), /cannot exceed the remaining 14 EA/i, "acceptance cannot exceed the immutable order quantity");
    const partialAcknowledgment = await recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: releaseAction.purchaseAction.id,
      input: acknowledgmentBase,
    });
    const partialResult = partialAcknowledgment.purchaseAction.result as {
      state: string;
      acknowledgedQuantity: string;
      remainingQuantity: string;
      totals: { acknowledgedMaterialValue: string; currency: string };
      acknowledgments: unknown[];
      externalSideEffect: string;
    };
    assert.equal(partialAcknowledgment.purchaseAction.status, "RUNNING");
    assert.equal(partialAcknowledgment.purchaseDraft.status, "RUNNING");
    assert.equal(partialResult.state, "PARTIALLY_ACKNOWLEDGED");
    assert.equal(partialResult.acknowledgedQuantity, "6");
    assert.equal(partialResult.remainingQuantity, "8");
    assert.equal(partialResult.totals.acknowledgedMaterialValue, "756");
    assert.equal(partialResult.totals.currency, "USD");
    assert.equal(partialResult.acknowledgments.length, 1);
    assert.equal(partialResult.externalSideEffect, "RECORDED_ONLY");
    const partialEvidenceId = (partialAcknowledgment.acknowledgment as { evidenceId: string }).evidenceId;
    assert.equal((await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: partialEvidenceId } })).kind, "SUPPLIER_ORDER_ACKNOWLEDGMENT");
    const acknowledgmentEvidenceCount = await prisma.supplyEvidence.count({ where: { executionTaskId: releaseAction.purchaseAction.id, kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT" } });
    const partialEventCount = await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, eventType: "SUPPLIER_ORDER_PARTIALLY_ACKNOWLEDGED" },
    });
    const repeatedAcknowledgment = await recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: releaseAction.purchaseAction.id,
      input: acknowledgmentBase,
    });
    assert.equal((repeatedAcknowledgment.purchaseAction.result as { acknowledgments: unknown[] }).acknowledgments.length, 1);
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, eventType: "SUPPLIER_ORDER_PARTIALLY_ACKNOWLEDGED" },
    }), partialEventCount, "identical acknowledgment retries must not append fake history");
    assert.equal(await prisma.supplyEvidence.count({ where: { executionTaskId: releaseAction.purchaseAction.id, kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT" } }), acknowledgmentEvidenceCount, "identical acknowledgments must not duplicate evidence");
    const fullAcknowledgment = await recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: {
        ...acknowledgmentBase,
        channel: "SUPPLIER_PORTAL",
        supplierOrderReference: "ACK-001-B",
        acceptedQuantity: 8,
        evidenceUrl: "https://example.com/acknowledgments/part-2",
        note: "Supplier accepted the remaining allocation.",
      },
    });
    const fullResult = fullAcknowledgment.purchaseAction.result as {
      state: string;
      acknowledgedQuantity: string;
      remainingQuantity: string;
      totals: { acknowledgedMaterialValue: string };
      acknowledgments: unknown[];
      externalSideEffect: string;
    };
    assert.equal(fullAcknowledgment.purchaseAction.status, "SUCCEEDED");
    assert.equal(fullAcknowledgment.purchaseDraft.status, "SUCCEEDED");
    assert.equal(fullResult.state, "ACKNOWLEDGED");
    assert.equal(fullResult.acknowledgedQuantity, "14");
    assert.equal(fullResult.remainingQuantity, "0");
    assert.equal(fullResult.totals.acknowledgedMaterialValue, "1764");
    assert.equal(fullResult.acknowledgments.length, 2);
    assert.equal(fullResult.externalSideEffect, "RECORDED_ONLY");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: retryQuoteDraft.quoteCycle.id },
      select: { status: true },
    })).status, "SUCCEEDED", "full supplier acknowledgment must close the selected quote cycle");
    const restoredReleaseCase = (await listProcurementCases(context))[0];
    assert.equal(restoredReleaseCase?.purchaseAction?.status, "SUCCEEDED");
    assert.equal(restoredReleaseCase?.quoteCycle, null, "completed quote cycles must leave the active sourcing queue");
    assert.equal((restoredReleaseCase?.result as { purchaseRelease: { state: string } }).purchaseRelease.state, "ACKNOWLEDGED");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...acknowledgmentBase, supplierOrderReference: "ACK-001-C", acceptedQuantity: 1, evidenceUrl: "https://example.com/acknowledgments/part-3" },
    }), /already fully acknowledged/i, "completed acceptance must reject extra quantity");
    await assert.rejects(() => saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "modeled-option",
        name: "Modeled after release",
        sourceClass: "New",
        sourceUrl: null,
        price: 100,
        currency: "USD",
        minimumOrderQuantity: 1,
        priceType: "Modeled",
        deliveryDate: quoteDeliveryDate,
        deliveryType: "Modeled",
        quality: "Unverified",
      },
    }), /supplier acknowledgment has started/i, "released supplier scope must remain immutable");
    assert.equal((await listProcurementCases(context)).length, 1);
    const events = await prisma.supplyExecutionEvent.findMany({
      where: { executionTaskId: procurementCase.id },
      orderBy: { sequence: "asc" },
    });
    const selectionEvents = events.filter((event) => event.eventType === "PROCUREMENT_CASE_CREATED" || event.eventType === "SUPPLIER_SELECTION_UPDATED");
    assert.equal(selectionEvents.length, 4, "identical retries must not append fake history while A-B-A remains valid");
    assert.equal(selectionEvents[0]?.eventType, "PROCUREMENT_CASE_CREATED");
    assert.equal(selectionEvents[1]?.eventType, "SUPPLIER_SELECTION_UPDATED");
    assert.equal(selectionEvents[2]?.eventType, "SUPPLIER_SELECTION_UPDATED");
    assert.equal(selectionEvents[3]?.eventType, "SUPPLIER_SELECTION_UPDATED");
    assert.ok(events.some((event) => event.eventType === "PROCUREMENT_APPROVED"));
    assert.ok(events.every((event) => Boolean(event.payloadHash)));

    const duplicateRun = await startSourcingResearchRun(context, { ...input, componentItemKey: "DUPLICATE-ID" });
    await completeSourcingResearchRun({
      context,
      runId: duplicateRun.id,
      workspaceId: duplicateRun.workspaceId,
      output: {
        candidates: ["First supplier", "Second supplier"].map((companyName) => ({
          id: "duplicate",
          companyName,
          website: "https://example.com/",
          sourceUrls: ["https://example.com/product"],
          price: supported(125),
          currency: supported("USD"),
          minimumOrderQuantity: supported(4),
          leadTimeDays: supported(14),
          status: "REVIEW_REQUIRED",
        })),
        degraded: false,
        warnings: [],
      },
    });
    await assert.rejects(() => saveProcurementSelection({
      context,
      researchRunId: duplicateRun.id,
      selection: {
        id: "public:duplicate",
        name: "Ambiguous supplier",
        sourceClass: "Official",
        sourceUrl: "https://example.com/",
        price: 125,
        currency: "USD",
        minimumOrderQuantity: 4,
        priceType: "Sourced",
        deliveryDate: "Aug 23",
        deliveryType: "Sourced",
        quality: "Conditional",
      },
    }), /ambiguous candidate identifier/, "duplicate research IDs must never select the wrong supplier");

    const listed = await listSupplyWorkspaces(context);
    assert.ok(listed.some((workspace) => workspace.id === visibleWorkspace.id), "ordinary null-key workspaces must remain visible");
    assert.ok(listed.every((workspace) => !workspace.externalKey?.startsWith("system:")), "the system procurement workspace must stay out of the company directory");

    const restrictedUser = await prisma.user.create({
      data: {
        officeId: context.officeId,
        email: `sourcing-restricted-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Restricted operator",
        role: "EMPLOYEE",
        canViewWholeOffice: false,
      },
    });
    const restrictedContext = { ...context, userId: restrictedUser.id, role: restrictedUser.role, canViewWholeOffice: false };
    const stalePrivilegedContext = { ...restrictedContext, role: "ADMIN", canViewWholeOffice: true };
    await assert.rejects(() => listProcurementCases(restrictedContext), /not found|cannot edit/i, "unassigned employees must not read office procurement cases");
    await assert.rejects(() => saveProcurementSelection({
      context: restrictedContext,
      researchRunId: started.id,
      selection: {
        id: "modeled-option",
        name: "Restricted write",
        sourceClass: "New",
        sourceUrl: null,
        price: 110,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Unverified",
      },
    }), /not found|cannot edit/i, "unassigned employees must not change office procurement cases");
    await assert.rejects(() => saveSupplierQuoteRequest({
      context: restrictedContext,
      caseId: returnedCase.id,
      input: quoteRequestInput,
    }), /not found|cannot edit/i, "unassigned employees must not prepare supplier quote requests");
    await assert.rejects(() => recordSupplierQuoteResponse({
      context: stalePrivilegedContext,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      input: { ...quoteResponseInput, expectedRequestHash: retryRequestHash },
    }), /not found|cannot edit/i, "stale privileged sessions must not record supplier quote responses");
    await assert.rejects(() => reviewProcurementGate({
      context: restrictedContext,
      caseId: returnedCase.id,
      input: {
        gate: "SOURCE_EVIDENCE",
        expectedSelectionHash: (returnedCase.result as { selectionHash: string }).selectionHash,
        note: "Unauthorized review attempt.",
      },
    }), /not found|cannot edit/i, "unassigned employees must not review procurement gates");
    await assert.rejects(() => requestProcurementApproval({
      context: restrictedContext,
      caseId: returnedCase.id,
      input: {
        expectedSelectionHash: (returnedCase.result as { selectionHash: string }).selectionHash,
        reason: "Unauthorized approval request.",
      },
    }), /not found|cannot edit/i, "unassigned employees must not request procurement approval");
    await assert.rejects(() => decideProcurementApproval({
      context: restrictedContext,
      approvalId: requested.approval.id,
      input: { decision: "APPROVE" },
    }), /admin or manager/i, "employees must not decide procurement approvals");
    await assert.rejects(() => decideProcurementApproval({
      context: stalePrivilegedContext,
      approvalId: secondPendingAttempt.approval.id,
      input: { decision: "APPROVE" },
    }), /admin or manager/i, "a stale privileged cookie must not preserve approval authority after demotion");
    await assert.rejects(() => saveProcurementSelection({
      context: stalePrivilegedContext,
      researchRunId: started.id,
      selection: {
        id: "public:candidate-1",
        name: "Stale-session write",
        sourceClass: "Official",
        sourceUrl: "https://example.com/",
        price: 125,
        currency: "USD",
        minimumOrderQuantity: 4,
        priceType: "Sourced",
        deliveryDate: quoteDeliveryDate,
        deliveryType: "Sourced",
        quality: "Conditional",
      },
    }), /not found|cannot edit/i, "a stale privileged cookie must not change supplier selection after demotion");
    await assert.rejects(() => savePurchaseOrderDraft({
      context: stalePrivilegedContext,
      caseId: procurementCase.id,
      input: purchaseDraftInput,
    }), /not found|cannot edit/i, "a stale privileged cookie must not prepare an order after demotion");
    await assert.rejects(() => decidePurchaseActionApproval({
      context: stalePrivilegedContext,
      approvalId: authorizedAction.approval.id,
      input: { decision: "APPROVE" },
    }), /current user|only an admin/i, "a stale privileged cookie must not retain purchase authorization power after demotion");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: stalePrivilegedContext,
      actionId: releaseAction.purchaseAction.id,
      input: acknowledgmentBase,
    }), /admin or manager/i, "a stale privileged cookie must not record supplier acknowledgment after demotion");

    const foreign = await makeContext("foreign");
    foreignOfficeId = foreign.officeId;
    assert.equal((await listSourcingResearchRuns(foreign)).length, 0, "another office must not see sourcing research runs");
    assert.equal((await listProcurementCases(foreign)).length, 0, "another office must not see procurement cases");
    await assert.rejects(() => procurementEvidenceSource(foreign, storedQuoteResponse.evidenceId), /not found/i, "another office must not resolve supplier evidence");
    assert.equal((await procurementEvidenceSource(context, storedQuoteResponse.evidenceId)).url, quoteResponseInput.evidenceUrl);
    await assert.rejects(() => decideProcurementApproval({
      context: foreign,
      approvalId: requested.approval.id,
      input: { decision: "APPROVE" },
    }), /not found/i, "another office must not decide a procurement approval");
    await assert.rejects(() => savePurchaseOrderDraft({
      context: foreign,
      caseId: procurementCase.id,
      input: purchaseDraftInput,
    }), /not found/i, "another office must not read or update a purchase draft");
    await assert.rejects(() => decidePurchaseActionApproval({
      context: foreign,
      approvalId: authorizedAction.approval.id,
      input: { decision: "APPROVE" },
    }), /not found/i, "another office must not decide a purchase action approval");
    await assert.rejects(() => recordSupplierQuoteRelease({
      context: foreign,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      input: quoteReleaseInput,
    }), /not found/i, "another office must not record supplier quote release");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: foreign,
      actionId: releaseAction.purchaseAction.id,
      input: acknowledgmentBase,
    }), /not found/i, "another office must not record supplier acknowledgment");

    console.log("Supply OS sourcing persistence checks passed.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
