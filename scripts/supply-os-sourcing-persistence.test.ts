import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createSupplyWorkspace, listSupplyWorkspaces, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import {
  decidePurchaseActionApproval,
  decideProcurementApproval,
  findProcurementCaseByRelatedTaskId,
  listProcurementCases,
  listProcurementCasesForResearchRuns,
  procurementEvidenceSource,
  prepareRevisedPurchaseOrder,
  recordPurchaseOrderRelease,
  recordSupplierQuoteRelease,
  recordSupplierQuoteResponse,
  recordPurchaseOrderAcknowledgment,
  recordSupplierOrderException,
  resolveSupplierOrderException,
  requestPurchaseActionApproval,
  requestProcurementApproval,
  reviewProcurementGate,
  savePurchaseOrderDraft,
  saveProcurementShortlist,
  saveProcurementSelection,
  saveSupplierQuoteRequest,
} from "../src/lib/supply-os/procurement-case-persistence";
import {
  completeSourcingResearchRun,
  listSourcingResearchPage,
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
import {
  decidePurchaseOrderEmailApproval,
  reconcilePurchaseOrderEmailAction,
  requestPurchaseOrderEmailApproval,
  resetPurchaseOrderEmailForRetry,
  savePurchaseOrderEmailDraft,
  sendPurchaseOrderEmailAction,
} from "../src/lib/supply-os/purchase-order-communication-persistence";
import {
  decidePurchaseOrderFollowUpApproval,
  reconcilePurchaseOrderFollowUpAction,
  requestPurchaseOrderFollowUpApproval,
  resetPurchaseOrderFollowUpForRetry,
  savePurchaseOrderFollowUpDraft,
  sendPurchaseOrderFollowUpAction,
} from "../src/lib/supply-os/purchase-order-followup-persistence";
import { gmailSupplierEmailProvider, type SupplierEmailProvider } from "../src/lib/supply-os/supplier-email-provider";
import { captureConnectedPurchaseOrderReplies, captureConnectedSupplierReplies } from "../src/lib/supply-os/supplier-reply-persistence";
import { returnStaleReplacementToSourcing } from "../src/lib/supply-os/purchase-order-revision";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

function jsonDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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
    const stale = await startSourcingResearchRun(context, { ...input, componentItemKey: "STALE-1" });
    const tiedResearchTime = new Date(Date.now() - 60_000);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
      await tx.supplyCapabilityRun.updateMany({
        where: { id: { in: [started.id, stale.id] } },
        data: { createdAt: tiedResearchTime },
      });
    });
    const observedAt = new Date().toISOString();
    const futureDate = (days: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const quoteDeliveryDate = futureDate(20);
    const quoteValidUntil = futureDate(15);
    const qualityTargetDate = futureDate(10);
    const supplierQualificationInput = (expectedSelectionHash: string, note: string) => ({
      gate: "SOURCE_EVIDENCE",
      expectedSelectionHash,
      outcome: "QUALIFIED",
      relationship: "MANUFACTURER",
      identityEvidenceUrl: "https://example.com/",
      capabilityEvidenceUrl: "https://example.com/product",
      authorizationEvidenceUrl: null,
      validUntil: futureDate(90),
      rejectionReason: "SOURCE_UNVERIFIABLE",
      note,
    });
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
    const firstResearchPage = await listSourcingResearchPage(context, { limit: 1 });
    assert.equal(firstResearchPage.runs.length, 1);
    assert.ok(firstResearchPage.nextCursor, "a full sourcing page must return an older-work cursor");
    const midPaginationRun = await startSourcingResearchRun(context, {
      ...input,
      componentItemKey: "MID-PAGINATION-1",
      componentName: "Newer mid-pagination request",
    });
    const secondResearchPage = await listSourcingResearchPage(context, { limit: 1, cursor: firstResearchPage.nextCursor! });
    assert.equal(secondResearchPage.runs.length, 1);
    assert.notEqual(secondResearchPage.runs[0]?.id, firstResearchPage.runs[0]?.id, "cursor pages must not repeat research runs");
    assert.equal(secondResearchPage.nextCursor, null);
    assert.deepEqual(
      new Set([...firstResearchPage.runs, ...secondResearchPage.runs].map((run) => run.id)),
      new Set([started.id, stale.id]),
      "pagination must keep every durable research run reachable",
    );
    assert.equal(
      [...firstResearchPage.runs, ...secondResearchPage.runs].some((run) => run.id === midPaginationRun.id),
      false,
      "a run inserted above the cursor must not shift or duplicate the older page sequence",
    );
    assert.equal(
      (await listSourcingResearchPage(context, { limit: 3 })).runs[0]?.id,
      midPaginationRun.id,
      "a fresh queue read must include the run inserted during the prior pagination session",
    );
    await assert.rejects(
      () => listSourcingResearchPage(context, { cursor: "not-a-valid-cursor" }),
      /cursor is invalid/i,
    );
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
    const selectionHash = (procurementCase.result as { selectionHash: string }).selectionHash;
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        ...supplierQualificationInput(selectionHash, "Authorization evidence is intentionally missing for this negative test."),
        relationship: "AUTHORIZED_DISTRIBUTOR",
        authorizationEvidenceUrl: null,
      },
    }), /authorization evidence/i, "authorized distributors require manufacturer relationship evidence");
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        ...supplierQualificationInput(selectionHash, "Identity evidence points at the wrong company for this negative test."),
        identityEvidenceUrl: "https://unrelated.example/company",
      },
    }), /match the attributed supplier domain/i, "supplier identity evidence cannot point at an unrelated domain");

    const rejectedSupplier = await reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "SOURCE_EVIDENCE",
        expectedSelectionHash: selectionHash,
        outcome: "REJECTED",
        rejectionReason: "AUTHORIZATION_UNRESOLVED",
        note: "Manufacturer authorization could not be verified for this supplier relationship.",
      },
    });
    const rejectedResult = rejectedSupplier.result as { stage: string; gates: { sourceEvidence: string }; reviews: { sourceEvidence: { outcome: string; rejectionReason: string; evidenceId: string } } };
    assert.equal(rejectedResult.stage, "SUPPLIER_REJECTED");
    assert.equal(rejectedResult.gates.sourceEvidence, "BLOCKED");
    assert.equal(rejectedResult.reviews.sourceEvidence.outcome, "REJECTED");
    assert.equal(rejectedResult.reviews.sourceEvidence.rejectionReason, "AUTHORIZATION_UNRESOLVED");
    const listedRejected = (await listProcurementCases(context)).find((candidate) => candidate.id === procurementCase.id);
    assert.equal((listedRejected?.result as { stage?: string } | null)?.stage, "SUPPLIER_REJECTED", "rejected suppliers must remain visible and resumable");

    const sourceReviewed = await reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: supplierQualificationInput(
        selectionHash,
        "Verified the official supplier identity and matching product capability page.",
      ),
    });
    assert.equal((sourceReviewed.result as { stage: string }).stage, "COMMERCIAL_CONFIRMATION");
    const sourceReview = (sourceReviewed.result as { reviews: { sourceEvidence: { evidenceId: string } } }).reviews.sourceEvidence;
    assert.ok(sourceReview.evidenceId, "supplier review must create independently addressable evidence");
    const sourceReviewEvidence = await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: sourceReview.evidenceId } });
    assert.equal(sourceReviewEvidence.confidence, null, "captured operator evidence must not claim verification confidence");
    assert.equal(sourceReviewEvidence.kind, "SUPPLIER_QUALIFICATION");
    assert.equal(sourceReviewEvidence.sourceType, "OPERATOR_RECORDED_EXTERNAL");
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
    const expiredQualificationResult = structuredClone(sourceReviewed.result) as Record<string, unknown>;
    const expiredQualificationReviews = expiredQualificationResult.reviews as { sourceEvidence: { validUntil: string; reviewHash: string } };
    expiredQualificationReviews.sourceEvidence.validUntil = futureDate(-1);
    expiredQualificationReviews.sourceEvidence.reviewHash = "expired-qualification-projection-test";
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: expiredQualificationResult, resultHash: jsonDigest(expiredQualificationResult) },
    });
    const projectedExpiredQualification = (await listProcurementCasesForResearchRuns(context, [started.id]))
      .find((candidate) => candidate.id === procurementCase.id);
    assert.equal((projectedExpiredQualification?.result as { stage?: string } | null)?.stage, "SOURCE_EVIDENCE", "expired qualifications must reopen Gate 1 in the sourcing queue");
    assert.equal(projectedExpiredQualification?.quoteCycle, null, "stale downstream work must not be exposed while qualification is expired");
    await assert.rejects(() => saveSupplierQuoteRequest({ context, caseId: procurementCase.id, input: quoteRequestInput }), /qualification is missing or expired/i, "expired qualification must block RFQ preparation on the server");
    await reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: supplierQualificationInput(selectionHash, "Requalified supplier identity and component capability after expiry."),
    });
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
    const preReleaseCase = await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: procurementCase.id },
      select: { result: true },
    });
    const preReleaseResult = structuredClone(preReleaseCase.result) as Record<string, unknown>;
    const expiredPreReleaseResult = structuredClone(preReleaseResult) as Record<string, unknown>;
    (expiredPreReleaseResult.reviews as { sourceEvidence: { validUntil: string } }).sourceEvidence.validUntil = futureDate(-1);
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: expiredPreReleaseResult, resultHash: jsonDigest(expiredPreReleaseResult) },
    });
    await assert.rejects(
      () => recordSupplierQuoteRelease({ context, quoteCycleId: quoteDraft.quoteCycle.id, input: quoteReleaseInput }),
      /qualification was not valid on the release date/i,
      "expired qualification must block a newly recorded supplier contact",
    );
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: preReleaseResult, resultHash: jsonDigest(preReleaseResult) },
    });
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
    const postReleaseCase = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: procurementCase.id }, select: { result: true } });
    const postReleaseResult = structuredClone(postReleaseCase.result) as Record<string, unknown>;
    const expiredPostReleaseResult = structuredClone(postReleaseResult) as Record<string, unknown>;
    (expiredPostReleaseResult.reviews as { sourceEvidence: { validUntil: string } }).sourceEvidence.validUntil = futureDate(-1);
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: expiredPostReleaseResult, resultHash: jsonDigest(expiredPostReleaseResult) },
    });
    await recordSupplierQuoteRelease({ context, quoteCycleId: quoteDraft.quoteCycle.id, input: quoteReleaseInput });
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, eventType: "SUPPLIER_QUOTE_REQUEST_RELEASE_RECORDED" } }), releaseEventCount, "identical release retries must be idempotent");
    assert.equal(await prisma.supplyEvidence.count({ where: { executionTaskId: quoteDraft.quoteCycle.id, kind: "SUPPLIER_QUOTE_RELEASE" } }), releaseEvidenceCount, "identical release retries must not duplicate evidence");
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: postReleaseResult, resultHash: jsonDigest(postReleaseResult) },
    });
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
    const preCommercialCase = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: procurementCase.id }, select: { result: true } });
    const preCommercialResult = structuredClone(preCommercialCase.result) as Record<string, unknown>;
    const expiredPreCommercialResult = structuredClone(preCommercialResult) as Record<string, unknown>;
    (expiredPreCommercialResult.reviews as { sourceEvidence: { validUntil: string } }).sourceEvidence.validUntil = futureDate(-1);
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: expiredPreCommercialResult, resultHash: jsonDigest(expiredPreCommercialResult) },
    });
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "COMMERCIAL_TERMS",
        expectedSelectionHash: selectionHash,
        quoteCycleTaskId: quoteDraft.quoteCycle.id,
        responseHash: storedQuoteResponse.responseHash,
      },
    }), /qualification is missing or expired/i, "qualification expiry must block commercial confirmation");
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: preCommercialResult, resultHash: jsonDigest(preCommercialResult) },
    });
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
    const preQualityResult = structuredClone(termsReviewed.result) as Record<string, unknown>;
    const expiredPreQualityResult = structuredClone(preQualityResult) as Record<string, unknown>;
    (expiredPreQualityResult.reviews as { sourceEvidence: { validUntil: string } }).sourceEvidence.validUntil = futureDate(-1);
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: expiredPreQualityResult, resultHash: jsonDigest(expiredPreQualityResult) },
    });
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: procurementCase.id,
      input: {
        gate: "QUALITY_PLAN",
        expectedSelectionHash: selectionHash,
        method: "SAMPLE",
        acceptanceCriteria: "Verify calibration, connector fit, image depth accuracy, and serial traceability.",
        owner: "Atlas vision engineering",
        targetDate: qualityTargetDate,
      },
    }), /qualification is missing or expired/i, "qualification expiry must block quality planning");
    await prisma.supplyExecutionTask.update({
      where: { id: procurementCase.id },
      data: { result: preQualityResult, resultHash: jsonDigest(preQualityResult) },
    });
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

    const orderSenderAccount = await prisma.emailAccount.create({
      data: {
        officeId: context.officeId,
        email: `orders-${suffix}@example.test`,
        provider: "GMAIL",
        accessToken: "test-only-order-token",
      },
    });
    const orderEmailInput = {
      expectedActionScopeHash: authorizedPurchase.purchaseAction.inputHash,
      expectedRevision: 0,
      senderAccountId: orderSenderAccount.id,
      recipient: "orders@example.com",
      subject: "Purchase order ATLAS-VIS-410",
      body: "Please accept the attached authorized purchase order and confirm the delivery date.",
      purchaseOrderReference: "ATLAS-VIS-410",
      acknowledgmentDueOn: futureDate(0),
      note: "Connected Gmail order release test.",
    } as const;
    const orderEmailDraft = await savePurchaseOrderEmailDraft({
      context,
      purchaseActionId: authorizedPurchase.purchaseAction.id,
      input: orderEmailInput,
    });
    assert.equal(orderEmailDraft.taskType, "PURCHASE_ORDER_EMAIL_DRAFT");
    assert.equal((orderEmailDraft.result as { revision: number }).revision, 1);
    const orderEmailApproval = await requestPurchaseOrderEmailApproval({
      context,
      draftId: orderEmailDraft.id,
      input: { expectedResultHash: orderEmailDraft.resultHash, reason: "Approve the exact authorized order email." },
    });
    await assert.rejects(() => decidePurchaseOrderEmailApproval({
      context,
      approvalId: orderEmailApproval.approval.id,
      input: { decision: "APPROVE" },
    }), /different eligible approver/i, "the order email requester must not self-approve when another approver is available");
    const approvedOrderEmail = await decidePurchaseOrderEmailApproval({
      context: managerContext,
      approvalId: orderEmailApproval.approval.id,
      input: { decision: "APPROVE", note: "Exact sender, recipient, order scope, and message approved." },
    });
    assert.equal(approvedOrderEmail.action.status, "READY");
    await assert.rejects(() => recordPurchaseOrderRelease({
      context: managerContext,
      actionId: authorizedPurchase.purchaseAction.id,
      input: {
        expectedScopeHash: authorizedPurchase.purchaseAction.inputHash,
        channel: "EMAIL",
        releasedOn: futureDate(0),
        acknowledgmentDueOn: futureDate(3),
        purchaseOrderReference: "ATLAS-VIS-410",
        evidenceUrl: "https://example.com/manual-order-release",
        note: null,
      },
    }), /connected purchase order email is pending, approved, or unresolved/i, "manual release must not race an approved connected order email");
    const revisedOrderEmailDraft = await savePurchaseOrderEmailDraft({
      context,
      purchaseActionId: authorizedPurchase.purchaseAction.id,
      input: { ...orderEmailInput, expectedRevision: 1, body: `${orderEmailInput.body}\nPlease include your supplier order reference.` },
    });
    assert.equal((revisedOrderEmailDraft.result as { revision: number }).revision, 2);
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: approvedOrderEmail.action.id } })).status, "CANCELLED", "changing the approved message must cancel its send action");
    const restoredOrderEmailCase = (await listProcurementCases(context))[0];
    assert.equal(restoredOrderEmailCase?.purchaseOrderEmailDraft?.id, revisedOrderEmailDraft.id, "the queue must restore the active purchase order email draft");
    assert.equal(restoredOrderEmailCase?.purchaseOrderEmailAction, null, "a cancelled send action must not remain active in the queue");

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
      input: supplierQualificationInput(returnedHash, "Verified supplier identity and capability for approval retry."),
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
    const qualifiedEmailCase = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: returnedCase.id }, select: { result: true } });
    const qualifiedEmailCaseResult = structuredClone(qualifiedEmailCase.result) as Record<string, unknown>;
    const expiredEmailCaseResult = structuredClone(qualifiedEmailCaseResult) as Record<string, unknown>;
    (expiredEmailCaseResult.reviews as { sourceEvidence: { validUntil: string } }).sourceEvidence.validUntil = futureDate(-1);
    const changedEmailQualificationResult = structuredClone(qualifiedEmailCaseResult) as Record<string, unknown>;
    (changedEmailQualificationResult.reviews as { sourceEvidence: { reviewHash: string } }).sourceEvidence.reviewHash = "replacement-qualification-review-hash";
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: expiredEmailCaseResult, resultHash: jsonDigest(expiredEmailCaseResult) },
    });
    await assert.rejects(() => saveSupplierEmailDraft({
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
    }), /qualification is missing or expired/i, "expired qualification must block supplier email drafting on the server");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: qualifiedEmailCaseResult, resultHash: jsonDigest(qualifiedEmailCaseResult) },
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
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: expiredEmailCaseResult, resultHash: jsonDigest(expiredEmailCaseResult) },
    });
    await assert.rejects(() => requestSupplierEmailApproval({
      context,
      draftId: supplierEmailDraft.id,
      input: { expectedResultHash: supplierEmailDraft.resultHash, reason: "Release the exact supplier quote request through the connected buyer inbox." },
    }), /qualification is missing or expired/i, "expired qualification must block a supplier email approval request");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: qualifiedEmailCaseResult, resultHash: jsonDigest(qualifiedEmailCaseResult) },
    });
    let emailApprovalRequest = await requestSupplierEmailApproval({
      context,
      draftId: supplierEmailDraft.id,
      input: { expectedResultHash: supplierEmailDraft.resultHash, reason: "Release the exact supplier quote request through the connected buyer inbox." },
    });
    const emailScope = emailApprovalRequest.action.input as { message: { recipient: string; subject: string; body: string }; draftMessageHash: string };
    assert.equal(emailScope.message.recipient, "quotes@example.com");
    assert.equal(emailScope.message.subject, "Quote request: calibrated stereo depth cameras");
    assert.ok(emailScope.draftMessageHash, "approval must bind the exact draft message hash");
    assert.ok((emailApprovalRequest.action.input as { supplierQualificationHash?: string }).supplierQualificationHash, "approval must bind the exact supplier qualification review");
    const repeatedEmailApprovalRequest = await requestSupplierEmailApproval({
      context,
      draftId: supplierEmailDraft.id,
      input: { expectedResultHash: supplierEmailDraft.resultHash, reason: "Release the exact supplier quote request through the connected buyer inbox." },
    });
    assert.equal(repeatedEmailApprovalRequest.action.id, emailApprovalRequest.action.id, "a lost approval-request response must retry to the same action");
    assert.equal(repeatedEmailApprovalRequest.approval.id, emailApprovalRequest.approval.id, "approval request retries must not duplicate pending approvals");
    const legacyActionId = emailApprovalRequest.action.id;
    const legacyApprovalId = emailApprovalRequest.approval.id;
    const legacyActionInput = structuredClone(emailApprovalRequest.action.input) as Record<string, unknown>;
    delete legacyActionInput.supplierQualificationHash;
    delete legacyActionInput.supplierQualificationValidUntil;
    const legacyInputHash = jsonDigest(legacyActionInput);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
      await tx.supplyExecutionTask.update({
        where: { id: legacyActionId },
        data: { input: legacyActionInput, inputHash: legacyInputHash },
      });
      await tx.supplyApproval.update({
        where: { id: legacyApprovalId },
        data: { scopeHash: legacyInputHash },
      });
    });
    const legacyProjectedCase = (await listProcurementCases(context)).find((candidate) => candidate.id === returnedCase.id);
    assert.equal(legacyProjectedCase?.supplierEmailAction, null, "legacy unscoped approvals must reopen the request-approval path");
    emailApprovalRequest = await requestSupplierEmailApproval({
      context,
      draftId: supplierEmailDraft.id,
      input: { expectedResultHash: emailApprovalRequest.draft.resultHash, reason: "Replace the legacy approval with qualification-scoped supplier contact approval." },
    });
    assert.notEqual(emailApprovalRequest.action.id, legacyActionId, "legacy email actions must be replaced instead of silently grandfathered");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: legacyActionId } })).status, "CANCELLED");
    assert.equal((await prisma.supplyApproval.findUniqueOrThrow({ where: { id: legacyApprovalId } })).status, "CANCELLED");
    assert.ok((emailApprovalRequest.action.input as { supplierQualificationHash?: string }).supplierQualificationHash, "replacement approval must bind the current qualification hash");
    await assert.rejects(() => decideSupplierEmailApproval({
      context,
      approvalId: emailApprovalRequest.approval.id,
      input: { decision: "APPROVE" },
    }), /different eligible approver/i, "supplier email self-approval must be blocked when another approver is available");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: changedEmailQualificationResult, resultHash: jsonDigest(changedEmailQualificationResult) },
    });
    await assert.rejects(() => decideSupplierEmailApproval({
      context: managerContext,
      approvalId: emailApprovalRequest.approval.id,
      input: { decision: "APPROVE", note: "Exact recipient and message approved." },
    }), /qualification changed after email approval was requested/i, "a new qualification review must stale the pending supplier contact approval");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: expiredEmailCaseResult, resultHash: jsonDigest(expiredEmailCaseResult) },
    });
    await assert.rejects(() => decideSupplierEmailApproval({
      context: managerContext,
      approvalId: emailApprovalRequest.approval.id,
      input: { decision: "APPROVE", note: "Exact recipient and message approved." },
    }), /qualification is missing or expired/i, "qualification expiry must stale a pending supplier contact approval");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: qualifiedEmailCaseResult, resultHash: jsonDigest(qualifiedEmailCaseResult) },
    });
    const approvedEmail = await decideSupplierEmailApproval({
      context: managerContext,
      approvalId: emailApprovalRequest.approval.id,
      input: { decision: "APPROVE", note: "Exact recipient and message approved." },
    });
    let expiredQualificationSendCount = 0;
    const shouldNotSendProvider: SupplierEmailProvider = {
      async send() {
        expiredQualificationSendCount += 1;
        return { state: "UNKNOWN", error: "This provider must never be called." };
      },
      async reconcile() {
        return { state: "NOT_FOUND" };
      },
    };
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: changedEmailQualificationResult, resultHash: jsonDigest(changedEmailQualificationResult) },
    });
    await assert.rejects(
      () => sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: shouldNotSendProvider }),
      /qualification changed after this email was approved/i,
      "a still-current replacement qualification must stale the approved supplier email",
    );
    assert.equal(expiredQualificationSendCount, 0, "the provider must not be called when the qualification review hash changes");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: expiredEmailCaseResult, resultHash: jsonDigest(expiredEmailCaseResult) },
    });
    await assert.rejects(
      () => sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: shouldNotSendProvider }),
      /qualification is missing or expired/i,
      "qualification expiry must block the final supplier contact side effect",
    );
    assert.equal(expiredQualificationSendCount, 0, "the provider must not be called after qualification expires");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: qualifiedEmailCaseResult, resultHash: jsonDigest(qualifiedEmailCaseResult) },
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
    const approvedActionResult = structuredClone(approvedEmail.action.result);
    const approvedDraftResult = structuredClone(approvedEmail.draft.result);
    let releaseLateSend: (() => void) | null = null;
    let markLateSendStarted: (() => void) | null = null;
    let releaseLateReconcile: (() => void) | null = null;
    let markLateReconcileStarted: (() => void) | null = null;
    const lateSendStarted = new Promise<void>((resolve) => { markLateSendStarted = resolve; });
    const lateSendRelease = new Promise<void>((resolve) => { releaseLateSend = resolve; });
    const lateReconcileStarted = new Promise<void>((resolve) => { markLateReconcileStarted = resolve; });
    const lateReconcileRelease = new Promise<void>((resolve) => { releaseLateReconcile = resolve; });
    const lateUnknownSendProvider: SupplierEmailProvider = {
      async send() {
        markLateSendStarted?.();
        await lateSendRelease;
        return { state: "UNKNOWN", error: "Original request timed out after reconciliation completed." };
      },
      async reconcile() {
        return { state: "NOT_FOUND" };
      },
    };
    const lateUnknownReconcileProvider: SupplierEmailProvider = {
      async send() {
        return { state: "REJECTED", error: "Send is not used by the reconciliation race test." };
      },
      async reconcile() {
        markLateReconcileStarted?.();
        await lateReconcileRelease;
        return { state: "UNKNOWN", error: "Late reconciliation result must not overwrite SENT." };
      },
    };
    const lateSend = sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: lateUnknownSendProvider });
    await lateSendStarted;
    const lateReconciliation = reconcileSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: lateUnknownReconcileProvider });
    await lateReconcileStarted;
    const sendingAction = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: approvedEmail.action.id } });
    const sendingResult = sendingAction.result as { rfcMessageId: string };
    const simulatedSentResult = {
      state: "SENT",
      rfcMessageId: sendingResult.rfcMessageId,
      provider: "GMAIL",
      providerMessageId: "simulated-reconciled-message",
      sentAt: new Date().toISOString(),
    };
    const simulatedSentAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
      await tx.supplyExecutionTask.update({
        where: { id: approvedEmail.action.id },
        data: { status: "SUCCEEDED", result: simulatedSentResult, resultHash: jsonDigest(simulatedSentResult), startedAt: simulatedSentAt, completedAt: simulatedSentAt },
      });
      await tx.supplyExecutionTask.update({
        where: { id: approvedEmail.draft.id },
        data: { status: "SUCCEEDED", startedAt: simulatedSentAt, completedAt: simulatedSentAt },
      });
    });
    releaseLateSend?.();
    releaseLateReconcile?.();
    const [lateSendResult, lateReconcileResult] = await Promise.all([lateSend, lateReconciliation]);
    assert.equal(lateSendResult.status, "SUCCEEDED", "a late original timeout must not overwrite a reconciled send");
    assert.equal(lateReconcileResult.status, "SUCCEEDED", "a late reconciliation miss must not overwrite a definitive send");
    assert.equal(((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: approvedEmail.action.id } })).result as { state: string }).state, "SENT");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
      await tx.supplyExecutionTask.update({
        where: { id: approvedEmail.action.id },
        data: { status: "READY", result: approvedActionResult as object, resultHash: jsonDigest(approvedActionResult), completedAt: null, startedAt: null },
      });
      await tx.supplyExecutionTask.update({
        where: { id: approvedEmail.draft.id },
        data: { status: "READY", result: approvedDraftResult as object, resultHash: jsonDigest(approvedDraftResult), completedAt: null, startedAt: null },
      });
    });
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
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: {
        gate: "SOURCE_EVIDENCE",
        expectedSelectionHash: returnedHash,
        outcome: "REJECTED",
        rejectionReason: "SOURCE_UNVERIFIABLE",
        note: "Attempted rejection while supplier email delivery was still unresolved.",
      },
    }), /delivery is unresolved/i, "qualification changes must not cancel a supplier email while its provider call is in flight");
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
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: {
        gate: "SOURCE_EVIDENCE",
        expectedSelectionHash: returnedHash,
        outcome: "REJECTED",
        rejectionReason: "SOURCE_UNVERIFIABLE",
        note: "Attempted rejection while supplier email delivery remained unknown.",
      },
    }), /delivery is unresolved/i, "unknown delivery must block qualification changes until reconciliation");
    await assert.rejects(() => sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: uncertainProvider }), /reconcile/i, "unknown delivery must block automatic resend");
    assert.equal(uncertainSendCount, 1);
    const notFoundEmail = await reconcileSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: uncertainProvider });
    assert.equal((notFoundEmail.result as { state: string }).state, "NOT_FOUND_REVIEW_REQUIRED");
    await assert.rejects(() => reviewProcurementGate({
      context,
      caseId: returnedCase.id,
      input: {
        gate: "SOURCE_EVIDENCE",
        expectedSelectionHash: returnedHash,
        outcome: "REJECTED",
        rejectionReason: "SOURCE_UNVERIFIABLE",
        note: "Attempted rejection before a human resolved the not-found delivery state.",
      },
    }), /delivery is unresolved/i, "not-found delivery review must block qualification changes until the retry decision is recorded");
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
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: expiredEmailCaseResult, resultHash: jsonDigest(expiredEmailCaseResult) },
    });
    await sendSupplierEmailAction({ context, actionId: approvedEmail.action.id, provider: sentProvider });
    assert.equal(providerSendCount, 1, "a recorded successful send must remain idempotent after qualification later expires");
    await prisma.supplyExecutionTask.update({
      where: { id: returnedCase.id },
      data: { result: qualifiedEmailCaseResult, resultHash: jsonDigest(qualifiedEmailCaseResult) },
    });
    const connectedQuoteCycle = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: retryQuoteDraft.quoteCycle.id } });
    assert.equal(connectedQuoteCycle.status, "RUNNING");
    assert.equal((connectedQuoteCycle.result as { externalSideEffect: string }).externalSideEffect, "CONNECTED_PROVIDER");
    const connectedEvidence = await prisma.supplyEvidence.findFirstOrThrow({ where: { executionTaskId: retryQuoteDraft.quoteCycle.id, sourceType: "CONNECTED_PROVIDER" } });
    assert.equal(connectedEvidence.sourceRecordId, "gmail-test-message");
    assert.equal(await prisma.emailMessage.count({ where: { gmailMessageId: "gmail-test-message", thread: { officeId: context.officeId } } }), 1);
    const sentResult = sentEmail.result as { localThreadId: string; sentAt: string };
    const supplierReply = await prisma.emailMessage.create({
      data: {
        threadId: sentResult.localThreadId,
        accountId: senderAccount.id,
        externalId: `<supplier-reply-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-reply-${suffix}`,
        direction: "INBOUND",
        fromEmail: "quotes@example.com",
        fromName: "Example supplier quotes",
        toEmails: JSON.stringify([senderAccount.email]),
        subject: "Re: Quote request: calibrated stereo depth cameras",
        bodyText: "Quote Q-RETRY: USD 126 per EA, MOQ 4. Delivery and validity are stated in the attached quotation.",
        attachments: JSON.stringify([{ filename: "Q-RETRY.pdf", mimeType: "application/pdf", size: 2048 }]),
        sentAt: new Date(),
      },
    });
    const otherSenderAccount = await prisma.emailAccount.create({
      data: {
        officeId: context.officeId,
        email: `other-buyer-${suffix}@example.test`,
        provider: "GMAIL",
        accessToken: "test-only-token",
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: sentResult.localThreadId,
        accountId: otherSenderAccount.id,
        externalId: `<wrong-account-reply-${suffix}@example.com>`,
        gmailMessageId: `gmail-wrong-account-reply-${suffix}`,
        direction: "INBOUND",
        fromEmail: "quotes@example.com",
        toEmails: JSON.stringify([otherSenderAccount.email]),
        subject: "Same supplier on the wrong connected account",
        bodyText: "This message must not become evidence for the approved sender account.",
        sentAt: new Date(),
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: sentResult.localThreadId,
        accountId: senderAccount.id,
        externalId: `<pre-send-reply-${suffix}@example.com>`,
        gmailMessageId: `gmail-pre-send-reply-${suffix}`,
        direction: "INBOUND",
        fromEmail: "quotes@example.com",
        toEmails: JSON.stringify([senderAccount.email]),
        subject: "Message predating the approved request",
        bodyText: "This older message must not become quote reply evidence.",
        sentAt: new Date(new Date(sentResult.sentAt).getTime() - 60_000),
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: sentResult.localThreadId,
        accountId: senderAccount.id,
        externalId: `<unrelated-reply-${suffix}@example.com>`,
        gmailMessageId: `gmail-unrelated-reply-${suffix}`,
        direction: "INBOUND",
        fromEmail: "unrelated@example.com",
        toEmails: JSON.stringify([senderAccount.email]),
        subject: "Unrelated participant",
        bodyText: "This message must not become supplier evidence.",
        sentAt: new Date(),
      },
    });
    const replySync = async (input: { accountId: string; officeId: string; query: string }) => {
      assert.equal(input.accountId, senderAccount.id);
      assert.equal(input.officeId, context.officeId);
      assert.equal(input.query, `rfc822msgid:${retriedMessageId}`, "connected reply sync must target only the stable quote-request message ID");
      return { ok: true as const, processed: 2, created: 2, threadsTouched: 1 };
    };
    await assert.rejects(() => captureConnectedSupplierReplies({
      context,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      sync: async () => ({ ok: true, processed: 0, created: 0, threadsTouched: 0 }),
    }), /did not return the delivered quote-request thread/i, "a silent Gmail miss must not be presented as a successful inbox check");
    await assert.rejects(() => captureConnectedSupplierReplies({
      context,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      sync: async () => ({ error: "Temporary provider failure" }),
    }), /Temporary provider failure/i, "an explicit Gmail failure must remain visible and retryable");
    const capturedReplies = await captureConnectedSupplierReplies({ context, quoteCycleId: retryQuoteDraft.quoteCycle.id, sync: replySync });
    assert.equal(capturedReplies.captured, 1, "only the exact approved supplier address may become connected reply evidence");
    assert.equal(capturedReplies.total, 1);
    const replyEvidence = await prisma.supplyEvidence.findFirstOrThrow({
      where: { executionTaskId: retryQuoteDraft.quoteCycle.id, kind: "SUPPLIER_QUOTE_REPLY_EMAIL", sourceRecordId: supplierReply.gmailMessageId },
    });
    assert.equal(replyEvidence.sourceType, "CONNECTED_PROVIDER");
    assert.match(String(replyEvidence.excerpt), /Quote Q-RETRY/);
    assert.match((await procurementEvidenceSource(context, replyEvidence.id)).url, /#sent\/gmail-test-thread$/, "connected evidence links must retain the Gmail thread target");
    const replyEventCount = await prisma.supplyExecutionEvent.count({ where: { executionTaskId: retryQuoteDraft.quoteCycle.id, eventType: "SUPPLIER_QUOTE_REPLIES_CAPTURED" } });
    const repeatedReplySync = await captureConnectedSupplierReplies({ context, quoteCycleId: retryQuoteDraft.quoteCycle.id, sync: replySync });
    assert.equal(repeatedReplySync.captured, 0, "repeated inbox checks must not duplicate connected replies");
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: retryQuoteDraft.quoteCycle.id, eventType: "SUPPLIER_QUOTE_REPLIES_CAPTURED" } }), replyEventCount);
    await prisma.emailMessage.create({
      data: {
        threadId: sentResult.localThreadId,
        accountId: senderAccount.id,
        externalId: `<supplier-follow-up-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-follow-up-${suffix}`,
        direction: "INBOUND",
        fromEmail: "quotes@example.com",
        toEmails: JSON.stringify([senderAccount.email]),
        subject: "Re: Quote request follow-up",
        bodyText: "Follow-up confirming that the attached quote remains the governing offer.",
        sentAt: new Date(),
      },
    });
    const concurrentReplySyncs = await Promise.all([
      captureConnectedSupplierReplies({ context, quoteCycleId: retryQuoteDraft.quoteCycle.id, sync: replySync }),
      captureConnectedSupplierReplies({ context, quoteCycleId: retryQuoteDraft.quoteCycle.id, sync: replySync }),
    ]);
    assert.equal(concurrentReplySyncs.reduce((sum, result) => sum + result.captured, 0), 1, "concurrent inbox checks must capture one new reply exactly once");
    assert.equal(await prisma.supplyEvidence.count({ where: { executionTaskId: retryQuoteDraft.quoteCycle.id, kind: "SUPPLIER_QUOTE_REPLY_EMAIL" } }), 2);
    const restoredReplyCase = (await listProcurementCases(context))[0];
    assert.equal(restoredReplyCase?.quoteCycle?.result && (restoredReplyCase.quoteCycle.result as { connectedReplies?: unknown[] }).connectedReplies?.length, 2, "captured replies must survive queue reloads");
    const connectedResponseInput = {
      expectedRequestHash: retryRequestHash,
      receivedOn: supplierReply.sentAt.toISOString().slice(0, 10),
      price: 126,
      currency: "USD",
      minimumOrderQuantity: 4,
      unitOfMeasure: "EA",
      deliveryDate: quoteDeliveryDate,
      connectedReplyEvidenceId: replyEvidence.id,
      quoteReference: "Q-RETRY",
      validUntil: quoteValidUntil,
      note: null,
    };
    await assert.rejects(() => recordSupplierQuoteResponse({
      context,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      input: { ...connectedResponseInput, connectedReplyEvidenceId: connectedEvidence.id },
    }), /outside the current quote cycle/i, "connected releases or unrelated evidence cannot masquerade as supplier replies");
    const retryQuoteResponse = await recordSupplierQuoteResponse({
      context,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      input: connectedResponseInput,
    });
    assert.equal((retryQuoteResponse.response as { evidenceClass: string }).evidenceClass, "CONNECTED_PROVIDER");
    assert.equal((retryQuoteResponse.response as { connectedReplyEvidenceId: string }).connectedReplyEvidenceId, replyEvidence.id);
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
    const releaseBase = {
      expectedScopeHash: releaseAction.purchaseAction.inputHash,
      channel: "EMAIL",
      releasedOn: futureDate(0),
      acknowledgmentDueOn: futureDate(0),
      purchaseOrderReference: "PO-ATLAS-001",
      evidenceUrl: "https://example.com/purchase-orders/PO-ATLAS-001",
      note: "Authorized order issued through the buyer mailbox.",
    } as const;
    const acknowledgmentBase = {
      expectedReleaseHash: "not-released",
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
      input: acknowledgmentBase,
    }), /does not match the durable purchase order release/i, "supplier acknowledgment must not skip the durable order release checkpoint");
    await assert.rejects(() => recordPurchaseOrderRelease({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...releaseBase, releasedOn: futureDate(1) },
    }), /cannot be in the future/i, "future-dated purchase order releases must be rejected");
    await assert.rejects(() => recordPurchaseOrderRelease({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...releaseBase, releasedOn: futureDate(-1) },
    }), /cannot precede final purchase authorization/i, "purchase order release evidence cannot be backdated before authorization");
    await assert.rejects(() => recordPurchaseOrderRelease({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...releaseBase, expectedScopeHash: "wrong-order-scope" },
    }), /does not match the authorized order scope/i, "purchase order release must bind to the exact final approval scope");
    await assert.rejects(() => recordPurchaseOrderRelease({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...releaseBase, acknowledgmentDueOn: futureDate(21) },
    }), /cannot be after the authorized need-by date/i, "supplier follow-up cannot be scheduled after the order is already needed");
    await prisma.user.update({ where: { id: secondAdmin.id }, data: { isActive: false } });
    await assert.rejects(() => recordPurchaseOrderRelease({
      context: managerContext,
      actionId: releaseAction.purchaseAction.id,
      input: releaseBase,
    }), /active admin decision/i, "purchase order release must not start from an authorization whose deciding admin is inactive");
    await prisma.user.update({ where: { id: secondAdmin.id }, data: { isActive: true } });
    const concurrentReleases = await Promise.all([
      recordPurchaseOrderRelease({ context: managerContext, actionId: releaseAction.purchaseAction.id, input: releaseBase }),
      recordPurchaseOrderRelease({ context: managerContext, actionId: releaseAction.purchaseAction.id, input: releaseBase }),
    ]);
    const recordedRelease = concurrentReleases[0];
    const releaseRecord = recordedRelease.release as { releaseHash: string; evidenceId: string };
    assert.equal((concurrentReleases[1].release as { releaseHash: string }).releaseHash, releaseRecord.releaseHash, "concurrent release retries must converge on one durable checkpoint");
    assert.equal(recordedRelease.purchaseAction.status, "RUNNING");
    assert.equal(recordedRelease.purchaseDraft.status, "RUNNING");
    assert.equal((recordedRelease.purchaseAction.result as { state: string }).state, "RELEASED");
    assert.equal((await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: releaseRecord.evidenceId } })).kind, "PURCHASE_ORDER_RELEASE");
    const purchaseReleaseEventCount = await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, eventType: "PURCHASE_ORDER_RELEASED" },
    });
    const purchaseReleaseEvidenceCount = await prisma.supplyEvidence.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, kind: "PURCHASE_ORDER_RELEASE" },
    });
    const repeatedRelease = await recordPurchaseOrderRelease({
      context: managerContext,
      actionId: releaseAction.purchaseAction.id,
      input: releaseBase,
    });
    assert.equal((repeatedRelease.release as { releaseHash: string }).releaseHash, releaseRecord.releaseHash);
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, eventType: "PURCHASE_ORDER_RELEASED" },
    }), purchaseReleaseEventCount, "identical order-release retries must not append fake history");
    assert.equal(await prisma.supplyEvidence.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, kind: "PURCHASE_ORDER_RELEASE" },
    }), purchaseReleaseEvidenceCount, "identical order-release retries must not duplicate evidence");
    const restoredReleasedCase = (await listProcurementCases(context)).find((candidate) => candidate.id === returnedCase.id);
    assert.equal(restoredReleasedCase?.purchaseAction?.status, "RUNNING", "the active order release must restore with its purchase action");
    assert.equal((restoredReleasedCase?.result as { purchaseRelease?: { state: string } }).purchaseRelease?.state, "RELEASED", "the sourcing queue must preserve the awaiting-supplier state across reloads");
    await assert.rejects(() => recordPurchaseOrderRelease({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...releaseBase, purchaseOrderReference: "PO-ATLAS-CHANGED" },
    }), /already released/i, "a changed release cannot overwrite the externally issued order");
    const acknowledgmentInput = { ...acknowledgmentBase, expectedReleaseHash: releaseRecord.releaseHash };
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...acknowledgmentInput, acceptedQuantity: 15 },
    }), /cannot exceed the remaining 14 EA/i, "acceptance cannot exceed the immutable order quantity");
    const partialAcknowledgment = await recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: releaseAction.purchaseAction.id,
      input: acknowledgmentInput,
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
      input: acknowledgmentInput,
    });
    assert.equal((repeatedAcknowledgment.purchaseAction.result as { acknowledgments: unknown[] }).acknowledgments.length, 1);
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, eventType: "SUPPLIER_ORDER_PARTIALLY_ACKNOWLEDGED" },
    }), partialEventCount, "identical acknowledgment retries must not append fake history");
    assert.equal(await prisma.supplyEvidence.count({ where: { executionTaskId: releaseAction.purchaseAction.id, kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT" } }), acknowledgmentEvidenceCount, "identical acknowledgments must not duplicate evidence");
    const followUpDraftInput = {
      expectedActionScopeHash: releaseAction.purchaseAction.inputHash,
      expectedReleaseHash: releaseRecord.releaseHash,
      expectedRevision: 0,
      senderAccountId: orderSenderAccount.id,
      recipient: "orders@example.com",
      subject: "Follow-up: purchase order PO-ATLAS-001",
      body: "Please confirm the remaining 8 EA on purchase order PO-ATLAS-001 and provide the supplier order reference and delivery date.",
      note: "Supplier acknowledgment is due for the remaining order quantity.",
    } as const;
    const concurrentFollowUpDrafts = await Promise.all([
      savePurchaseOrderFollowUpDraft({ context, purchaseActionId: releaseAction.purchaseAction.id, input: followUpDraftInput }),
      savePurchaseOrderFollowUpDraft({ context, purchaseActionId: releaseAction.purchaseAction.id, input: followUpDraftInput }),
    ]);
    const followUpDraft = concurrentFollowUpDrafts[0];
    assert.equal(concurrentFollowUpDrafts[1].id, followUpDraft.id, "concurrent identical supplier follow-up drafts must converge");
    assert.equal(followUpDraft.taskType, "PURCHASE_ORDER_FOLLOWUP_EMAIL_DRAFT");
    assert.equal((followUpDraft.result as { followUp: { followUpNumber: number; remainingQuantity: string } }).followUp.followUpNumber, 1);
    assert.equal((followUpDraft.result as { followUp: { remainingQuantity: string } }).followUp.remainingQuantity, "8");
    const followUpApprovalRequest = await requestPurchaseOrderFollowUpApproval({
      context,
      draftId: followUpDraft.id,
      input: { expectedResultHash: followUpDraft.resultHash, reason: "Approve the exact released-order acknowledgment follow-up." },
    });
    const followUpApproved = await decidePurchaseOrderFollowUpApproval({
      context: managerContext,
      approvalId: followUpApprovalRequest.approval.id,
      input: { decision: "APPROVE", note: "The remaining quantity and released order reference match." },
    });
    let markFollowUpProviderStarted!: () => void;
    let releaseFollowUpProvider!: () => void;
    let followUpReconciliationCalls = 0;
    const followUpProviderStarted = new Promise<void>((resolve) => { markFollowUpProviderStarted = resolve; });
    const followUpProviderRelease = new Promise<void>((resolve) => { releaseFollowUpProvider = resolve; });
    const uncertainFollowUpProvider: SupplierEmailProvider = {
      send: async () => {
        markFollowUpProviderStarted();
        await followUpProviderRelease;
        return { state: "UNKNOWN", error: "Simulated timeout after the follow-up request." };
      },
      reconcile: async () => {
        followUpReconciliationCalls += 1;
        return { state: "NOT_FOUND" };
      },
    };
    const pendingUncertainFollowUp = sendPurchaseOrderFollowUpAction({ context, actionId: followUpApproved.action.id, provider: uncertainFollowUpProvider });
    await followUpProviderStarted;
    await assert.rejects(
      () => reconcilePurchaseOrderFollowUpAction({ context, actionId: followUpApproved.action.id, provider: uncertainFollowUpProvider }),
      /still in progress/i,
      "a second tab must not reconcile while the original Gmail call is still active",
    );
    assert.equal(followUpReconciliationCalls, 0, "an in-flight send must not call Gmail reconciliation");
    releaseFollowUpProvider();
    const uncertainFollowUp = await pendingUncertainFollowUp;
    assert.equal((uncertainFollowUp.result as { state: string }).state, "DELIVERY_UNKNOWN");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: {
        ...acknowledgmentInput,
        supplierOrderReference: "ACK-BLOCKED-WHILE-SEND-UNKNOWN",
        acceptedQuantity: 8,
        evidenceUrl: "https://example.com/acknowledgments/blocked-while-send-unknown",
      },
    }), /follow-up delivery is unresolved/i, "supplier response recording must not hide an unresolved outbound follow-up");
    const followUpNotFound = await reconcilePurchaseOrderFollowUpAction({ context, actionId: followUpApproved.action.id, provider: uncertainFollowUpProvider });
    assert.equal((followUpNotFound.result as { state: string }).state, "NOT_FOUND_REVIEW_REQUIRED");
    assert.equal(followUpReconciliationCalls, 1);
    const followUpRetryReady = await resetPurchaseOrderFollowUpForRetry({
      context: managerContext,
      actionId: followUpApproved.action.id,
      input: { confirmedNotSent: true, note: "Verified the stable follow-up Message-ID is absent from the connected Gmail Sent folder." },
    });
    assert.equal((followUpRetryReady.result as { state: string }).state, "RETRY_READY");
    let followUpProviderCalls = 0;
    const sentFollowUpProvider: SupplierEmailProvider = {
      send: async (message) => {
        followUpProviderCalls += 1;
        assert.equal(message.recipient, "orders@example.com");
        return {
          state: "SENT",
          provider: "GMAIL",
          providerMessageId: `gmail-purchase-followup-${suffix}`,
          providerThreadId: `gmail-purchase-followup-thread-${suffix}`,
          sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(message.senderEmail)}/#sent/gmail-purchase-followup-thread-${suffix}`,
        };
      },
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    const sentFollowUp = await sendPurchaseOrderFollowUpAction({ context, actionId: followUpApproved.action.id, provider: sentFollowUpProvider });
    const sentFollowUpResult = sentFollowUp.result as { state: string; evidenceId: string; followUpHash: string; followUpNumber: number };
    assert.equal(sentFollowUpResult.state, "SENT");
    assert.equal(sentFollowUpResult.followUpNumber, 1);
    assert.equal((await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: sentFollowUpResult.evidenceId } })).kind, "PURCHASE_ORDER_FOLLOWUP");
    const followUpRetry = await sendPurchaseOrderFollowUpAction({ context, actionId: followUpApproved.action.id, provider: sentFollowUpProvider });
    assert.equal((followUpRetry.result as { followUpHash: string }).followUpHash, sentFollowUpResult.followUpHash);
    assert.equal(followUpProviderCalls, 1, "a lost follow-up response must not contact the supplier twice");
    const restoredFollowUpCase = (await listProcurementCases(context)).find((candidate) => candidate.id === returnedCase.id);
    assert.equal(restoredFollowUpCase?.purchaseOrderFollowUpAction?.result?.state, "SENT", "the sourcing queue must restore the supplier follow-up receipt");
    assert.equal(restoredFollowUpCase?.result?.purchaseRelease?.followUps?.length, 1, "the released order projection must retain follow-up history");
    const secondFollowUpDraft = await savePurchaseOrderFollowUpDraft({
      context,
      purchaseActionId: releaseAction.purchaseAction.id,
      input: { ...followUpDraftInput, expectedRevision: 0, subject: "Second follow-up: purchase order PO-ATLAS-001" },
    });
    assert.equal((secondFollowUpDraft.result as { followUp: { followUpNumber: number } }).followUp.followUpNumber, 2);
    const secondFollowUpApproval = await requestPurchaseOrderFollowUpApproval({
      context,
      draftId: secondFollowUpDraft.id,
      input: { expectedResultHash: secondFollowUpDraft.resultHash, reason: "Review the second acknowledgment follow-up." },
    });
    await decidePurchaseOrderFollowUpApproval({
      context: managerContext,
      approvalId: secondFollowUpApproval.approval.id,
      input: { decision: "REJECT", note: "The subject needs a clearer escalation request." },
    });
    const revisedSecondFollowUpDraft = await savePurchaseOrderFollowUpDraft({
      context,
      purchaseActionId: releaseAction.purchaseAction.id,
      input: {
        ...followUpDraftInput,
        expectedRevision: (secondFollowUpDraft.result as { revision: number }).revision,
        subject: "Escalation: purchase order PO-ATLAS-001 acknowledgment required",
      },
    });
    assert.notEqual(revisedSecondFollowUpDraft.id, secondFollowUpDraft.id, "a rejected follow-up must reopen as a new draft revision");
    const restoredRevisedFollowUp = (await listProcurementCases(context)).find((candidate) => candidate.id === returnedCase.id);
    assert.equal(restoredRevisedFollowUp?.purchaseOrderFollowUpDraft?.id, revisedSecondFollowUpDraft.id);
    assert.equal(restoredRevisedFollowUp?.purchaseOrderFollowUpAction, null, "a rejected action must not strand the revised follow-up behind the old decision");
    const fullAcknowledgment = await recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: {
        ...acknowledgmentInput,
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
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: revisedSecondFollowUpDraft.id } })).status, "CANCELLED", "a recorded supplier response must cancel an unsent follow-up draft");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: retryQuoteDraft.quoteCycle.id },
      select: { status: true },
    })).status, "SUCCEEDED", "full supplier acknowledgment must close the selected quote cycle");
    const restoredReleaseCase = (await listProcurementCases(context))[0];
    assert.equal(restoredReleaseCase?.purchaseAction?.status, "SUCCEEDED");
    assert.equal(restoredReleaseCase?.quoteCycle, null, "completed quote cycles must leave the active sourcing queue");
    assert.equal((restoredReleaseCase?.result as { purchaseRelease: { state: string } }).purchaseRelease.state, "ACKNOWLEDGED");
    const releaseRetryAfterAcknowledgment = await recordPurchaseOrderRelease({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: releaseBase,
    });
    assert.equal((releaseRetryAfterAcknowledgment.purchaseAction.result as { state: string }).state, "ACKNOWLEDGED", "an exact lost-response retry must preserve later terminal acknowledgment state");
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: releaseAction.purchaseAction.id, eventType: "PURCHASE_ORDER_RELEASED" },
    }), purchaseReleaseEventCount, "a release retry after acknowledgment must not append fake history");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context,
      actionId: releaseAction.purchaseAction.id,
      input: { ...acknowledgmentInput, supplierOrderReference: "ACK-001-C", acceptedQuantity: 1, evidenceUrl: "https://example.com/acknowledgments/part-3" },
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
    }), /purchase order has been released/i, "released supplier scope must remain immutable");
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

    const sourceCaseTask = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: returnedCase.id } });
    const sourceDraftTask = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: releaseDraft.purchaseDraft!.id } });
    const sourceActionTask = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: releaseAction.purchaseAction.id } });
    const clonedCaseInput = JSON.parse(JSON.stringify(sourceCaseTask.input)) as Record<string, unknown>;
    const clonedCase = await prisma.supplyExecutionTask.create({
      data: {
        officeId: context.officeId,
        workspaceId: sourceCaseTask.workspaceId,
        createdByUserId: context.userId,
        taskKey: `procurement:connected-order-email:${suffix}`,
        taskType: "PROCUREMENT_CASE",
        capabilityKey: sourceCaseTask.capabilityKey,
        status: "PLANNED",
        requiresApproval: false,
        input: clonedCaseInput,
        inputHash: jsonDigest(clonedCaseInput),
        result: sourceCaseTask.result ?? undefined,
        resultHash: sourceCaseTask.resultHash,
      },
    });
    const sourceCaseResult = JSON.parse(JSON.stringify(sourceCaseTask.result)) as Record<string, unknown>;
    const sourceApprovalProjection = sourceCaseResult.approval as { id: string; scopeHash: string };
    const sourceProcurementApproval = await prisma.supplyApproval.findUniqueOrThrow({
      where: { id: sourceApprovalProjection.id },
      include: { executionTask: true },
    });
    const clonedProcurementApprovalInput = {
      ...(JSON.parse(JSON.stringify(sourceProcurementApproval.executionTask.input)) as Record<string, unknown>),
      procurementCaseId: clonedCase.id,
    };
    const clonedProcurementApprovalScopeHash = jsonDigest(clonedProcurementApprovalInput);
    const clonedProcurementApprovalTask = await prisma.supplyExecutionTask.create({
      data: {
        officeId: context.officeId,
        workspaceId: sourceCaseTask.workspaceId,
        createdByUserId: context.userId,
        parentTaskId: clonedCase.id,
        taskKey: `procurement-approval:connected-email:${suffix}`,
        taskType: "PROCUREMENT_APPROVAL",
        capabilityKey: "review.procurement_selection",
        status: "PLANNED",
        requiresApproval: true,
        input: clonedProcurementApprovalInput,
        inputHash: clonedProcurementApprovalScopeHash,
        result: { state: "APPROVED" },
        resultHash: jsonDigest({ state: "APPROVED" }),
      },
    });
    const pendingClonedProcurementApproval = await prisma.supplyApproval.create({
      data: {
        officeId: context.officeId,
        workspaceId: sourceCaseTask.workspaceId,
        executionTaskId: clonedProcurementApprovalTask.id,
        requestedByUserId: context.userId,
        status: "PENDING",
        requiredRole: "MANAGER",
        scopeHash: clonedProcurementApprovalScopeHash,
        requestReason: "Connected order fixture supplier award.",
        requestedAt: new Date(),
        idempotencyKey: `procurement-approval-connected-email:${suffix}`,
      },
    });
    const clonedProcurementApproval = await prisma.supplyApproval.update({
      where: { id: pendingClonedProcurementApproval.id },
      data: {
        status: "APPROVED",
        decidedByUserId: managerContext.userId,
        decisionNote: "Supplier award copied into the isolated connected-order fixture.",
        decidedAt: new Date(),
      },
    });
    await prisma.supplyExecutionTask.update({
      where: { id: clonedProcurementApprovalTask.id },
      data: { status: "READY" },
    });
    await prisma.supplyExecutionTask.update({
      where: { id: clonedProcurementApprovalTask.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await prisma.supplyExecutionTask.update({
      where: { id: clonedProcurementApprovalTask.id },
      data: { status: "SUCCEEDED", completedAt: new Date() },
    });
    const clonedDraftInput = {
      ...(JSON.parse(JSON.stringify(sourceDraftTask.input)) as Record<string, unknown>),
      procurementCaseId: clonedCase.id,
      procurementApprovalId: clonedProcurementApproval.id,
      procurementApprovalScopeHash: clonedProcurementApproval.scopeHash,
    };
    const clonedDraft = await prisma.supplyExecutionTask.create({
      data: {
        officeId: context.officeId,
        workspaceId: sourceCaseTask.workspaceId,
        createdByUserId: context.userId,
        parentTaskId: clonedCase.id,
        taskKey: `purchase-order-draft:connected-email:${suffix}`,
        taskType: "PURCHASE_ORDER_DRAFT",
        capabilityKey: "draft.purchase_order",
        status: "PLANNED",
        requiresApproval: false,
        input: clonedDraftInput,
        inputHash: jsonDigest(clonedDraftInput),
        result: sourceDraftTask.result ?? undefined,
        resultHash: sourceDraftTask.resultHash,
      },
    });
    const clonedActionInput = {
      ...(JSON.parse(JSON.stringify(sourceActionTask.input)) as Record<string, unknown>),
      procurementCaseId: clonedCase.id,
      purchaseDraftId: clonedDraft.id,
      purchaseDraftResultHash: clonedDraft.resultHash,
    };
    clonedActionInput.procurementApproval = { id: clonedProcurementApproval.id, scopeHash: clonedProcurementApproval.scopeHash };
    const clonedCommercial = { ...(clonedActionInput.commercial as Record<string, unknown>) };
    delete clonedCommercial.quoteCycleTaskId;
    delete clonedCommercial.quoteResponseHash;
    clonedActionInput.commercial = clonedCommercial;
    const clonedActionScopeHash = jsonDigest(clonedActionInput);
    const clonedAction = await prisma.supplyExecutionTask.create({
      data: {
        officeId: context.officeId,
        workspaceId: sourceCaseTask.workspaceId,
        createdByUserId: context.userId,
        parentTaskId: clonedDraft.id,
        taskKey: `purchase-order-action:connected-email:${suffix}`,
        taskType: "PURCHASE_ORDER_ACTION",
        capabilityKey: "authorize.purchase_order",
        status: "PLANNED",
        requiresApproval: true,
        input: clonedActionInput,
        inputHash: clonedActionScopeHash,
      },
    });
    const clonedActionApproval = await prisma.supplyApproval.create({
      data: {
        officeId: context.officeId,
        workspaceId: sourceCaseTask.workspaceId,
        executionTaskId: clonedAction.id,
        requestedByUserId: context.userId,
        status: "PENDING",
        requiredRole: "ADMIN",
        scopeHash: clonedActionScopeHash,
        requestReason: "Connected order delivery integration fixture.",
        requestedAt: new Date(),
        idempotencyKey: `purchase-order-connected-email:${suffix}`,
      },
    });
    const approvedClonedActionApproval = await prisma.supplyApproval.update({
      where: { id: clonedActionApproval.id },
      data: {
        status: "APPROVED",
        decidedByUserId: secondAdmin.id,
        decidedAt: new Date(),
        decisionNote: "Exact cloned order scope authorized for Gmail delivery verification.",
      },
    });
    const clonedAuthorizedResult = {
      state: "AUTHORIZED",
      approvalId: clonedActionApproval.id,
      scopeHash: clonedActionScopeHash,
      decidedByUserId: secondAdmin.id,
      decidedAt: approvedClonedActionApproval.decidedAt!.toISOString(),
      decisionNote: approvedClonedActionApproval.decisionNote,
      externalSideEffect: false,
    };
    await prisma.supplyExecutionTask.update({ where: { id: clonedDraft.id }, data: { status: "READY" } });
    await prisma.supplyExecutionTask.update({ where: { id: clonedAction.id }, data: { status: "READY", result: clonedAuthorizedResult, resultHash: jsonDigest(clonedAuthorizedResult) } });
    const clonedCaseResult = JSON.parse(JSON.stringify(sourceCaseTask.result)) as Record<string, unknown>;
    clonedCaseResult.approval = {
      id: clonedProcurementApproval.id,
      taskId: clonedProcurementApprovalTask.id,
      scopeHash: clonedProcurementApproval.scopeHash,
      status: "APPROVED",
      requestedAt: clonedProcurementApproval.requestedAt.toISOString(),
      decidedAt: clonedProcurementApproval.decidedAt!.toISOString(),
      decisionNote: clonedProcurementApproval.decisionNote,
    };
    clonedCaseResult.purchasePreparation = { draftTaskId: clonedDraft.id, state: "DRAFT", revision: 1, orderHash: (sourceDraftTask.result as { orderHash: string }).orderHash };
    clonedCaseResult.purchaseAuthorization = { actionTaskId: clonedAction.id, approvalId: approvedClonedActionApproval.id, scopeHash: clonedActionScopeHash, status: "APPROVED", draftTaskId: clonedDraft.id, draftRevision: 1, decidedByUserId: secondAdmin.id, decidedAt: approvedClonedActionApproval.decidedAt!.toISOString(), decisionNote: approvedClonedActionApproval.decisionNote };
    delete clonedCaseResult.purchaseRelease;
    await prisma.supplyExecutionTask.update({ where: { id: clonedCase.id }, data: { result: clonedCaseResult, resultHash: jsonDigest(clonedCaseResult) } });

    const connectedOrderDraftInput = {
      expectedActionScopeHash: clonedActionScopeHash,
      expectedRevision: 0,
      senderAccountId: orderSenderAccount.id,
      recipient: "orders@example.com",
      subject: "Purchase order PO-CONNECTED-001",
      body: "Please accept purchase order PO-CONNECTED-001 and confirm the supplier order reference and delivery date.",
      purchaseOrderReference: "PO-CONNECTED-001",
      acknowledgmentDueOn: futureDate(3),
      note: "Release through the connected buyer mailbox.",
    };
    const connectedOrderDraft = await savePurchaseOrderEmailDraft({
      context,
      purchaseActionId: clonedAction.id,
      input: connectedOrderDraftInput,
    });
    const connectedOrderApproval = await requestPurchaseOrderEmailApproval({
      context,
      draftId: connectedOrderDraft.id,
      input: { expectedResultHash: connectedOrderDraft.resultHash, reason: "Approve exact connected Gmail order release." },
    });
    const connectedOrderApproved = await decidePurchaseOrderEmailApproval({
      context: managerContext,
      approvalId: connectedOrderApproval.approval.id,
      input: { decision: "APPROVE", note: "Exact order email approved." },
    });
    const uncertainOrderProvider: SupplierEmailProvider = {
      send: async () => ({ state: "UNKNOWN", error: "Simulated timeout after Gmail accepted the request." }),
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    const uncertainOrderSend = await sendPurchaseOrderEmailAction({ context, actionId: connectedOrderApproved.action.id, provider: uncertainOrderProvider });
    assert.equal((uncertainOrderSend.result as { state: string }).state, "DELIVERY_UNKNOWN");
    await assert.rejects(() => recordPurchaseOrderRelease({
      context: managerContext,
      actionId: clonedAction.id,
      input: { ...releaseBase, expectedScopeHash: clonedActionScopeHash, purchaseOrderReference: "PO-CONNECTED-001" },
    }), /connected purchase order email is pending, approved, or unresolved/i, "manual release must stay blocked while connected order delivery is uncertain");
    const notFoundOrderSend = await reconcilePurchaseOrderEmailAction({ context, actionId: connectedOrderApproved.action.id, provider: uncertainOrderProvider });
    assert.equal((notFoundOrderSend.result as { state: string }).state, "NOT_FOUND_REVIEW_REQUIRED");
    const retryReadyOrder = await resetPurchaseOrderEmailForRetry({
      context: managerContext,
      actionId: connectedOrderApproved.action.id,
      input: { confirmedNotSent: true, note: "Verified the exact Message-ID is absent from the connected Gmail Sent folder." },
    });
    assert.equal((retryReadyOrder.result as { state: string }).state, "RETRY_READY");
    const sentOrderProvider: SupplierEmailProvider = {
      send: async (message) => ({ state: "SENT", provider: "GMAIL", providerMessageId: `gmail-order-${suffix}`, providerThreadId: `gmail-order-thread-${suffix}`, sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(message.senderEmail)}/#sent/gmail-order-thread-${suffix}` }),
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    const deliveredOrderEmail = await sendPurchaseOrderEmailAction({ context, actionId: connectedOrderApproved.action.id, provider: sentOrderProvider });
    const deliveredOrderResult = deliveredOrderEmail.result as { state: string; evidenceId: string; releaseHash: string; providerMessageId: string; localThreadId: string; sentAt: string; rfcMessageId: string };
    assert.equal(deliveredOrderResult.state, "SENT");
    assert.equal(deliveredOrderResult.providerMessageId, `gmail-order-${suffix}`);
    assert.equal((await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: deliveredOrderResult.evidenceId } })).sourceType, "CONNECTED_PROVIDER");
    const deliveredPurchaseAction = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } });
    assert.equal((deliveredPurchaseAction.result as { state: string }).state, "RELEASED");
    assert.equal((deliveredPurchaseAction.result as { externalSideEffect: string }).externalSideEffect, "CONNECTED_PROVIDER");
    const deliveredOrderRetry = await sendPurchaseOrderEmailAction({ context, actionId: connectedOrderApproved.action.id, provider: uncertainOrderProvider });
    assert.equal((deliveredOrderRetry.result as { providerMessageId: string }).providerMessageId, `gmail-order-${suffix}`, "a lost client response must not send the purchase order twice");
    const restoredConnectedOrderCase = (await listProcurementCases(context)).find((entry) => entry.id === clonedCase.id);
    assert.equal(restoredConnectedOrderCase?.purchaseOrderEmailAction?.status, "SUCCEEDED", "the queue must restore the connected order delivery receipt");
    assert.equal((restoredConnectedOrderCase?.result as { purchaseRelease: { state: string } }).purchaseRelease.state, "RELEASED");
    assert.equal((await findProcurementCaseByRelatedTaskId(context, connectedOrderApproved.action.id))?.id, clonedCase.id, "purchase order email actions must restore their exact procurement workstream");

    const connectedOrderReply = await prisma.emailMessage.create({
      data: {
        threadId: deliveredOrderResult.localThreadId,
        accountId: orderSenderAccount.id,
        externalId: `<supplier-order-reply-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-order-reply-${suffix}`,
        direction: "INBOUND",
        fromEmail: "orders@example.com",
        fromName: "Example supplier order desk",
        toEmails: JSON.stringify([orderSenderAccount.email]),
        subject: "Re: Purchase order PO-CONNECTED-001",
        bodyText: "We accept PO-CONNECTED-001. Supplier order SO-CONNECTED-001 is scheduled for the confirmed delivery date below.",
        attachments: JSON.stringify([{ filename: "SO-CONNECTED-001.pdf", mimeType: "application/pdf", size: 4096 }]),
        sentAt: new Date(new Date(deliveredOrderResult.sentAt).getTime() + 60_000),
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: deliveredOrderResult.localThreadId,
        accountId: otherSenderAccount.id,
        externalId: `<supplier-order-wrong-account-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-order-wrong-account-${suffix}`,
        direction: "INBOUND",
        fromEmail: "orders@example.com",
        toEmails: JSON.stringify([otherSenderAccount.email]),
        subject: "Order reply on the wrong buyer account",
        bodyText: "This must not become acknowledgment evidence.",
        sentAt: new Date(),
      },
    });
    const unrelatedOrderThread = await prisma.emailThread.create({
      data: {
        officeId: context.officeId,
        subject: "A different purchase order thread",
        participants: JSON.stringify([orderSenderAccount.email, "orders@example.com"]),
        externalThreadId: `gmail-unrelated-order-thread-${suffix}`,
        lastMessageAt: new Date(),
        messageCount: 1,
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: unrelatedOrderThread.id,
        accountId: orderSenderAccount.id,
        externalId: `<supplier-order-wrong-thread-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-order-wrong-thread-${suffix}`,
        direction: "INBOUND",
        fromEmail: "orders@example.com",
        toEmails: JSON.stringify([orderSenderAccount.email]),
        subject: "Exact supplier on a different order thread",
        bodyText: "This must not become acknowledgment evidence for PO-CONNECTED-001.",
        sentAt: new Date(),
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: deliveredOrderResult.localThreadId,
        accountId: orderSenderAccount.id,
        externalId: `<supplier-order-pre-send-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-order-pre-send-${suffix}`,
        direction: "INBOUND",
        fromEmail: "orders@example.com",
        toEmails: JSON.stringify([orderSenderAccount.email]),
        subject: "Order message predating release",
        bodyText: "This older message must not become acknowledgment evidence.",
        sentAt: new Date(new Date(deliveredOrderResult.sentAt).getTime() - 60_000),
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: deliveredOrderResult.localThreadId,
        accountId: orderSenderAccount.id,
        externalId: `<supplier-order-unrelated-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-order-unrelated-${suffix}`,
        direction: "INBOUND",
        fromEmail: "unrelated@example.com",
        toEmails: JSON.stringify([orderSenderAccount.email]),
        subject: "Unrelated order-thread participant",
        bodyText: "This message must not become acknowledgment evidence.",
        sentAt: new Date(),
      },
    });
    const orderReplySync = async (input: { accountId: string; officeId: string; query: string }) => {
      assert.equal(input.accountId, orderSenderAccount.id);
      assert.equal(input.officeId, context.officeId);
      assert.equal(input.query, `rfc822msgid:${deliveredOrderResult.rfcMessageId}`, "order reply sync must target only the stable purchase order message ID");
      return { ok: true as const, processed: 1, created: 1, threadsTouched: 1 };
    };
    await assert.rejects(() => captureConnectedPurchaseOrderReplies({
      context,
      purchaseActionId: clonedAction.id,
      sync: async () => ({ ok: true, processed: 0, created: 0, threadsTouched: 0 }),
    }), /did not return the delivered purchase order thread/i, "a silent Gmail order-thread miss must not look successful");
    await assert.rejects(() => captureConnectedPurchaseOrderReplies({
      context,
      purchaseActionId: clonedAction.id,
      sync: async () => ({ error: "Simulated Gmail provider failure." }),
    }), /connected Gmail sync failed/i, "a Gmail provider failure must not mutate acknowledgment state");
    const concurrentOrderReplyCaptures = await Promise.all([
      captureConnectedPurchaseOrderReplies({ context, purchaseActionId: clonedAction.id, sync: orderReplySync }),
      captureConnectedPurchaseOrderReplies({ context, purchaseActionId: clonedAction.id, sync: orderReplySync }),
    ]);
    assert.equal(concurrentOrderReplyCaptures.reduce((sum, result) => sum + result.captured, 0), 1, "concurrent order inbox checks must capture one exact reply once");
    const orderReplyEvidence = await prisma.supplyEvidence.findFirstOrThrow({ where: { executionTaskId: clonedAction.id, kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT_REPLY_EMAIL" } });
    assert.equal(orderReplyEvidence.sourceType, "CONNECTED_PROVIDER");
    assert.equal(orderReplyEvidence.sourceRecordId, connectedOrderReply.gmailMessageId);
    const orderReplyEventCount = await prisma.supplyExecutionEvent.count({ where: { executionTaskId: clonedAction.id, eventType: "SUPPLIER_ORDER_REPLIES_CAPTURED" } });
    const repeatedOrderReplyCapture = await captureConnectedPurchaseOrderReplies({ context, purchaseActionId: clonedAction.id, sync: orderReplySync });
    assert.equal(repeatedOrderReplyCapture.captured, 0);
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: clonedAction.id, eventType: "SUPPLIER_ORDER_REPLIES_CAPTURED" } }), orderReplyEventCount, "repeat inbox checks must not append fake order-reply history");
    const openConnectedAction = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } });
    assert.equal((openConnectedAction.result as { state: string }).state, "RELEASED", "capturing a reply must not infer structured supplier acceptance");
    const connectedAcknowledgment = await recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        acknowledgedOn: connectedOrderReply.sentAt.toISOString().slice(0, 10),
        supplierOrderReference: "SO-CONNECTED-001",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: null,
        connectedReplyEvidenceId: orderReplyEvidence.id,
        note: "Operator confirmed the structured terms against the attached supplier order confirmation.",
      },
    });
    assert.equal((connectedAcknowledgment.purchaseAction.result as { state: string }).state, "PARTIALLY_ACKNOWLEDGED");
    const connectedAcknowledgmentRecord = connectedAcknowledgment.acknowledgment as { evidenceId: string; sourceEvidenceId: string };
    assert.equal(connectedAcknowledgmentRecord.sourceEvidenceId, orderReplyEvidence.id);
    const finalConnectedAcknowledgmentEvidence = await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: connectedAcknowledgmentRecord.evidenceId } });
    assert.equal(finalConnectedAcknowledgmentEvidence.sourceType, "CONNECTED_PROVIDER", "reviewed acknowledgment must retain connected-provider lineage");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        acknowledgedOn: connectedOrderReply.sentAt.toISOString().slice(0, 10),
        supplierOrderReference: "SO-WRONG-EVIDENCE",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: null,
        connectedReplyEvidenceId: storedQuoteResponse.evidenceId,
      },
    }), /connected supplier reply evidence no longer matches/i, "quote evidence must not be reused as purchase order acknowledgment evidence");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        acknowledgedOn: connectedOrderReply.sentAt.toISOString().slice(0, 10),
        supplierOrderReference: "SO-CONNECTED-001-REUSED",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: null,
        connectedReplyEvidenceId: orderReplyEvidence.id,
      },
    }), /already used for an acknowledgment/i, "one connected reply must not be counted twice toward accepted quantity");
    const restoredPartialConnectedCase = (await listProcurementCases(context)).find((entry) => entry.id === clonedCase.id);
    assert.equal(restoredPartialConnectedCase?.purchaseAction?.result?.state, "PARTIALLY_ACKNOWLEDGED");
    assert.equal(restoredPartialConnectedCase?.purchaseAction?.result && "connectedAcknowledgmentReplies" in restoredPartialConnectedCase.purchaseAction.result
      ? restoredPartialConnectedCase.purchaseAction.result.connectedAcknowledgmentReplies?.length
      : 0, 1, "the queue must restore captured order replies after partial acknowledgment");
    assert.equal(restoredPartialConnectedCase?.result?.purchaseRelease?.unreviewedConnectedReplyCount, 0, "a used reply must not keep the queue stuck on review");

    const changedTermsReply = await prisma.emailMessage.create({
      data: {
        threadId: deliveredOrderResult.localThreadId,
        accountId: orderSenderAccount.id,
        externalId: `<supplier-order-exception-${suffix}@example.com>`,
        gmailMessageId: `gmail-supplier-order-exception-${suffix}`,
        direction: "INBOUND",
        fromEmail: "orders@example.com",
        fromName: "Example supplier order desk",
        toEmails: JSON.stringify([orderSenderAccount.email]),
        subject: "Re: Purchase order PO-CONNECTED-001 delivery change",
        bodyText: "We can supply the remaining quantity, but delivery must move to the revised date below.",
        attachments: JSON.stringify([]),
        sentAt: new Date(new Date(deliveredOrderResult.sentAt).getTime() + 120_000),
      },
    });
    const changedTermsCapture = await captureConnectedPurchaseOrderReplies({ context, purchaseActionId: clonedAction.id, sync: orderReplySync });
    assert.equal(changedTermsCapture.captured, 1, "a later exact-thread supplier reply must enter review without changing the order");
    const changedTermsEvidence = await prisma.supplyEvidence.findFirstOrThrow({
      where: { executionTaskId: clonedAction.id, kind: "SUPPLIER_ORDER_ACKNOWLEDGMENT_REPLY_EMAIL", sourceRecordId: changedTermsReply.gmailMessageId },
    });
    const changedDeliveryDate = futureDate(35);
    const connectedExceptionInput = {
      expectedReleaseHash: deliveredOrderResult.releaseHash,
      category: "DELIVERY_CHANGE",
      observedOn: changedTermsReply.sentAt.toISOString().slice(0, 10),
      summary: "Supplier moved delivery for the remaining authorized quantity.",
      proposedDeliveryDate: changedDeliveryDate,
      evidenceUrl: null,
      connectedReplyEvidenceId: changedTermsEvidence.id,
      note: "Operator recorded the supplier's changed delivery date for review.",
    };
    const concurrentExceptions = await Promise.all([
      recordSupplierOrderException({ context: managerContext, actionId: clonedAction.id, input: connectedExceptionInput }),
      recordSupplierOrderException({ context: managerContext, actionId: clonedAction.id, input: connectedExceptionInput }),
    ]);
    const connectedException = concurrentExceptions[0].exception as { exceptionHash: string; evidenceId: string; status: string; sourceEvidenceId: string };
    assert.equal(concurrentExceptions[1].exception.exceptionHash, connectedException.exceptionHash, "identical concurrent exception records must converge");
    assert.equal(connectedException.status, "OPEN_REVIEW");
    assert.equal(connectedException.sourceEvidenceId, changedTermsEvidence.id);
    assert.equal((await prisma.supplyEvidence.findUniqueOrThrow({ where: { id: connectedException.evidenceId } })).sourceType, "CONNECTED_PROVIDER");
    assert.equal(await prisma.supplyEvidence.count({ where: { executionTaskId: clonedAction.id, kind: "SUPPLIER_ORDER_EXCEPTION", contentHash: connectedException.exceptionHash } }), 1, "concurrent exception records must create one evidence object");
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: clonedAction.id, eventType: "SUPPLIER_ORDER_EXCEPTION_RECORDED" } }), 1, "concurrent exception records must append one action event");
    const actionWithOpenException = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } });
    const openExceptionResult = actionWithOpenException.result as { openSupplierExceptionCount: number; connectedAcknowledgmentReplies: Array<{ evidenceId: string; reviewState: string }> };
    assert.equal(openExceptionResult.openSupplierExceptionCount, 1);
    assert.equal(openExceptionResult.connectedAcknowledgmentReplies.find((reply) => reply.evidenceId === changedTermsEvidence.id)?.reviewState, "USED_AS_ORDER_EXCEPTION");
    await recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        acknowledgedOn: new Date().toISOString().slice(0, 10),
        supplierOrderReference: "SO-BLOCKED-BY-EXCEPTION",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: "https://example.com/blocked-acceptance",
      },
    }).then(
      () => assert.fail("open changed terms must block normal supplier acknowledgment"),
      (error: unknown) => assert.match(error instanceof Error ? error.message : String(error), /resolve the supplier order exception/i),
    );
    const keptOriginal = await resolveSupplierOrderException({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        exceptionHash: connectedException.exceptionHash,
        disposition: "KEEP_ORIGINAL",
        note: "Supplier confirmed the original delivery date remains authoritative.",
      },
    });
    assert.equal(keptOriginal.exception.status, "RESOLVED_KEEP_ORIGINAL");
    const resolutionEventCount = await prisma.supplyExecutionEvent.count({ where: { executionTaskId: clonedAction.id, eventType: "SUPPLIER_ORDER_EXCEPTION_RESOLVED" } });
    await resolveSupplierOrderException({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        exceptionHash: connectedException.exceptionHash,
        disposition: "KEEP_ORIGINAL",
        note: "Supplier confirmed the original delivery date remains authoritative.",
      },
    });
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: clonedAction.id, eventType: "SUPPLIER_ORDER_EXCEPTION_RESOLVED" } }), resolutionEventCount, "an identical resolution retry must not append fake history");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        acknowledgedOn: changedTermsReply.sentAt.toISOString().slice(0, 10),
        supplierOrderReference: "SO-EXCEPTION-EVIDENCE-REUSED",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: null,
        connectedReplyEvidenceId: changedTermsEvidence.id,
      },
    }), /no longer matches this released order/i, "a reply used for an exception must never be reused as acknowledgment evidence");

    const termsException = await recordSupplierOrderException({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        category: "TERMS_CHANGE",
        observedOn: new Date().toISOString().slice(0, 10),
        summary: "Supplier requested payment before shipment instead of the authorized terms.",
        proposedPaymentTerms: "Prepaid before shipment",
        evidenceUrl: "https://example.com/supplier-order-terms-change",
        note: "Commercial change requires a new exact-scope decision.",
      },
    });
    await assert.rejects(() => resolveSupplierOrderException({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        exceptionHash: termsException.exception.exceptionHash,
        disposition: "REQUIRE_REAUTHORIZATION",
        note: "Changed payment terms require a replacement authorization.",
      },
    }), /only an admin/i, "a manager must not invalidate an admin-authorized purchase scope");
    const reauthorizationRequired = await resolveSupplierOrderException({
      context,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        exceptionHash: termsException.exception.exceptionHash,
        disposition: "REQUIRE_REAUTHORIZATION",
        note: "Changed payment terms require a replacement authorization.",
      },
    });
    assert.equal(reauthorizationRequired.exception.status, "REVISION_REQUIRED");
    const caseWithRevisionRequired = (await listProcurementCases(context)).find((entry) => entry.id === clonedCase.id);
    assert.equal(caseWithRevisionRequired?.result?.purchaseRelease?.revisionRequiredCount, 1, "the sourcing queue must restore the required reauthorization checkpoint");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        acknowledgedOn: new Date().toISOString().slice(0, 10),
        supplierOrderReference: "SO-BLOCKED-BY-REVISION",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: "https://example.com/revision-blocked-acceptance",
      },
    }), /resolve the supplier order exception/i, "an order awaiting reauthorization must not accept supplier terms against the obsolete scope");

    const authorizedOrder = clonedActionInput.order as {
      quantity: string;
      needBy: string;
      shipTo: string;
      incoterm: string;
      paymentTerms: string;
      buyerReference: string | null;
      notes: string | null;
    };
    const authorizedCommercial = clonedActionInput.commercial as {
      unitPrice: string;
      currency: string;
      minimumOrderQuantity: string;
      deliveryDate: string;
    };
    const revisedDraftInput = {
      expectedReleaseHash: deliveredOrderResult.releaseHash,
      exceptionHash: termsException.exception.exceptionHash,
      expectedRevision: 0,
      quantity: Number(authorizedOrder.quantity),
      needBy: authorizedOrder.needBy,
      shipTo: authorizedOrder.shipTo,
      incoterm: authorizedOrder.incoterm,
      paymentTerms: "Prepaid before shipment",
      buyerReference: "PO-CONNECTED-001-R1",
      notes: "Supersedes the released order after supplier terms changed.",
      unitPrice: Number(authorizedCommercial.unitPrice),
      currency: authorizedCommercial.currency,
      minimumOrderQuantity: Number(authorizedCommercial.minimumOrderQuantity),
      deliveryDate: authorizedCommercial.deliveryDate,
      quoteReference: "SUPPLIER-REVISION-001",
      quoteValidUntil: futureDate(14),
    };
    await assert.rejects(() => prepareRevisedPurchaseOrder({
      context,
      actionId: clonedAction.id,
      input: { ...revisedDraftInput, paymentTerms: "Net 60" },
    }), /must match the supplier exception/i, "a replacement draft must not invent supplier-controlled terms");
    const concurrentRevisedDrafts = await Promise.all([
      prepareRevisedPurchaseOrder({ context, actionId: clonedAction.id, input: revisedDraftInput }),
      prepareRevisedPurchaseOrder({ context, actionId: clonedAction.id, input: revisedDraftInput }),
    ]);
    const revisedDraft = concurrentRevisedDrafts[0].purchaseDraft;
    assert.ok(revisedDraft?.resultHash);
    assert.equal(concurrentRevisedDrafts[1].purchaseDraft?.id, revisedDraft?.id, "concurrent replacement preparation must converge on one draft");
    assert.equal((revisedDraft?.result as { revisionContext: { replacesPurchaseActionId: string; supplierExceptionHash: string } }).revisionContext.replacesPurchaseActionId, clonedAction.id);
    assert.equal((revisedDraft?.result as { revisionContext: { supplierExceptionHash: string } }).revisionContext.supplierExceptionHash, termsException.exception.exceptionHash);
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: clonedCase.id, eventType: "REVISED_PURCHASE_DRAFT_CREATED" } }), 1, "identical replacement retries must not append fake history");
    const oldActionWhileDrafting = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } });
    assert.equal(oldActionWhileDrafting.status, "RUNNING", "preparing a replacement must not supersede the released order before approval");
    assert.equal((oldActionWhileDrafting.result as { release: { releaseHash: string } }).release.releaseHash, deliveredOrderResult.releaseHash, "replacement preparation must preserve the old release evidence");

    const cloneRevisionDraftFixture = async (label: string, targetDate: string, qualificationValidUntil?: string) => {
      const templateCase = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedCase.id } });
      const templateReleasedDraft = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedDraft.id } });
      const templateReleasedAction = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } });
      const templateRevisionDraft = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: revisedDraft!.id } });
      const templateRevisionResult = JSON.parse(JSON.stringify(templateRevisionDraft.result)) as Record<string, unknown>;
      const templateRevisionContext = templateRevisionResult.revisionContext as Record<string, unknown>;
      const templateEvidence = await prisma.supplyEvidence.findUniqueOrThrow({
        where: { id: String(templateRevisionContext.supplierExceptionEvidenceId) },
      });
      const templateProcurementApproval = await prisma.supplyApproval.findUniqueOrThrow({
        where: { id: clonedProcurementApproval.id },
        include: { executionTask: true },
      });

      const fixtureCase = await prisma.supplyExecutionTask.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          createdByUserId: context.userId,
          taskKey: `procurement:stale-revision:${label}:${suffix}`,
          taskType: "PROCUREMENT_CASE",
          capabilityKey: templateCase.capabilityKey,
          status: "PLANNED",
          requiresApproval: false,
          input: templateCase.input,
          inputHash: templateCase.inputHash,
        },
      });
      const templateProcurementApprovalInput = JSON.parse(JSON.stringify(templateProcurementApproval.executionTask!.input)) as {
        qualityPlan: Record<string, unknown>;
        sourceEvidenceReview: Record<string, unknown>;
        [key: string]: unknown;
      };
      const procurementApprovalInput = {
        ...templateProcurementApprovalInput,
        procurementCaseId: fixtureCase.id,
        qualityPlan: {
          ...templateProcurementApprovalInput.qualityPlan,
          targetDate,
        },
        sourceEvidenceReview: {
          ...templateProcurementApprovalInput.sourceEvidenceReview,
          validUntil: qualificationValidUntil ?? templateProcurementApprovalInput.sourceEvidenceReview.validUntil,
        },
      };
      const procurementApprovalScopeHash = jsonDigest(procurementApprovalInput);
      const fixtureProcurementApprovalTask = await prisma.supplyExecutionTask.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          createdByUserId: context.userId,
          parentTaskId: fixtureCase.id,
          taskKey: `procurement-approval:stale-revision:${label}:${suffix}`,
          taskType: "PROCUREMENT_APPROVAL",
          capabilityKey: "review.procurement_selection",
          status: "PLANNED",
          requiresApproval: true,
          input: procurementApprovalInput,
          inputHash: procurementApprovalScopeHash,
          result: { state: "APPROVED" },
          resultHash: jsonDigest({ state: "APPROVED" }),
        },
      });
      const pendingFixtureProcurementApproval = await prisma.supplyApproval.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          executionTaskId: fixtureProcurementApprovalTask.id,
          requestedByUserId: context.userId,
          status: "PENDING",
          requiredRole: "MANAGER",
          scopeHash: procurementApprovalScopeHash,
          requestReason: "Stale revised-order recovery fixture.",
          idempotencyKey: `procurement-approval-stale-revision:${label}:${suffix}`,
          requestedAt: new Date(),
        },
      });
      const fixtureProcurementApproval = await prisma.supplyApproval.update({
        where: { id: pendingFixtureProcurementApproval.id },
        data: {
          status: "APPROVED",
          decidedByUserId: managerContext.userId,
          decisionNote: "The original sourcing scope was approved before its freshness gate elapsed.",
          decidedAt: new Date(),
        },
      });
      await prisma.supplyExecutionTask.update({ where: { id: fixtureProcurementApprovalTask.id }, data: { status: "READY" } });
      await prisma.supplyExecutionTask.update({ where: { id: fixtureProcurementApprovalTask.id }, data: { status: "RUNNING", startedAt: new Date() } });
      await prisma.supplyExecutionTask.update({ where: { id: fixtureProcurementApprovalTask.id }, data: { status: "SUCCEEDED", completedAt: new Date() } });
      const fixtureReleasedDraft = await prisma.supplyExecutionTask.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          createdByUserId: context.userId,
          parentTaskId: fixtureCase.id,
          taskKey: `purchase-order-draft:stale-revision:${label}:${suffix}`,
          taskType: "PURCHASE_ORDER_DRAFT",
          capabilityKey: "draft.purchase_order",
          status: "PLANNED",
          requiresApproval: false,
          input: templateReleasedDraft.input,
          inputHash: templateReleasedDraft.inputHash,
          result: templateReleasedDraft.result ?? undefined,
          resultHash: templateReleasedDraft.resultHash,
        },
      });
      await prisma.supplyExecutionTask.update({ where: { id: fixtureReleasedDraft.id }, data: { status: "READY" } });
      await prisma.supplyExecutionTask.update({ where: { id: fixtureReleasedDraft.id }, data: { status: "RUNNING", startedAt: new Date() } });
      const fixtureReleasedAction = await prisma.supplyExecutionTask.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          createdByUserId: context.userId,
          parentTaskId: fixtureReleasedDraft.id,
          taskKey: `purchase-order-action:stale-revision:${label}:${suffix}`,
          taskType: "PURCHASE_ORDER_ACTION",
          capabilityKey: "authorize.purchase_order",
          status: "PLANNED",
          requiresApproval: true,
          input: templateReleasedAction.input,
          inputHash: templateReleasedAction.inputHash,
        },
      });
      const pendingFixtureActionApproval = await prisma.supplyApproval.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          executionTaskId: fixtureReleasedAction.id,
          requestedByUserId: context.userId,
          status: "PENDING",
          requiredRole: "ADMIN",
          scopeHash: fixtureReleasedAction.inputHash,
          requestReason: "Stale revised-order released-action fixture.",
          requestedAt: new Date(),
          idempotencyKey: `purchase-action-stale-revision:${label}:${suffix}`,
        },
      });
      await prisma.supplyApproval.update({
        where: { id: pendingFixtureActionApproval.id },
        data: {
          status: "APPROVED",
          decidedByUserId: secondAdminContext.userId,
          decisionNote: "Fixture order was authorized before release.",
          decidedAt: new Date(),
        },
      });
      await prisma.supplyExecutionTask.update({ where: { id: fixtureReleasedAction.id }, data: { status: "READY" } });
      await prisma.supplyExecutionTask.update({ where: { id: fixtureReleasedAction.id }, data: { status: "RUNNING", startedAt: new Date() } });
      const fixtureEvidence = await prisma.supplyEvidence.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          executionTaskId: fixtureReleasedAction.id,
          createdByUserId: context.userId,
          evidenceKey: `supplier-order-exception:stale-revision:${label}:${suffix}`,
          kind: templateEvidence.kind,
          sourceType: templateEvidence.sourceType,
          sourceUri: templateEvidence.sourceUri,
          sourceRecordId: templateEvidence.sourceRecordId,
          sourceVersion: templateEvidence.sourceVersion,
          title: templateEvidence.title,
          excerpt: templateEvidence.excerpt,
          payload: templateEvidence.payload ?? undefined,
          contentHash: templateEvidence.contentHash,
          confidence: templateEvidence.confidence,
          observedAt: templateEvidence.observedAt,
          capturedAt: templateEvidence.capturedAt,
        },
      });
      const commercial = {
        ...(templateRevisionResult.commercial as Record<string, unknown>),
        quoteEvidenceId: fixtureEvidence.id,
      };
      const replacementScopeHash = jsonDigest({ order: templateRevisionResult.order, commercial });
      const revisionContext = {
        ...templateRevisionContext,
        replacesPurchaseActionId: fixtureReleasedAction.id,
        replacesPurchaseDraftId: fixtureReleasedDraft.id,
        supplierExceptionEvidenceId: fixtureEvidence.id,
        replacementScopeHash,
      };
      const fixtureRevisionResult = {
        ...templateRevisionResult,
        commercial,
        approvedProcurementScope: { approvalId: fixtureProcurementApproval.id, scopeHash: fixtureProcurementApproval.scopeHash },
        revisionContext,
      };
      const fixtureRevisionInput = {
        procurementCaseId: fixtureCase.id,
        procurementApprovalId: fixtureProcurementApproval.id,
        procurementApprovalScopeHash: fixtureProcurementApproval.scopeHash,
        revisionContext,
      };
      const fixtureRevisionDraft = await prisma.supplyExecutionTask.create({
        data: {
          officeId: context.officeId,
          workspaceId: templateCase.workspaceId,
          createdByUserId: context.userId,
          parentTaskId: fixtureCase.id,
          taskKey: `purchase-revision:stale-revision:${label}:${suffix}`,
          taskType: "PURCHASE_ORDER_DRAFT",
          capabilityKey: "draft.purchase_order",
          status: "PLANNED",
          requiresApproval: false,
          input: fixtureRevisionInput,
          inputHash: jsonDigest(fixtureRevisionInput),
          result: fixtureRevisionResult,
          resultHash: jsonDigest(fixtureRevisionResult),
        },
      });
      const fixtureReleasedResult = JSON.parse(JSON.stringify(templateReleasedAction.result)) as {
        supplierOrderExceptions: Array<Record<string, unknown>>;
        [key: string]: unknown;
      };
      fixtureReleasedResult.supplierOrderExceptions = fixtureReleasedResult.supplierOrderExceptions.map((entry) => entry.exceptionHash === termsException.exception.exceptionHash ? {
        ...entry,
        evidenceId: fixtureEvidence.id,
        status: "REVISION_DRAFTED",
        replacementDraft: {
          ...((entry.replacementDraft as Record<string, unknown>) ?? {}),
          taskId: fixtureRevisionDraft.id,
          replacementScopeHash,
        },
      } : entry);
      await prisma.supplyExecutionTask.update({
        where: { id: fixtureReleasedAction.id },
        data: { result: fixtureReleasedResult, resultHash: jsonDigest(fixtureReleasedResult) },
      });
      const fixtureCaseResult = JSON.parse(JSON.stringify(templateCase.result)) as Record<string, unknown>;
      fixtureCaseResult.approval = {
        id: fixtureProcurementApproval.id,
        taskId: fixtureProcurementApprovalTask.id,
        scopeHash: fixtureProcurementApproval.scopeHash,
        status: "APPROVED",
        requestedAt: fixtureProcurementApproval.requestedAt.toISOString(),
        decidedAt: fixtureProcurementApproval.decidedAt!.toISOString(),
        decisionNote: fixtureProcurementApproval.decisionNote,
      };
      fixtureCaseResult.purchasePreparation = {
        draftTaskId: fixtureRevisionDraft.id,
        state: "DRAFT",
        revision: templateRevisionResult.revision,
        orderHash: templateRevisionResult.orderHash,
      };
      fixtureCaseResult.purchaseRevision = {
        state: "DRAFT",
        replacesPurchaseActionId: fixtureReleasedAction.id,
        supersededReleaseHash: revisionContext.supersededReleaseHash,
        supplierExceptionHash: revisionContext.supplierExceptionHash,
        supplierExceptionEvidenceId: fixtureEvidence.id,
        replacementDraftTaskId: fixtureRevisionDraft.id,
        replacementDraftRevision: templateRevisionResult.revision,
        replacementScopeHash,
        updatedAt: new Date().toISOString(),
      };
      delete fixtureCaseResult.purchaseAuthorization;
      delete fixtureCaseResult.sourcingReturn;
      await prisma.supplyExecutionTask.update({
        where: { id: fixtureCase.id },
        data: { result: fixtureCaseResult, resultHash: jsonDigest(fixtureCaseResult) },
      });
      return {
        procurementCase: fixtureCase,
        releasedDraft: fixtureReleasedDraft,
        releasedAction: fixtureReleasedAction,
        replacementDraft: fixtureRevisionDraft,
        revisionContext,
      };
    };

    const staleRequestFixture = await cloneRevisionDraftFixture("request", futureDate(-1));
    const staleRequestResult = await requestPurchaseActionApproval({
      context,
      caseId: staleRequestFixture.procurementCase.id,
      input: {
        expectedDraftTaskId: staleRequestFixture.replacementDraft.id,
        expectedDraftResultHash: staleRequestFixture.replacementDraft.resultHash!,
        expectedDraftRevision: 1,
        reason: "This request must return to sourcing because its quality plan is stale.",
      },
    });
    assert.equal(staleRequestResult.stale, true);
    assert.equal(staleRequestResult.purchaseDraft, null);
    assert.equal((staleRequestResult.procurementCase.result as { sourcingReturn: { reasonCode: string }; purchaseRevision: { state: string; staleGate: string } }).sourcingReturn.reasonCode, "QUALITY_PLAN_EXPIRED");
    assert.equal((staleRequestResult.procurementCase.result as { purchaseRevision: { state: string } }).purchaseRevision.state, "RETURNED_TO_SOURCING");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleRequestFixture.releasedAction.id } })).status, "RUNNING", "stale replacement recovery must preserve the supplier-facing order");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleRequestFixture.replacementDraft.id } })).status, "CANCELLED", "stale replacement recovery must cancel the unusable replacement draft");

    const staleSourceFixture = await cloneRevisionDraftFixture("source-request", qualityTargetDate, futureDate(-1));
    const staleSourceResult = await requestPurchaseActionApproval({
      context,
      caseId: staleSourceFixture.procurementCase.id,
      input: {
        expectedDraftTaskId: staleSourceFixture.replacementDraft.id,
        expectedDraftResultHash: staleSourceFixture.replacementDraft.resultHash!,
        expectedDraftRevision: 1,
        reason: "This request must return to sourcing because supplier qualification expired.",
      },
    });
    assert.equal(staleSourceResult.stale, true);
    assert.equal((staleSourceResult.procurementCase.result as { sourcingReturn: { reasonCode: string } }).sourcingReturn.reasonCode, "SOURCE_EVIDENCE_EXPIRED");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleSourceFixture.releasedAction.id } })).status, "RUNNING");

    const staleDecisionFixture = await cloneRevisionDraftFixture("decision", qualityTargetDate);
    const staleDecisionRequest = await requestPurchaseActionApproval({
      context,
      caseId: staleDecisionFixture.procurementCase.id,
      input: {
        expectedDraftTaskId: staleDecisionFixture.replacementDraft.id,
        expectedDraftResultHash: staleDecisionFixture.replacementDraft.resultHash!,
        expectedDraftRevision: 1,
        reason: "Prepare a pending replacement action for stale-scope cancellation coverage.",
      },
    });
    const staleEmailDraftInput = { purchaseActionId: staleDecisionRequest.purchaseAction!.id, fixture: "stale-retry" };
    const staleEmailDraft = await prisma.supplyExecutionTask.create({
      data: {
        officeId: context.officeId,
        workspaceId: staleDecisionFixture.procurementCase.workspaceId,
        createdByUserId: context.userId,
        parentTaskId: staleDecisionFixture.replacementDraft.id,
        taskKey: `purchase-order-email-draft:stale-revision:${suffix}`,
        taskType: "PURCHASE_ORDER_EMAIL_DRAFT",
        capabilityKey: "contact.supplier_purchase_order_email",
        status: "PLANNED",
        requiresApproval: false,
        input: staleEmailDraftInput,
        inputHash: jsonDigest(staleEmailDraftInput),
      },
    });
    await prisma.supplyExecutionTask.update({ where: { id: staleEmailDraft.id }, data: { status: "READY" } });
    await prisma.supplyExecutionTask.update({ where: { id: staleEmailDraft.id }, data: { status: "RUNNING", startedAt: new Date() } });
    const staleEmailActionInput = { purchaseActionId: staleDecisionRequest.purchaseAction!.id, draftId: staleEmailDraft.id, fixture: "stale-retry" };
    const staleEmailAction = await prisma.supplyExecutionTask.create({
      data: {
        officeId: context.officeId,
        workspaceId: staleDecisionFixture.procurementCase.workspaceId,
        createdByUserId: context.userId,
        parentTaskId: staleDecisionFixture.replacementDraft.id,
        taskKey: `purchase-order-email-action:stale-revision:${suffix}`,
        taskType: "PURCHASE_ORDER_EMAIL_ACTION",
        capabilityKey: "contact.supplier_purchase_order_email",
        status: "PLANNED",
        requiresApproval: true,
        input: staleEmailActionInput,
        inputHash: jsonDigest(staleEmailActionInput),
      },
    });
    const pendingStaleEmailApproval = await prisma.supplyApproval.create({
      data: {
        officeId: context.officeId,
        workspaceId: staleDecisionFixture.procurementCase.workspaceId,
        executionTaskId: staleEmailAction.id,
        requestedByUserId: context.userId,
        status: "PENDING",
        requiredRole: "MANAGER",
        scopeHash: staleEmailAction.inputHash,
        requestReason: "Stale connected-order retry fixture.",
        idempotencyKey: `purchase-order-email-stale-revision:${suffix}`,
      },
    });
    await prisma.supplyApproval.update({
      where: { id: pendingStaleEmailApproval.id },
      data: { status: "APPROVED", decidedByUserId: managerContext.userId, decidedAt: new Date(), decisionNote: "Fixture email scope approved." },
    });
    await prisma.supplyExecutionTask.update({ where: { id: staleEmailAction.id }, data: { status: "READY" } });
    await prisma.supplyExecutionTask.update({
      where: { id: staleEmailAction.id },
      data: { status: "RUNNING", startedAt: new Date(), result: { state: "RETRY_READY", attempt: 1 }, resultHash: jsonDigest({ state: "RETRY_READY", attempt: 1 }) },
    });
    const staleDecisionResult = await prisma.$transaction((tx) => returnStaleReplacementToSourcing({
      tx,
      officeId: context.officeId,
      workspaceId: staleDecisionFixture.procurementCase.workspaceId,
      procurementCaseId: staleDecisionFixture.procurementCase.id,
      actorUserId: secondAdminContext.userId,
      revisionContext: staleDecisionFixture.revisionContext,
      replacementDraftId: staleDecisionFixture.replacementDraft.id,
      replacementActionId: staleDecisionRequest.purchaseAction!.id,
      staleGate: "QUALITY_PLAN",
    }));
    assert.equal((staleDecisionResult.result as { sourcingReturn: { reasonCode: string } }).sourcingReturn.reasonCode, "QUALITY_PLAN_EXPIRED");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleDecisionRequest.purchaseAction!.id } })).status, "CANCELLED");
    assert.equal((await prisma.supplyApproval.findUniqueOrThrow({ where: { id: staleDecisionRequest.approval!.id } })).status, "EXPIRED");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleDecisionFixture.releasedAction.id } })).status, "RUNNING");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleEmailDraft.id } })).status, "CANCELLED");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleEmailAction.id } })).status, "CANCELLED");
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: staleDecisionFixture.procurementCase.id, eventType: "REVISED_PURCHASE_RETURNED_TO_SOURCING" } }), 1);
    await prisma.$transaction((tx) => returnStaleReplacementToSourcing({
      tx,
      officeId: context.officeId,
      workspaceId: staleDecisionFixture.procurementCase.workspaceId,
      procurementCaseId: staleDecisionFixture.procurementCase.id,
      actorUserId: secondAdminContext.userId,
      revisionContext: staleDecisionFixture.revisionContext,
      replacementDraftId: staleDecisionFixture.replacementDraft.id,
      replacementActionId: staleDecisionRequest.purchaseAction!.id,
      staleGate: "QUALITY_PLAN",
    }));
    assert.equal(await prisma.supplyExecutionEvent.count({ where: { executionTaskId: staleDecisionFixture.procurementCase.id, eventType: "REVISED_PURCHASE_RETURNED_TO_SOURCING" } }), 1, "stale recovery retries must not append fake history");

    const staleSendFixture = await cloneRevisionDraftFixture("connected-send", futureDate(0));
    const staleSendApprovalRequest = await requestPurchaseActionApproval({
      context,
      caseId: staleSendFixture.procurementCase.id,
      input: {
        expectedDraftTaskId: staleSendFixture.replacementDraft.id,
        expectedDraftResultHash: staleSendFixture.replacementDraft.resultHash!,
        expectedDraftRevision: 1,
        reason: "Authorize the replacement before its quality checkpoint expires.",
      },
    });
    const staleSendAuthorized = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: staleSendApprovalRequest.approval!.id,
      input: { decision: "APPROVE", note: "The replacement scope is current today." },
    });
    const staleSendEmailDraft = await savePurchaseOrderEmailDraft({
      context,
      purchaseActionId: staleSendAuthorized.purchaseAction!.id,
      input: {
        expectedActionScopeHash: staleSendAuthorized.purchaseAction!.inputHash,
        expectedRevision: 0,
        senderAccountId: orderSenderAccount.id,
        recipient: "orders@example.com",
        subject: "Replacement order freshness verification",
        body: "Please accept the exact replacement order attached to this approved supplier exception.",
        purchaseOrderReference: `PO-STALE-${suffix}`,
        acknowledgmentDueOn: futureDate(2),
        note: "This fixture must fail closed if the approval evidence expires before delivery.",
      },
    });
    const staleSendEmailApprovalRequest = await requestPurchaseOrderEmailApproval({
      context,
      draftId: staleSendEmailDraft.id,
      input: { expectedResultHash: staleSendEmailDraft.resultHash, reason: "Approve the exact connected replacement message." },
    });
    const staleSendEmailAuthorized = await decidePurchaseOrderEmailApproval({
      context: managerContext,
      approvalId: staleSendEmailApprovalRequest.approval.id,
      input: { decision: "APPROVE", note: "The exact message is approved while its order scope is current." },
    });
    let staleProviderCalls = 0;
    const staleProvider: SupplierEmailProvider = {
      send: async () => {
        staleProviderCalls += 1;
        return { state: "SENT", provider: "GMAIL", providerMessageId: "must-not-send", providerThreadId: "must-not-send", sourceUrl: "https://mail.google.com/" };
      },
    };
    const OriginalDate = globalThis.Date;
    const nextDay = OriginalDate.now() + 86_400_000;
    class NextDayDate extends OriginalDate {
      constructor(value?: string | number | Date) {
        super(value === undefined ? nextDay : value);
      }
      static now() {
        return nextDay;
      }
    }
    globalThis.Date = NextDayDate as unknown as DateConstructor;
    let staleSendResult;
    try {
      staleSendResult = await sendPurchaseOrderEmailAction({ context, actionId: staleSendEmailAuthorized.action.id, provider: staleProvider });
    } finally {
      globalThis.Date = OriginalDate;
    }
    assert.equal(staleProviderCalls, 0, "expired replacement evidence must block the provider call");
    assert.equal(staleSendResult.status, "CANCELLED");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleSendFixture.releasedAction.id } })).status, "RUNNING");
    assert.equal(((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: staleSendFixture.procurementCase.id } })).result as { sourcingReturn: { reasonCode: string } }).sourcingReturn.reasonCode, "QUALITY_PLAN_EXPIRED");

    const replacementApprovalRequest = await requestPurchaseActionApproval({
      context,
      caseId: clonedCase.id,
      input: {
        expectedDraftTaskId: revisedDraft!.id,
        expectedDraftResultHash: revisedDraft!.resultHash,
        expectedDraftRevision: 1,
        reason: "Authorize the supplier-backed replacement order scope.",
      },
    });
    assert.equal((replacementApprovalRequest.procurementCase.result as { purchaseRevision: { state: string } }).purchaseRevision.state, "APPROVAL_PENDING");
    const replacementRejected = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: replacementApprovalRequest.approval.id,
      input: { decision: "REJECT", note: "Revise the internal buyer reference before this order is authorized." },
    });
    assert.equal((replacementRejected.purchaseAction.result as { state: string }).state, "REJECTED");
    assert.equal((replacementRejected.procurementCase.result as { purchaseRevision: { state: string } }).purchaseRevision.state, "REJECTED");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } })).status, "RUNNING", "rejecting a replacement must leave the released order active");
    await assert.rejects(() => requestPurchaseActionApproval({
      context,
      caseId: clonedCase.id,
      input: {
        expectedDraftTaskId: revisedDraft!.id,
        expectedDraftResultHash: revisedDraft!.resultHash!,
        expectedDraftRevision: 1,
        reason: "Retry the unchanged rejected replacement scope.",
      },
    }), /rejected|revised order projection changed/i, "an unchanged rejected replacement scope must not be resubmitted");
    const recoveredRevisedDraft = await prepareRevisedPurchaseOrder({
      context,
      actionId: clonedAction.id,
      input: {
        ...revisedDraftInput,
        expectedRevision: 1,
        buyerReference: "PO-CONNECTED-001-R1-RECOVERED",
        notes: "Replacement order revised after the admin decision.",
      },
    });
    assert.equal((recoveredRevisedDraft.purchaseDraft?.result as { revision: number }).revision, 2);
    const recoveredReplacementApproval = await requestPurchaseActionApproval({
      context,
      caseId: clonedCase.id,
      input: {
        expectedDraftTaskId: recoveredRevisedDraft.purchaseDraft!.id,
        expectedDraftResultHash: recoveredRevisedDraft.purchaseDraft!.resultHash!,
        expectedDraftRevision: 2,
        reason: "Authorize the edited supplier-backed replacement order scope.",
      },
    });
    const replacementAuthorized = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: recoveredReplacementApproval.approval.id,
      input: { decision: "APPROVE", note: "Supplier exception evidence supports this exact revised order." },
    });
    assert.equal((replacementAuthorized.purchaseAction.result as { state: string }).state, "AUTHORIZED");
    assert.equal((replacementAuthorized.procurementCase.result as { purchaseRevision: { state: string }; purchaseRelease?: unknown }).purchaseRevision.state, "AUTHORIZED");
    const orderAwaitingReplacementRelease = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } });
    const orderAwaitingReplacementResult = orderAwaitingReplacementRelease.result as {
      state: string;
      release: { releaseHash: string };
      supplierOrderExceptions: Array<{ exceptionHash: string; status: string; replacementAuthorization?: { purchaseActionTaskId: string } }>;
    };
    assert.equal(orderAwaitingReplacementRelease.status, "RUNNING", "internal approval must not pretend the supplier has received a replacement");
    assert.equal(orderAwaitingReplacementResult.state, "PARTIALLY_ACKNOWLEDGED");
    assert.equal(orderAwaitingReplacementResult.release.releaseHash, deliveredOrderResult.releaseHash);
    assert.equal(orderAwaitingReplacementResult.supplierOrderExceptions.find((entry) => entry.exceptionHash === termsException.exception.exceptionHash)?.status, "REVISION_AUTHORIZED");
    await assert.rejects(() => recordSupplierOrderException({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        category: "DELIVERY_CHANGE",
        observedOn: futureDate(0),
        summary: "Supplier also proposed a later delivery date while the replacement was awaiting release.",
        proposedDeliveryDate: futureDate(45),
        evidenceUrl: "https://example.com/supplier-order-second-exception",
        note: "This must not create competing unresolved exception state.",
      },
    }), /active replacement order/i, "a second supplier exception must be blocked while replacement authorization is active");
    const replacementReleaseInput = {
      expectedScopeHash: replacementAuthorized.purchaseAction.inputHash,
      channel: "EMAIL",
      releasedOn: futureDate(0),
      acknowledgmentDueOn: futureDate(2),
      purchaseOrderReference: "PO-CONNECTED-001-R1",
      evidenceUrl: "https://example.com/purchase-orders/PO-CONNECTED-001-R1",
      note: "Revised order released after fresh authorization.",
    };
    const orderWithInjectedException = {
      ...orderAwaitingReplacementResult,
      supplierOrderExceptions: [
        ...orderAwaitingReplacementResult.supplierOrderExceptions,
        { exceptionHash: `injected-open-exception-${suffix}`, status: "OPEN_REVIEW" },
      ],
    };
    await prisma.supplyExecutionTask.update({
      where: { id: clonedAction.id },
      data: { result: orderWithInjectedException, resultHash: jsonDigest(orderWithInjectedException) },
    });
    await assert.rejects(() => recordPurchaseOrderRelease({
      context: managerContext,
      actionId: replacementAuthorized.purchaseAction.id,
      input: replacementReleaseInput,
    }), /no longer matches the supplier exception authorization/i, "replacement release must fail closed if another unresolved exception exists");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: replacementAuthorized.purchaseAction.id } })).status, "READY", "a blocked replacement release must roll back atomically");
    await prisma.supplyExecutionTask.update({
      where: { id: clonedAction.id },
      data: { result: orderAwaitingReplacementResult, resultHash: jsonDigest(orderAwaitingReplacementResult) },
    });
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        acknowledgedOn: futureDate(0),
        supplierOrderReference: "SO-OBSOLETE-ORDER",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: "https://example.com/obsolete-order-acceptance",
      },
    }), (error: unknown) => error instanceof Error, "the superseded released order must reject later acceptance");
    const concurrentReplacementReleases = await Promise.all([
      recordPurchaseOrderRelease({ context: managerContext, actionId: replacementAuthorized.purchaseAction.id, input: replacementReleaseInput }),
      recordPurchaseOrderRelease({ context: managerContext, actionId: replacementAuthorized.purchaseAction.id, input: replacementReleaseInput }),
    ]);
    const replacementRelease = concurrentReplacementReleases[0];
    assert.equal((concurrentReplacementReleases[1].release as { releaseHash: string }).releaseHash, (replacementRelease.release as { releaseHash: string }).releaseHash, "concurrent identical revised-order releases must converge");
    assert.notEqual((replacementRelease.release as { releaseHash: string }).releaseHash, deliveredOrderResult.releaseHash);
    assert.equal((replacementRelease.procurementCase.result as { purchaseRevision: { state: string } }).purchaseRevision.state, "RELEASED");
    const supersededOrder = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: clonedAction.id } });
    const supersededOrderResult = supersededOrder.result as {
      state: string;
      release: { releaseHash: string };
      supplierOrderExceptions: Array<{ exceptionHash: string; status: string; replacementRelease?: { releaseHash: string } }>;
      supersededBy: { purchaseActionTaskId: string; replacementReleaseHash: string };
    };
    assert.equal(supersededOrder.status, "SUCCEEDED");
    assert.equal(supersededOrderResult.state, "SUPERSEDED");
    assert.equal(supersededOrderResult.release.releaseHash, deliveredOrderResult.releaseHash, "supersession must retain immutable release history");
    assert.equal(supersededOrderResult.supersededBy.purchaseActionTaskId, replacementAuthorized.purchaseAction.id);
    assert.equal(supersededOrderResult.supersededBy.replacementReleaseHash, (replacementRelease.release as { releaseHash: string }).releaseHash);
    assert.equal(supersededOrderResult.supplierOrderExceptions.find((entry) => entry.exceptionHash === termsException.exception.exceptionHash)?.status, "REVISION_RELEASED");
    const resumedReplacement = await findProcurementCaseByRelatedTaskId(context, clonedAction.id);
    assert.equal(resumedReplacement?.purchaseDraft?.id, revisedDraft?.id, "reopening the superseded order must restore the replacement draft, not obsolete history");
    assert.equal(resumedReplacement?.purchaseAction?.id, replacementAuthorized.purchaseAction.id, "reopening the superseded order must restore the replacement release action");
    assert.equal((resumedReplacement?.result as { purchaseRevision?: { state?: string } } | null)?.purchaseRevision?.state, "RELEASED");

    const connectedRevisionException = await recordSupplierOrderException({
      context: managerContext,
      actionId: replacementAuthorized.purchaseAction.id,
      input: {
        expectedReleaseHash: (replacementRelease.release as { releaseHash: string }).releaseHash,
        category: "TERMS_CHANGE",
        observedOn: futureDate(0),
        summary: "Supplier requires Net 15 before dispatch for the revised order.",
        proposedQuantity: null,
        proposedUnitPrice: null,
        proposedCurrency: null,
        proposedDeliveryDate: null,
        proposedPaymentTerms: "Net 15 before dispatch",
        evidenceUrl: "https://example.com/purchase-orders/PO-CONNECTED-001-R2-offer",
        note: "Second revision used to verify connected Gmail supersession.",
      },
    });
    await resolveSupplierOrderException({
      context,
      actionId: replacementAuthorized.purchaseAction.id,
      input: {
        expectedReleaseHash: (replacementRelease.release as { releaseHash: string }).releaseHash,
        exceptionHash: connectedRevisionException.exception.exceptionHash,
        disposition: "REQUIRE_REAUTHORIZATION",
        note: "Authorize the supplier-backed payment-term revision before another release.",
      },
    });
    const firstReplacementInput = replacementAuthorized.purchaseAction.input as {
      order: typeof authorizedOrder;
      commercial: typeof authorizedCommercial & { quoteReference: string; quoteValidUntil: string };
    };
    const connectedReplacementDraftInput = {
      expectedReleaseHash: (replacementRelease.release as { releaseHash: string }).releaseHash,
      exceptionHash: connectedRevisionException.exception.exceptionHash,
      expectedRevision: 0,
      quantity: Number(firstReplacementInput.order.quantity),
      needBy: firstReplacementInput.order.needBy,
      shipTo: firstReplacementInput.order.shipTo,
      incoterm: firstReplacementInput.order.incoterm,
      paymentTerms: "Net 15 before dispatch",
      buyerReference: "PO-CONNECTED-001-R2",
      notes: "Second immutable replacement order.",
      unitPrice: Number(firstReplacementInput.commercial.unitPrice),
      currency: firstReplacementInput.commercial.currency,
      minimumOrderQuantity: Number(firstReplacementInput.commercial.minimumOrderQuantity),
      deliveryDate: firstReplacementInput.commercial.deliveryDate,
      quoteReference: "SUPPLIER-REVISION-002",
      quoteValidUntil: futureDate(14),
    };
    const connectedReplacementDraft = await prepareRevisedPurchaseOrder({
      context,
      actionId: replacementAuthorized.purchaseAction.id,
      input: connectedReplacementDraftInput,
    });
    const connectedReplacementApproval = await requestPurchaseActionApproval({
      context,
      caseId: clonedCase.id,
      input: {
        expectedDraftTaskId: connectedReplacementDraft.purchaseDraft!.id,
        expectedDraftResultHash: connectedReplacementDraft.purchaseDraft!.resultHash!,
        expectedDraftRevision: 1,
        reason: "Authorize the second replacement for connected delivery.",
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
      await tx.supplyApproval.update({
        where: { id: connectedReplacementApproval.approval.id },
        data: { requestedAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) },
      });
    });
    const expiredConnectedReplacement = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: connectedReplacementApproval.approval.id,
      input: { decision: "APPROVE", note: "The connected-delivery replacement scope is exact." },
    });
    assert.equal(expiredConnectedReplacement.stale, true);
    assert.equal(expiredConnectedReplacement.purchaseAction, null);
    assert.equal((expiredConnectedReplacement.procurementCase.result as { purchaseRevision: { state: string } }).purchaseRevision.state, "EXPIRED");
    const recoveredConnectedReplacementDraft = await prepareRevisedPurchaseOrder({
      context,
      actionId: replacementAuthorized.purchaseAction.id,
      input: {
        ...connectedReplacementDraftInput,
        expectedRevision: 1,
        buyerReference: "PO-CONNECTED-001-R2-RECOVERED",
        notes: "Recovered replacement draft after approval expiry.",
      },
    });
    assert.equal((recoveredConnectedReplacementDraft.purchaseDraft?.result as { revision: number }).revision, 2);
    const recoveredConnectedReplacementApproval = await requestPurchaseActionApproval({
      context,
      caseId: clonedCase.id,
      input: {
        expectedDraftTaskId: recoveredConnectedReplacementDraft.purchaseDraft!.id,
        expectedDraftResultHash: recoveredConnectedReplacementDraft.purchaseDraft!.resultHash!,
        expectedDraftRevision: 2,
        reason: "Authorize the recovered replacement after stale approval expiry.",
      },
    });
    const connectedReplacementAuthorized = await decidePurchaseActionApproval({
      context: secondAdminContext,
      approvalId: recoveredConnectedReplacementApproval.approval.id,
      input: { decision: "APPROVE", note: "Recovered replacement scope is current and exact." },
    });
    const staleOldAction = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: replacementAuthorized.purchaseAction.id } });
    const staleOldResult = JSON.parse(JSON.stringify(staleOldAction.result)) as { supplierOrderExceptions: Array<Record<string, unknown>> };
    staleOldResult.supplierOrderExceptions = staleOldResult.supplierOrderExceptions.map((entry) => entry.exceptionHash === connectedRevisionException.exception.exceptionHash ? { ...entry, status: "REVISION_DRAFTED" } : entry);
    await prisma.supplyExecutionTask.update({ where: { id: staleOldAction.id }, data: { result: staleOldResult, resultHash: jsonDigest(staleOldResult) } });
    await assert.rejects(() => recordPurchaseOrderRelease({
      context: managerContext,
      actionId: connectedReplacementAuthorized.purchaseAction.id,
      input: {
        expectedScopeHash: connectedReplacementAuthorized.purchaseAction.inputHash,
        channel: "EMAIL",
        releasedOn: futureDate(0),
        acknowledgmentDueOn: futureDate(2),
        purchaseOrderReference: "PO-CONNECTED-001-R2-STALE",
        evidenceUrl: "https://example.com/purchase-orders/PO-CONNECTED-001-R2-stale",
        note: "This release must roll back because the exception authorization changed.",
      },
    }), /no longer matches the supplier exception authorization/i, "stale exception state must fail closed before either order is superseded");
    assert.equal((await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: connectedReplacementAuthorized.purchaseAction.id } })).status, "READY");
    const restoredOldResult = JSON.parse(JSON.stringify(staleOldResult)) as { supplierOrderExceptions: Array<Record<string, unknown>> };
    restoredOldResult.supplierOrderExceptions = restoredOldResult.supplierOrderExceptions.map((entry) => entry.exceptionHash === connectedRevisionException.exception.exceptionHash ? { ...entry, status: "REVISION_AUTHORIZED" } : entry);
    await prisma.supplyExecutionTask.update({ where: { id: staleOldAction.id }, data: { result: restoredOldResult, resultHash: jsonDigest(restoredOldResult) } });

    const connectedReplacementEmailDraft = await savePurchaseOrderEmailDraft({
      context,
      purchaseActionId: connectedReplacementAuthorized.purchaseAction.id,
      input: {
        expectedActionScopeHash: connectedReplacementAuthorized.purchaseAction.inputHash,
        expectedRevision: 0,
        senderAccountId: orderSenderAccount.id,
        recipient: "orders@example.com",
        subject: "Revised purchase order PO-CONNECTED-001-R2",
        body: "Please accept revised purchase order PO-CONNECTED-001-R2 and disregard the earlier order scope.",
        purchaseOrderReference: "PO-CONNECTED-001-R2",
        acknowledgmentDueOn: futureDate(2),
        note: "Connected release of the exact second replacement.",
      },
    });
    const connectedReplacementEmailApproval = await requestPurchaseOrderEmailApproval({
      context,
      draftId: connectedReplacementEmailDraft.id,
      input: { expectedResultHash: connectedReplacementEmailDraft.resultHash, reason: "Approve the exact replacement email." },
    });
    const connectedReplacementEmailAuthorized = await decidePurchaseOrderEmailApproval({
      context: managerContext,
      approvalId: connectedReplacementEmailApproval.approval.id,
      input: { decision: "APPROVE", note: "Replacement sender, recipient, content, and order scope approved." },
    });
    let replacementProviderCalls = 0;
    const uncertainReplacementProvider: SupplierEmailProvider = {
      send: async () => {
        replacementProviderCalls += 1;
        return { state: "UNKNOWN", error: "Simulated replacement delivery timeout." };
      },
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    const uncertainReplacementSend = await sendPurchaseOrderEmailAction({ context, actionId: connectedReplacementEmailAuthorized.action.id, provider: uncertainReplacementProvider });
    assert.equal((uncertainReplacementSend.result as { state: string }).state, "DELIVERY_UNKNOWN");
    const oldDuringUncertainDelivery = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: replacementAuthorized.purchaseAction.id } });
    assert.equal(oldDuringUncertainDelivery.status, "RUNNING", "an unknown provider result must leave the prior supplier-facing order active");
    assert.equal((oldDuringUncertainDelivery.result as { state: string }).state, "RELEASED");
    await reconcilePurchaseOrderEmailAction({ context, actionId: connectedReplacementEmailAuthorized.action.id, provider: uncertainReplacementProvider });
    await resetPurchaseOrderEmailForRetry({
      context: managerContext,
      actionId: connectedReplacementEmailAuthorized.action.id,
      input: { confirmedNotSent: true, note: "Confirmed the replacement Message-ID is absent from Gmail Sent before retry." },
    });
    const sentReplacementProvider: SupplierEmailProvider = {
      send: async (message) => {
        replacementProviderCalls += 1;
        return { state: "SENT", provider: "GMAIL", providerMessageId: `gmail-replacement-${suffix}`, providerThreadId: `gmail-replacement-thread-${suffix}`, sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(message.senderEmail)}/#sent/gmail-replacement-thread-${suffix}` };
      },
      reconcile: async () => ({ state: "NOT_FOUND" }),
    };
    const sentReplacement = await sendPurchaseOrderEmailAction({ context, actionId: connectedReplacementEmailAuthorized.action.id, provider: sentReplacementProvider });
    assert.equal((sentReplacement.result as { state: string }).state, "SENT");
    assert.equal(replacementProviderCalls, 2, "replacement delivery may retry only after a confirmed provider miss");
    await sendPurchaseOrderEmailAction({ context, actionId: connectedReplacementEmailAuthorized.action.id, provider: sentReplacementProvider });
    assert.equal(replacementProviderCalls, 2, "a delivered replacement must not call Gmail again on retry");
    const supersededFirstReplacement = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: replacementAuthorized.purchaseAction.id } });
    assert.equal(supersededFirstReplacement.status, "SUCCEEDED");
    assert.equal((supersededFirstReplacement.result as { state: string }).state, "SUPERSEDED");
    assert.equal((supersededFirstReplacement.result as { supplierOrderExceptions: Array<{ exceptionHash: string; status: string }> }).supplierOrderExceptions.find((entry) => entry.exceptionHash === connectedRevisionException.exception.exceptionHash)?.status, "REVISION_RELEASED");
    const connectedReplacementReleaseHash = (sentReplacement.result as { releaseHash: string }).releaseHash;
    const resumedConnectedReplacement = await findProcurementCaseByRelatedTaskId(context, replacementAuthorized.purchaseAction.id);
    assert.equal(resumedConnectedReplacement?.purchaseAction?.id, connectedReplacementAuthorized.purchaseAction.id);
    assert.equal((resumedConnectedReplacement?.result as { purchaseRevision?: { replacementReleaseHash?: string } } | null)?.purchaseRevision?.replacementReleaseHash, connectedReplacementReleaseHash);

    const supplierRejection = await recordSupplierOrderException({
      context: managerContext,
      actionId: connectedReplacementAuthorized.purchaseAction.id,
      input: {
        expectedReleaseHash: connectedReplacementReleaseHash,
        category: "REJECTION",
        observedOn: futureDate(0),
        summary: "Supplier rejected the replacement order and will not accept this purchase.",
        proposedQuantity: null,
        proposedUnitPrice: null,
        proposedCurrency: null,
        proposedDeliveryDate: null,
        proposedPaymentTerms: null,
        evidenceUrl: "https://example.com/purchase-orders/PO-CONNECTED-001-R2-rejected",
        note: "The buyer must choose another supplier.",
      },
    });
    await assert.rejects(() => resolveSupplierOrderException({
      context,
      actionId: connectedReplacementAuthorized.purchaseAction.id,
      input: {
        expectedReleaseHash: connectedReplacementReleaseHash,
        exceptionHash: supplierRejection.exception.exceptionHash,
        disposition: "REQUIRE_REAUTHORIZATION",
        note: "An invalid attempt to revise a supplier rejection.",
      },
    }), /must return to sourcing/i, "a supplier rejection cannot create another replacement authorization");
    await assert.rejects(() => resolveSupplierOrderException({
      context: managerContext,
      actionId: connectedReplacementAuthorized.purchaseAction.id,
      input: {
        expectedReleaseHash: connectedReplacementReleaseHash,
        exceptionHash: supplierRejection.exception.exceptionHash,
        disposition: "KEEP_ORIGINAL",
        note: "An invalid attempt to retain an order the supplier rejected.",
      },
    }), /must return to sourcing/i, "a supplier rejection cannot pretend the original order remains acceptable");
    const returnedToSourcing = await resolveSupplierOrderException({
      context: managerContext,
      actionId: connectedReplacementAuthorized.purchaseAction.id,
      input: {
        expectedReleaseHash: connectedReplacementReleaseHash,
        exceptionHash: supplierRejection.exception.exceptionHash,
        disposition: "RETURN_TO_SOURCING",
        note: "Supplier rejected the order, so choose another qualified source from the shortlist.",
      },
    });
    assert.equal(returnedToSourcing.exception.status, "RETURNED_TO_SOURCING");
    assert.equal((returnedToSourcing.procurementCase.result as { sourcingReturn: { state: string } }).sourcingReturn.state, "REQUIRED");
    await assert.rejects(() => recordPurchaseOrderAcknowledgment({
      context: managerContext,
      actionId: connectedReplacementAuthorized.purchaseAction.id,
      input: {
        expectedReleaseHash: connectedReplacementReleaseHash,
        acknowledgedOn: futureDate(0),
        supplierOrderReference: "SO-REJECTED-ORDER",
        acceptedQuantity: 1,
        confirmedDeliveryDate: futureDate(5),
        evidenceUrl: "https://example.com/purchase-orders/invalid-rejection-acknowledgment",
      },
    }), /resolve the supplier order exception/i, "an order returned to sourcing must never accept later acknowledgment");
    const resumedRejectedCase = await findProcurementCaseByRelatedTaskId(context, connectedReplacementAuthorized.purchaseAction.id);
    assert.equal((resumedRejectedCase?.result as { sourcingReturn?: { state?: string } } | null)?.sourcingReturn?.state, "REQUIRED");

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

    const shortlistRun = await startSourcingResearchRun(context, { ...input, componentItemKey: "MULTI-RFQ" });
    await completeSourcingResearchRun({
      context,
      runId: shortlistRun.id,
      workspaceId: shortlistRun.workspaceId,
      output: {
        candidates: [
          { id: "shortlist-a", companyName: "Alpha Motion", website: "https://example.com/alpha", price: supported(122), currency: supported("USD"), minimumOrderQuantity: supported(4), leadTimeDays: supported(12), status: "REVIEW_REQUIRED" },
          { id: "shortlist-b", companyName: "Bravo Controls", website: "https://example.com/bravo", price: supported(119), currency: supported("USD"), minimumOrderQuantity: supported(6), leadTimeDays: supported(15), status: "REVIEW_REQUIRED" },
          { id: "shortlist-c", companyName: "Cobalt Systems", website: "https://example.com/cobalt", price: supported(116), currency: supported("CAD"), minimumOrderQuantity: supported(3), leadTimeDays: supported(10), status: "REVIEW_REQUIRED" },
          { id: "shortlist-d", companyName: "Delta Robotics", website: "https://example.com/delta", price: supported(121), currency: supported("USD"), minimumOrderQuantity: supported(5), leadTimeDays: supported(11), status: "REVIEW_REQUIRED" },
        ],
        degraded: false,
        warnings: [],
      },
    });
    const shortlistSelection = (id: string, name: string) => ({
      id: `public:${id}`,
      name,
      sourceClass: "Official" as const,
      sourceUrl: `https://example.com/${id}`,
      price: 1,
      currency: "USD",
      minimumOrderQuantity: 1,
      priceType: "Sourced" as const,
      deliveryDate: quoteDeliveryDate,
      deliveryType: "Sourced" as const,
      quality: "Conditional" as const,
    });
    const firstShortlist = await saveProcurementShortlist({
      context,
      researchRunId: shortlistRun.id,
      selections: [shortlistSelection("shortlist-a", "Alpha Motion"), shortlistSelection("shortlist-b", "Bravo Controls")],
    });
    assert.equal(firstShortlist.length, 2);
    assert.equal(new Set(firstShortlist.map((procurementCase) => procurementCase.id)).size, 2, "each supplier needs an isolated workstream");
    const replayedShortlist = await saveProcurementShortlist({
      context,
      researchRunId: shortlistRun.id,
      selections: [shortlistSelection("shortlist-a", "Alpha Motion"), shortlistSelection("shortlist-b", "Bravo Controls")],
    });
    assert.deepEqual(replayedShortlist.map((procurementCase) => procurementCase.id), firstShortlist.map((procurementCase) => procurementCase.id), "shortlist retries must be idempotent");
    const expandedShortlist = await saveProcurementShortlist({
      context,
      researchRunId: shortlistRun.id,
      selections: [shortlistSelection("shortlist-a", "Alpha Motion"), shortlistSelection("shortlist-b", "Bravo Controls"), shortlistSelection("shortlist-c", "Cobalt Systems")],
    });
    assert.equal(expandedShortlist.length, 3);
    assert.deepEqual(expandedShortlist.slice(0, 2).map((procurementCase) => procurementCase.id), firstShortlist.map((procurementCase) => procurementCase.id), "adding a supplier must not replace existing workstreams");
    const concurrent = await Promise.all([
      saveProcurementShortlist({ context, researchRunId: shortlistRun.id, selections: [shortlistSelection("shortlist-d", "Delta Robotics")] }),
      saveProcurementShortlist({ context, researchRunId: shortlistRun.id, selections: [shortlistSelection("shortlist-d", "Delta Robotics")] }),
    ]);
    assert.equal(concurrent[0][0]?.id, concurrent[1][0]?.id, "concurrent retries must converge on one supplier workstream");
    assert.equal(await prisma.supplyExecutionEvent.count({
      where: { executionTaskId: concurrent[0][0]!.id, eventType: "PROCUREMENT_CASE_CREATED" },
    }), 1, "concurrent first-time creation must append exactly one creation event");
    const restoredShortlist = (await listProcurementCases(context))
      .filter((procurementCase) => (procurementCase.input as { researchRunId: string }).researchRunId === shortlistRun.id);
    assert.equal(restoredShortlist.length, 4, "all supplier workstreams must restore from the sourcing queue");
    assert.deepEqual(new Set(restoredShortlist.map((procurementCase) => (procurementCase.result as { selectedOption: { id: string } }).selectedOption.id)), new Set([
      "public:shortlist-a",
      "public:shortlist-b",
      "public:shortlist-c",
      "public:shortlist-d",
    ]), "restored workstreams must preserve each supplier identity");
    assert.equal(
      (await listProcurementCasesForResearchRuns(context, [shortlistRun.id])).length,
      4,
      "a sourcing queue page must load every supplier workstream for its exact research runs",
    );
    const awardCandidates = restoredShortlist.slice(0, 2);
    for (const awardCandidate of awardCandidates) {
      const result = awardCandidate.result as Record<string, unknown>;
      const awardReadyResult = {
        ...result,
        stage: "APPROVAL",
        gates: {
          sourceEvidence: "EVIDENCE_COMPLETE",
          commercialTerms: "EVIDENCE_COMPLETE",
          qualityPlan: "EVIDENCE_COMPLETE",
          purchaseApproval: "BLOCKED",
        },
        confirmedTerms: {
          price: 120,
          currency: "USD",
          minimumOrderQuantity: 1,
          unitOfMeasure: "EA",
          deliveryDate: quoteDeliveryDate,
          validUntil: quoteValidUntil,
        },
        qualityPlan: {
          method: "DOCUMENT_REVIEW",
          owner: "Quality lead",
          targetDate: qualityTargetDate,
          acceptanceCriteria: "Confirm specification and traceability documents.",
        },
        reviews: {
          sourceEvidence: {
            outcome: "QUALIFIED",
            relationship: "MANUFACTURER",
            identityEvidenceUrl: "https://example.com/",
            capabilityEvidenceUrl: "https://example.com/product",
            authorizationEvidenceUrl: null,
            validUntil: futureDate(90),
            note: "Supplier identity and component capability were reviewed for the concurrent award test.",
            reviewHash: "award-test-source-review",
            reviewedAt: new Date().toISOString(),
          },
          commercialTerms: { reviewHash: "award-test-commercial-review" },
          qualityPlan: { reviewHash: "award-test-quality-review" },
        },
      };
      await prisma.supplyExecutionTask.update({
        where: { id: awardCandidate.id },
        data: { result: awardReadyResult, resultHash: jsonDigest(awardReadyResult) },
      });
    }
    const concurrentAwards = await Promise.allSettled(awardCandidates.map((awardCandidate) => requestProcurementApproval({
      context,
      caseId: awardCandidate.id,
      input: {
        expectedSelectionHash: (awardCandidate.result as { selectionHash: string }).selectionHash,
        reason: "Best complete supplier option for this sourcing request.",
      },
    })));
    assert.equal(concurrentAwards.filter((result) => result.status === "fulfilled").length, 1, "only one supplier can enter award approval");
    assert.equal(concurrentAwards.filter((result) => result.status === "rejected").length, 1, "a concurrent sibling award must be rejected");
    assert.match(String(concurrentAwards.find((result) => result.status === "rejected")?.reason), /another supplier is already pending or approved/i);
    const awardStates = (await listProcurementCases(context))
      .filter((procurementCase) => (procurementCase.input as { researchRunId: string }).researchRunId === shortlistRun.id)
      .map((procurementCase) => (procurementCase.result as { gates: { purchaseApproval: string } }).gates.purchaseApproval);
    assert.equal(awardStates.filter((state) => state === "PENDING").length, 1, "the sourcing request must expose exactly one pending award");
    await assert.rejects(() => saveProcurementShortlist({
      context,
      researchRunId: shortlistRun.id,
      selections: [shortlistSelection("shortlist-a", "Alpha Motion"), shortlistSelection("shortlist-a", "Alpha Motion")],
    }), /same supplier more than once/i);
    await assert.rejects(() => saveProcurementShortlist({
      context,
      researchRunId: shortlistRun.id,
      selections: [],
    }), /1 to 8 supplier options/i);
    await assert.rejects(() => saveProcurementShortlist({
      context,
      researchRunId: shortlistRun.id,
      selections: Array.from({ length: 9 }, () => shortlistSelection("shortlist-a", "Alpha Motion")),
    }), /1 to 8 supplier options/i);

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
    await assert.rejects(() => listSourcingResearchPage(stalePrivilegedContext), /current user|not found|cannot edit/i, "a stale privileged session must not read the sourcing queue after demotion");
    await assert.rejects(() => captureConnectedSupplierReplies({
      context: stalePrivilegedContext,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      sync: replySync,
    }), /not found|cannot edit/i, "a stale privileged session must not capture connected supplier replies");
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
    await assert.rejects(() => saveProcurementShortlist({
      context: stalePrivilegedContext,
      researchRunId: shortlistRun.id,
      selections: [shortlistSelection("shortlist-a", "Alpha Motion")],
    }), /not found|cannot edit/i, "stale privileged sessions must not create supplier workstreams");
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
      input: supplierQualificationInput(
        (returnedCase.result as { selectionHash: string }).selectionHash,
        "Unauthorized supplier qualification review attempt.",
      ),
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
    await assert.rejects(() => recordPurchaseOrderRelease({
      context: stalePrivilegedContext,
      actionId: releaseAction.purchaseAction.id,
      input: releaseBase,
    }), /admin or manager/i, "a stale privileged cookie must not record purchase order release after demotion");
    await assert.rejects(() => savePurchaseOrderEmailDraft({
      context: stalePrivilegedContext,
      purchaseActionId: clonedAction.id,
      input: connectedOrderDraftInput,
    }), /current user|not found|cannot edit/i, "a stale privileged cookie must not prepare a connected purchase order email after demotion");
    await assert.rejects(() => savePurchaseOrderFollowUpDraft({
      context: stalePrivilegedContext,
      purchaseActionId: releaseAction.purchaseAction.id,
      input: followUpDraftInput,
    }), /current user|not found|cannot edit/i, "a stale privileged cookie must not prepare a supplier follow-up after demotion");
    await assert.rejects(() => captureConnectedPurchaseOrderReplies({
      context: stalePrivilegedContext,
      purchaseActionId: clonedAction.id,
      sync: orderReplySync,
    }), /current user|not found|cannot edit/i, "a stale privileged cookie must not capture connected supplier order replies after demotion");
    await assert.rejects(() => recordSupplierOrderException({
      context: stalePrivilegedContext,
      actionId: clonedAction.id,
      input: connectedExceptionInput,
    }), /admin or manager/i, "a stale privileged cookie must not record supplier order exceptions after demotion");
    await assert.rejects(() => resolveSupplierOrderException({
      context: stalePrivilegedContext,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        exceptionHash: termsException.exception.exceptionHash,
        disposition: "KEEP_ORIGINAL",
        note: "Unauthorized stale-session disposition attempt.",
      },
    }), /admin or manager/i, "a stale privileged cookie must not resolve supplier order exceptions after demotion");
    await assert.rejects(() => prepareRevisedPurchaseOrder({
      context: stalePrivilegedContext,
      actionId: clonedAction.id,
      input: revisedDraftInput,
    }), /current user|not found|cannot edit/i, "a stale privileged cookie must not prepare a revised purchase scope after demotion");

    const foreign = await makeContext("foreign");
    foreignOfficeId = foreign.officeId;
    assert.equal((await listSourcingResearchRuns(foreign)).length, 0, "another office must not see sourcing research runs");
    assert.equal((await listSourcingResearchPage(foreign)).runs.length, 0, "another office must not page through sourcing research runs");
    assert.equal((await listProcurementCases(foreign)).length, 0, "another office must not see procurement cases");
    await assert.rejects(() => recordSupplierOrderException({ context: foreign, actionId: clonedAction.id, input: connectedExceptionInput }), /not found/i, "another office must not record supplier order exceptions");
    await assert.rejects(() => resolveSupplierOrderException({
      context: foreign,
      actionId: clonedAction.id,
      input: {
        expectedReleaseHash: deliveredOrderResult.releaseHash,
        exceptionHash: termsException.exception.exceptionHash,
        disposition: "KEEP_ORIGINAL",
        note: "Unauthorized cross-office disposition attempt.",
      },
    }), /not found/i, "another office must not resolve supplier order exceptions");
    await assert.rejects(() => prepareRevisedPurchaseOrder({
      context: foreign,
      actionId: clonedAction.id,
      input: revisedDraftInput,
    }), /not found/i, "another office must not prepare a revised purchase scope");
    await assert.rejects(() => saveProcurementShortlist({
      context: foreign,
      researchRunId: shortlistRun.id,
      selections: [shortlistSelection("shortlist-a", "Alpha Motion")],
    }), /not found/i, "another office must not create workstreams from this office's research run");
    await assert.rejects(() => captureConnectedSupplierReplies({
      context: foreign,
      quoteCycleId: retryQuoteDraft.quoteCycle.id,
      sync: replySync,
    }), /not found|cannot edit|delivered connected Gmail quote request/i, "another office must not capture connected supplier replies");
    await assert.rejects(() => procurementEvidenceSource(foreign, storedQuoteResponse.evidenceId), /not found/i, "another office must not resolve supplier evidence");
    assert.equal((await procurementEvidenceSource(context, storedQuoteResponse.evidenceId)).url, quoteResponseInput.evidenceUrl);
    const saturationTime = new Date(Date.now() + 60_000);
    await prisma.supplyExecutionTask.createMany({
      data: Array.from({ length: 121 }, (_, index) => ({
        officeId: context.officeId,
        workspaceId: started.workspaceId,
        createdByUserId: context.userId,
        taskKey: `pagination-noise:${suffix}:${index}`,
        taskType: "PROCUREMENT_CASE",
        capabilityKey: "plan.procurement_case",
        status: "PLANNED",
        requiresApproval: false,
        input: { researchRunId: `noise-run-${index}` },
        inputHash: jsonDigest({ researchRunId: `noise-run-${index}` }),
        updatedAt: saturationTime,
      })),
    });
    assert.equal(
      (await listProcurementCases(context)).some((entry) => entry.id === returnedCase.id),
      false,
      "the legacy recent-case window must reproduce why targeted restoration is required",
    );
    assert.equal(
      (await findProcurementCaseByRelatedTaskId(context, retryQuoteDraft.quoteCycle.id))?.id,
      returnedCase.id,
      "related-task lookup must restore an exact older procurement workstream without scanning a capped queue",
    );
    assert.equal(
      (await findProcurementCaseByRelatedTaskId(context, supplierEmailDraft.id))?.id,
      returnedCase.id,
      "two-level ancestry must restore an old procurement case from its supplier email draft",
    );
    assert.equal(
      (await findProcurementCaseByRelatedTaskId(context, approvedEmail.action.id))?.id,
      returnedCase.id,
      "two-level ancestry must restore an old procurement case from its supplier email action",
    );
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
    await assert.rejects(() => recordPurchaseOrderRelease({
      context: foreign,
      actionId: releaseAction.purchaseAction.id,
      input: releaseBase,
    }), /not found/i, "another office must not record purchase order release");
    await assert.rejects(() => sendPurchaseOrderEmailAction({
      context: foreign,
      actionId: connectedOrderApproved.action.id,
      provider: uncertainOrderProvider,
    }), /not found/i, "another office must not send a connected purchase order email");
    await assert.rejects(() => sendPurchaseOrderFollowUpAction({
      context: foreign,
      actionId: followUpApproved.action.id,
      provider: sentFollowUpProvider,
    }), /not found/i, "another office must not send a supplier follow-up");
    await assert.rejects(() => captureConnectedPurchaseOrderReplies({
      context: foreign,
      purchaseActionId: clonedAction.id,
      sync: orderReplySync,
    }), /not found|released connected Gmail purchase order/i, "another office must not capture connected supplier order replies");
    assert.equal(
      await findProcurementCaseByRelatedTaskId(foreign, connectedOrderApproved.action.id),
      null,
      "another office must not restore a procurement workstream from a purchase order email action",
    );

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
