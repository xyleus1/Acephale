/**
 * State-recheck suite.
 *
 * Measures whether guarded Supply OS procurement actions still execute after the state
 * they were prepared against moved underneath them, and whether unrelated changes are
 * wrongly treated as conflicts. Every scenario runs against a real database case built
 * through the production persistence functions, not against fixtures or pure helpers.
 *
 * Reported metrics:
 * - stale executions detected out of stale executions attempted
 * - stale actions that escaped the guard
 * - false conflicts on unrelated changes
 * - guarded action latency, p50 and p95
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { prisma } from "../src/lib/prisma";
import { createSupplyWorkspace, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import {
  decidePurchaseActionApproval,
  decideProcurementApproval,
  recordSupplierQuoteRelease,
  recordSupplierQuoteResponse,
  requestProcurementApproval,
  requestPurchaseActionApproval,
  reviewProcurementGate,
  savePurchaseOrderDraft,
  saveProcurementSelection,
  saveSupplierQuoteRequest,
} from "../src/lib/supply-os/procurement-case-persistence";
import {
  completeSourcingResearchRun,
  startSourcingResearchRun,
} from "../src/lib/supply-os/sourcing-research-persistence";

const suffix = randomUUID().slice(0, 8);
const REPEATS = Number.parseInt(process.env.STATE_RECHECK_REPEATS ?? "6", 10);

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The suite writes real procurement cases and deletes the offices it created, so it refuses to run
 * against anything that is not a local database.
 */
function requireLocalDatabase() {
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const configured = process.env[name] ?? "";
    let host = "";
    try {
      host = new URL(configured).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    } catch {
      host = "";
    }
    if (!LOCAL_DATABASE_HOSTS.has(host)) {
      throw new Error(
        `state-recheck refuses to run against ${name} host "${host || "(unparseable)"}". `
        + "Point DATABASE_URL and DATABASE_URL_UNPOOLED at a local database, see .agents/skills/testing-derya-local.",
      );
    }
  }
}

requireLocalDatabase();

let officeId = "";
let otherOfficeId = "";

function jsonDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function futureDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function record(value: unknown) {
  return structuredClone(value) as Record<string, unknown>;
}

async function cleanup() {
  const ids = [officeId, otherOfficeId].filter(Boolean);
  if (!ids.length) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
    await tx.office.deleteMany({ where: { id: { in: ids } } });
  }).catch(() => undefined);
}

async function makeOffice(label: string) {
  const office = await prisma.office.create({ data: { name: `State recheck ${label} ${suffix}` } });
  const operator = await prisma.user.create({
    data: {
      officeId: office.id,
      email: `state-recheck-${label}-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: `${label} buyer`,
      role: "ADMIN",
      canViewWholeOffice: true,
    },
  });
  const approver = await prisma.user.create({
    data: {
      officeId: office.id,
      email: `state-recheck-${label}-approver-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: `${label} approver`,
      role: "MANAGER",
      canViewWholeOffice: true,
    },
  });
  const buyerContext = {
    officeId: office.id,
    userId: operator.id,
    role: operator.role,
    canViewWholeOffice: operator.canViewWholeOffice,
  } satisfies SupplyAccessContext;
  const authorizer = await prisma.user.create({
    data: {
      officeId: office.id,
      email: `state-recheck-${label}-authorizer-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: `${label} authorizer`,
      role: "ADMIN",
      canViewWholeOffice: true,
    },
  });
  const approverContext = { ...buyerContext, userId: approver.id, role: approver.role };
  const authorizerContext = { ...buyerContext, userId: authorizer.id, role: authorizer.role };
  const workspace = await createSupplyWorkspace(buyerContext, { name: `${label} workspace` });
  return { officeId: office.id, buyerContext, approverContext, authorizerContext, workspaceId: workspace.id };
}

type Office = Awaited<ReturnType<typeof makeOffice>>;

type Stage = "QUALIFIED" | "QUOTE_DRAFTED" | "APPROVAL_REQUESTED" | "APPROVED" | "PURCHASE_ACTION_REQUESTED";

/** Validity windows the case is built with, so a scenario can let a specific one lapse. */
type Validity = {
  qualificationDays: number;
  quoteValidDays: number;
  deliveryDays: number;
  qualityDays: number;
};

const LONG_VALIDITY: Validity = { qualificationDays: 365, quoteValidDays: 120, deliveryDays: 120, qualityDays: 120 };

const RealDate = Date;
let clockOffsetMs = 0;

class ShiftedDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date>) {
    if (args.length === 0) super(RealDate.now() + clockOffsetMs);
    else super(...(args as [number]));
  }

  static now() {
    return RealDate.now() + clockOffsetMs;
  }
}

globalThis.Date = ShiftedDate as unknown as DateConstructor;

/** Moves the process clock forward so validity windows lapse the way they do in production. */
function advanceClock(days: number) {
  clockOffsetMs = days * 86_400_000;
}

function resetClock() {
  clockOffsetMs = 0;
}

type BuiltCase = {
  office: Office;
  caseId: string;
  selectionHash: string;
  quoteCycleId?: string;
  requestHash?: string;
  responseHash?: string;
  approvalId?: string;
  approvalTaskId?: string;
  scopeHash?: string;
  quoteRequestInput: Record<string, unknown>;
  quoteReleaseInput?: Record<string, unknown>;
  purchaseDraftInput?: Record<string, unknown>;
  purchaseDraftTaskId?: string;
  purchaseActionApprovalId?: string;
  deliveryDate: string;
};

let caseCounter = 0;

async function buildCase(office: Office, stage: Stage, validity: Validity = LONG_VALIDITY): Promise<BuiltCase> {
  caseCounter += 1;
  const itemKey = `SR-${suffix}-${caseCounter}`;
  const deliveryDate = futureDate(validity.deliveryDays);
  const quoteValidUntil = futureDate(validity.quoteValidDays);
  const qualityTargetDate = futureDate(validity.qualityDays);
  const responseDueDays = Math.max(1, Math.min(3, validity.deliveryDays - 1));
  const observedAt = new Date().toISOString();
  const source = { url: "https://example.com/product", sourceType: "OFFICIAL" };
  const supported = <T>(value: T) => ({
    value,
    state: "SUPPORTED",
    confidence: 0.9,
    sources: [source],
    observedAt,
    freshness: "FRESH",
  });

  const run = await startSourcingResearchRun(office.buyerContext, {
    componentItemKey: itemKey,
    componentName: "Stereo depth camera",
    manufacturer: null,
    mpn: null,
    specification: "Industrial stereo depth camera",
    targetCountry: "United States",
    requestText: "Find stereo depth cameras",
  }, office.workspaceId);
  await completeSourcingResearchRun({
    context: office.buyerContext,
    runId: run.id,
    workspaceId: run.workspaceId,
    output: {
      candidates: [{
        id: "candidate-1",
        companyName: "Example supplier",
        website: "https://example.com/",
        sourceUrls: ["https://example.com/product"],
        price: supported(125),
        currency: supported("USD"),
        unitOfMeasure: supported("EA"),
        minimumOrderQuantity: supported(4),
        leadTimeDays: supported(14),
        status: "REVIEW_REQUIRED",
      }],
      degraded: false,
      warnings: [],
    },
  });

  const procurementCase = await saveProcurementSelection({
    context: office.buyerContext,
    researchRunId: run.id,
    selection: {
      id: "public:candidate-1",
      name: "Example supplier",
      sourceClass: "New",
      sourceUrl: "https://example.com/",
      price: null,
      currency: null,
      minimumOrderQuantity: null,
      priceType: "Unknown",
      deliveryDate: null,
      deliveryType: "Unknown",
      quality: "Conditional",
    },
  });
  const caseId = procurementCase.id;
  const selectionHash = (procurementCase.result as { selectionHash: string }).selectionHash;

  await reviewProcurementGate({
    context: office.buyerContext,
    caseId,
    input: {
      gate: "SOURCE_EVIDENCE",
      expectedSelectionHash: selectionHash,
      outcome: "QUALIFIED",
      relationship: "MANUFACTURER",
      identityEvidenceUrl: "https://example.com/",
      capabilityEvidenceUrl: "https://example.com/product",
      authorizationEvidenceUrl: null,
      validUntil: futureDate(validity.qualificationDays),
      rejectionReason: "SOURCE_UNVERIFIABLE",
      note: "Verified the official supplier identity and the matching product capability page.",
    },
  });

  const quoteRequestInput = {
    expectedSelectionHash: selectionHash,
    expectedRevision: 0,
    quantity: 8,
    unitOfMeasure: "EA",
    needBy: deliveryDate,
    shipTo: "Austin assembly plant",
    responseDue: futureDate(responseDueDays),
    requirements: "Quote calibrated stereo depth cameras with serial traceability.",
    note: "Return calibration and warranty terms with the quote.",
  };
  const built: BuiltCase = { office, caseId, selectionHash, quoteRequestInput, deliveryDate };
  if (stage === "QUALIFIED") return built;

  const quoteDraft = await saveSupplierQuoteRequest({ context: office.buyerContext, caseId, input: quoteRequestInput });
  built.quoteCycleId = quoteDraft.quoteCycle.id;
  built.requestHash = (quoteDraft.quoteCycle.result as { requestHash: string }).requestHash;
  built.quoteReleaseInput = {
    expectedRequestHash: built.requestHash,
    channel: "EMAIL",
    releasedOn: futureDate(0),
    evidenceUrl: "https://example.com/quote-requests/atlas-410",
    note: "Buyer sent the quote request from the supplier thread.",
  };
  if (stage === "QUOTE_DRAFTED") return built;

  await recordSupplierQuoteRelease({
    context: office.buyerContext,
    quoteCycleId: quoteDraft.quoteCycle.id,
    input: built.quoteReleaseInput,
  });
  const quoteResponse = await recordSupplierQuoteResponse({
    context: office.buyerContext,
    quoteCycleId: quoteDraft.quoteCycle.id,
    input: {
      expectedRequestHash: built.requestHash,
      receivedOn: futureDate(0),
      price: 125,
      currency: "USD",
      minimumOrderQuantity: 4,
      unitOfMeasure: "EA",
      deliveryDate,
      quoteReference: `Q-${itemKey}`,
      validUntil: quoteValidUntil,
      evidenceUrl: "https://example.com/quote/atlas-410",
      note: "Supplier quote includes calibration records.",
    },
  });
  built.responseHash = (quoteResponse.response as { responseHash: string }).responseHash;

  await reviewProcurementGate({
    context: office.buyerContext,
    caseId,
    input: {
      gate: "COMMERCIAL_TERMS",
      expectedSelectionHash: selectionHash,
      quoteCycleTaskId: quoteDraft.quoteCycle.id,
      responseHash: built.responseHash,
    },
  });
  await reviewProcurementGate({
    context: office.buyerContext,
    caseId,
    input: {
      gate: "QUALITY_PLAN",
      expectedSelectionHash: selectionHash,
      method: "SAMPLE",
      acceptanceCriteria: "Verify calibration, connector fit, image depth accuracy, and serial traceability.",
      owner: "Vision engineering",
      targetDate: qualityTargetDate,
      outcome: "PASS",
      observedOn: futureDate(0),
      evidenceUrl: "https://example.com/quality/atlas-vision-sample",
      verificationNote: "Vision engineering inspected the sample and recorded the passing calibration and fit results.",
    },
  });

  const requested = await requestProcurementApproval({
    context: office.buyerContext,
    caseId,
    input: {
      expectedSelectionHash: selectionHash,
      reason: "Best supported option for the production requirement.",
    },
  });
  built.approvalId = requested.approval.id;
  built.approvalTaskId = requested.approval.executionTaskId ?? undefined;
  built.scopeHash = requested.approval.scopeHash;
  if (stage === "APPROVAL_REQUESTED") return built;

  await decideProcurementApproval({
    context: office.approverContext,
    approvalId: requested.approval.id,
    input: { decision: "APPROVE", note: "Scope and quality plan approved." },
  });
  built.purchaseDraftInput = {
    expectedApprovalId: requested.approval.id,
    expectedApprovalScopeHash: requested.approval.scopeHash,
    expectedRevision: 0,
    quantity: 8,
    needBy: deliveryDate,
    shipTo: "Austin assembly plant, receiving dock 2",
    incoterm: "DAP",
    paymentTerms: "Net 30 after receipt",
    buyerReference: `REF-${itemKey}`,
    notes: "Keep calibration records with the shipment.",
  };
  if (stage === "APPROVED") return built;

  const prepared = await savePurchaseOrderDraft({
    context: office.buyerContext,
    caseId,
    input: built.purchaseDraftInput,
  });
  built.purchaseDraftTaskId = prepared.purchaseDraft!.id;
  const purchaseAction = await requestPurchaseActionApproval({
    context: office.buyerContext,
    caseId,
    input: {
      expectedDraftTaskId: prepared.purchaseDraft!.id,
      expectedDraftResultHash: prepared.purchaseDraft!.resultHash,
      expectedDraftRevision: 1,
      reason: "Authorize the exact supported order scope.",
    },
  });
  built.purchaseActionApprovalId = purchaseAction.approval.id;
  return built;
}

/** Rewrites the live case projection, which is what post-approval actions recheck. */
async function rewriteCaseResult(caseId: string, mutate: (result: Record<string, unknown>) => void) {
  const procurementCase = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: caseId } });
  const result = record(procurementCase.result);
  mutate(result);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
    await tx.supplyExecutionTask.update({ where: { id: caseId }, data: { result, resultHash: jsonDigest(result) } });
  });
}

type Scenario = {
  id: string;
  action: string;
  kind: "stale" | "unrelated";
  stage: Stage;
  /** Validity windows the case is prepared with. */
  validity?: Validity;
  /** Days of elapsed time between preparing the action and executing it. */
  advanceDays?: number;
  /** Moves state after the action inputs were prepared. */
  mutate?: (built: BuiltCase, noise: Noise) => Promise<void>;
  /** Executes the guarded action. Returns true when the guard refused the action. */
  execute: (built: BuiltCase) => Promise<boolean>;
};

type Noise = { staleCase: BuiltCase; foreignCase: BuiltCase };

/** Reason reported by the last guard refusal, recorded so the results are attributable. */
let lastReason = "";

/** Runs a guarded action and reports whether the guard refused it, by throw or by a blocked result. */
async function guarded(run: () => Promise<boolean>) {
  lastReason = "";
  try {
    return await run();
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const databaseMessage = /message: "([^"]+)"/.exec(raw);
    lastReason = (databaseMessage?.[1] ?? raw).replace(/\s+/g, " ").trim();
    return true;
  }
}

const decideApproval = async (built: BuiltCase) => {
  const decided = await decideProcurementApproval({
    context: built.office.approverContext,
    approvalId: built.approvalId!,
    input: { decision: "APPROVE", note: "Scope and quality plan approved." },
  });
  if (decided.approval.status !== "APPROVED") {
    lastReason = decided.approval.decisionNote ?? `approval ${decided.approval.status}`;
    return true;
  }
  return false;
};

const preparePurchaseOrder = async (built: BuiltCase) => {
  const prepared = await savePurchaseOrderDraft({
    context: built.office.buyerContext,
    caseId: built.caseId,
    input: built.purchaseDraftInput!,
  });
  if (prepared.stale === true || prepared.purchaseDraft === null) {
    lastReason = "case returned to review, no order draft prepared";
    return true;
  }
  return false;
};

const authorizePurchase = async (built: BuiltCase) => {
  const decided = await decidePurchaseActionApproval({
    context: built.office.authorizerContext,
    approvalId: built.purchaseActionApprovalId!,
    input: { decision: "APPROVE", note: "Authorize the approved order scope." },
  });
  if (decided.approval.status !== "APPROVED" || decided.stale === true) {
    lastReason = decided.approval.decisionNote ?? `authorization ${decided.approval.status}`;
    return true;
  }
  return false;
};

const SHORT_QUALIFICATION: Validity = { ...LONG_VALIDITY, qualificationDays: 2 };
const SHORT_QUOTE: Validity = { ...LONG_VALIDITY, quoteValidDays: 2 };
const SHORT_DELIVERY: Validity = { ...LONG_VALIDITY, deliveryDays: 2 };
const SHORT_QUALITY: Validity = { ...LONG_VALIDITY, qualityDays: 2 };
const ELAPSED_DAYS = 3;

const requestQuote = (built: BuiltCase) => guarded(async () => {
  await saveSupplierQuoteRequest({
    context: built.office.buyerContext,
    caseId: built.caseId,
    input: built.quoteRequestInput,
  });
  return false;
});

const releaseQuote = (built: BuiltCase) => guarded(async () => {
  await recordSupplierQuoteRelease({
    context: built.office.buyerContext,
    quoteCycleId: built.quoteCycleId!,
    // The release is recorded on the day the outreach actually leaves, which is when the guard runs.
    input: { ...built.quoteReleaseInput!, releasedOn: futureDate(0) },
  });
  return false;
});

const scenarios: Scenario[] = [
  {
    id: "quote_request.qualification_expired",
    action: "saveSupplierQuoteRequest",
    kind: "stale",
    stage: "QUALIFIED",
    validity: SHORT_QUALIFICATION,
    advanceDays: ELAPSED_DAYS,
    execute: requestQuote,
  },
  {
    id: "quote_request.selection_changed",
    action: "saveSupplierQuoteRequest",
    kind: "stale",
    stage: "QUALIFIED",
    mutate: async (built) => {
      built.quoteRequestInput.expectedSelectionHash = `${built.selectionHash}-moved`;
    },
    execute: requestQuote,
  },
  {
    id: "quote_request.unrelated_case_expired",
    action: "saveSupplierQuoteRequest",
    kind: "unrelated",
    stage: "QUALIFIED",
    advanceDays: ELAPSED_DAYS,
    execute: requestQuote,
  },
  {
    id: "quote_release.qualification_expired",
    action: "recordSupplierQuoteRelease",
    kind: "stale",
    stage: "QUOTE_DRAFTED",
    validity: SHORT_QUALIFICATION,
    advanceDays: ELAPSED_DAYS,
    execute: releaseQuote,
  },
  {
    id: "quote_release.request_hash_moved",
    action: "recordSupplierQuoteRelease",
    kind: "stale",
    stage: "QUOTE_DRAFTED",
    mutate: async (built) => {
      built.quoteReleaseInput!.expectedRequestHash = `${built.requestHash}-moved`;
    },
    execute: releaseQuote,
  },
  {
    id: "quote_release.time_elapsed_inside_validity",
    action: "recordSupplierQuoteRelease",
    kind: "unrelated",
    stage: "QUOTE_DRAFTED",
    advanceDays: ELAPSED_DAYS,
    execute: releaseQuote,
  },
  {
    id: "approval.qualification_expired",
    action: "decideProcurementApproval",
    kind: "stale",
    stage: "APPROVAL_REQUESTED",
    validity: SHORT_QUALIFICATION,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => decideApproval(built)),
  },
  {
    id: "approval.supplier_quote_expired",
    action: "decideProcurementApproval",
    kind: "stale",
    stage: "APPROVAL_REQUESTED",
    validity: SHORT_QUOTE,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => decideApproval(built)),
  },
  {
    id: "approval.delivery_date_passed",
    action: "decideProcurementApproval",
    kind: "stale",
    stage: "APPROVAL_REQUESTED",
    validity: SHORT_DELIVERY,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => decideApproval(built)),
  },
  {
    id: "approval.quality_evidence_expired",
    action: "decideProcurementApproval",
    kind: "stale",
    stage: "APPROVAL_REQUESTED",
    validity: SHORT_QUALITY,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => decideApproval(built)),
  },
  {
    id: "approval.case_scope_moved",
    action: "decideProcurementApproval",
    kind: "stale",
    stage: "APPROVAL_REQUESTED",
    mutate: async (built) => {
      await rewriteCaseResult(built.caseId, (result) => {
        const approval = record(result.approval);
        approval.scopeHash = `${approval.scopeHash}-moved`;
        result.approval = approval;
      });
    },
    execute: (built) => guarded(() => decideApproval(built)),
  },
  {
    id: "approval.frozen_scope_rewrite_attempt",
    action: "supplyExecutionTask.update",
    kind: "stale",
    stage: "APPROVAL_REQUESTED",
    execute: (built) => guarded(async () => {
      const task = await prisma.supplyExecutionTask.findUniqueOrThrow({ where: { id: built.approvalTaskId! } });
      const input = record(task.input);
      (input.confirmedTerms as Record<string, unknown>).price = 1;
      await prisma.supplyExecutionTask.update({ where: { id: built.approvalTaskId! }, data: { input } });
      return false;
    }),
  },
  {
    id: "approval.unrelated_case_expired",
    action: "decideProcurementApproval",
    kind: "unrelated",
    stage: "APPROVAL_REQUESTED",
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => decideApproval(built)),
  },
  {
    id: "approval.case_history_appended",
    action: "decideProcurementApproval",
    kind: "unrelated",
    stage: "APPROVAL_REQUESTED",
    mutate: async (built) => {
      const latest = await prisma.supplyExecutionEvent.findFirst({
        where: { executionTaskId: built.caseId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      await prisma.supplyExecutionEvent.create({
        data: {
          officeId: built.office.officeId,
          workspaceId: built.office.workspaceId,
          executionTaskId: built.caseId,
          sequence: (latest?.sequence ?? 0) + 1,
          eventType: "NOTE_RECORDED",
          message: "Buyer added an unrelated operating note while the approval was pending.",
        },
      });
    },
    execute: (built) => guarded(() => decideApproval(built)),
  },
  {
    id: "purchase_order.qualification_expired",
    action: "savePurchaseOrderDraft",
    kind: "stale",
    stage: "APPROVED",
    validity: SHORT_QUALIFICATION,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => preparePurchaseOrder(built)),
  },
  {
    id: "purchase_order.supplier_quote_expired",
    action: "savePurchaseOrderDraft",
    kind: "stale",
    stage: "APPROVED",
    validity: SHORT_QUOTE,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => preparePurchaseOrder(built)),
  },
  {
    id: "purchase_order.delivery_date_passed",
    action: "savePurchaseOrderDraft",
    kind: "stale",
    stage: "APPROVED",
    validity: SHORT_DELIVERY,
    advanceDays: ELAPSED_DAYS,
    // A live need-by date keeps the refusal attributable to the approved delivery date, not to input validation.
    mutate: async (built) => {
      built.purchaseDraftInput!.needBy = futureDate(ELAPSED_DAYS + 30);
    },
    execute: (built) => guarded(() => preparePurchaseOrder(built)),
  },
  {
    id: "purchase_order.quality_evidence_expired",
    action: "savePurchaseOrderDraft",
    kind: "stale",
    stage: "APPROVED",
    validity: SHORT_QUALITY,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => preparePurchaseOrder(built)),
  },
  {
    id: "purchase_order.approval_scope_moved",
    action: "savePurchaseOrderDraft",
    kind: "stale",
    stage: "APPROVED",
    mutate: async (built) => {
      built.purchaseDraftInput!.expectedApprovalScopeHash = `${built.scopeHash}-moved`;
    },
    execute: (built) => guarded(() => preparePurchaseOrder(built)),
  },
  {
    id: "purchase_order.concurrent_revision",
    action: "savePurchaseOrderDraft",
    kind: "stale",
    stage: "APPROVED",
    mutate: async (built) => {
      await savePurchaseOrderDraft({
        context: built.office.buyerContext,
        caseId: built.caseId,
        input: built.purchaseDraftInput!,
      });
      await savePurchaseOrderDraft({
        context: built.office.buyerContext,
        caseId: built.caseId,
        input: { ...built.purchaseDraftInput!, expectedRevision: 1, quantity: 9 },
      });
    },
    execute: (built) => guarded(() => preparePurchaseOrder(built)),
  },
  {
    id: "purchase_order.unrelated_case_expired",
    action: "savePurchaseOrderDraft",
    kind: "unrelated",
    stage: "APPROVED",
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => preparePurchaseOrder(built)),
  },
  {
    id: "purchase_action.approval_expired",
    action: "decidePurchaseActionApproval",
    kind: "stale",
    stage: "PURCHASE_ACTION_REQUESTED",
    validity: SHORT_QUOTE,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => authorizePurchase(built)),
  },
  {
    id: "purchase_action.qualification_expired",
    action: "decidePurchaseActionApproval",
    kind: "stale",
    stage: "PURCHASE_ACTION_REQUESTED",
    validity: SHORT_QUALIFICATION,
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => authorizePurchase(built)),
  },
  {
    id: "purchase_action.draft_revised_after_request",
    action: "decidePurchaseActionApproval",
    kind: "stale",
    stage: "PURCHASE_ACTION_REQUESTED",
    mutate: async (built) => {
      await savePurchaseOrderDraft({
        context: built.office.buyerContext,
        caseId: built.caseId,
        input: { ...built.purchaseDraftInput!, expectedRevision: 1, quantity: 11 },
      });
    },
    execute: (built) => guarded(() => authorizePurchase(built)),
  },
  {
    id: "purchase_action.time_elapsed_inside_validity",
    action: "decidePurchaseActionApproval",
    kind: "unrelated",
    stage: "PURCHASE_ACTION_REQUESTED",
    advanceDays: ELAPSED_DAYS,
    execute: (built) => guarded(() => authorizePurchase(built)),
  },
];

type Measurement = {
  scenario: string;
  action: string;
  kind: "stale" | "unrelated";
  blocked: boolean;
  reason: string;
  ms: number;
};

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

async function main() {
  try {
    const office = await makeOffice("primary");
    officeId = office.officeId;
    const foreignOffice = await makeOffice("foreign");
    otherOfficeId = foreignOffice.officeId;
    const noise: Noise = {
      staleCase: await buildCase(office, "APPROVAL_REQUESTED", SHORT_QUALIFICATION),
      foreignCase: await buildCase(foreignOffice, "APPROVAL_REQUESTED", SHORT_QUALIFICATION),
    };

    const measurements: Measurement[] = [];
    for (const scenario of scenarios) {
      for (let repeat = 0; repeat < REPEATS; repeat += 1) {
        const built = await buildCase(office, scenario.stage, scenario.validity);
        await scenario.mutate?.(built, noise);
        if (scenario.advanceDays) advanceClock(scenario.advanceDays);
        const startedAt = performance.now();
        let blocked = false;
        try {
          blocked = await scenario.execute(built);
        } finally {
          resetClock();
        }
        const ms = performance.now() - startedAt;
        measurements.push({ scenario: scenario.id, action: scenario.action, kind: scenario.kind, blocked, reason: lastReason, ms });
      }
    }

    const stale = measurements.filter((entry) => entry.kind === "stale");
    const unrelated = measurements.filter((entry) => entry.kind === "unrelated");
    const detected = stale.filter((entry) => entry.blocked);
    const escaped = stale.filter((entry) => !entry.blocked);
    const falseConflicts = unrelated.filter((entry) => entry.blocked);
    const latencies = measurements.map((entry) => entry.ms);

    const byScenario = new Map<string, Measurement[]>();
    for (const entry of measurements) {
      const bucket = byScenario.get(entry.scenario) ?? [];
      bucket.push(entry);
      byScenario.set(entry.scenario, bucket);
    }

    console.log("\nstate recheck results");
    console.log("scenario".padEnd(46), "kind".padEnd(10), "blocked", " p50 ms", " refusal reason");
    for (const [scenarioId, entries] of byScenario) {
      const blocked = entries.filter((entry) => entry.blocked).length;
      console.log(
        scenarioId.padEnd(46),
        entries[0]!.kind.padEnd(10),
        `${blocked}/${entries.length}`.padEnd(7),
        percentile(entries.map((entry) => entry.ms), 0.5).toFixed(1).padStart(7),
        entries[0]!.reason.slice(0, 70),
      );
    }
    console.log(`\nstale executions detected: ${detected.length}/${stale.length}`);
    console.log(`stale actions escaped: ${escaped.length}`);
    console.log(`false conflicts on unrelated changes: ${falseConflicts.length}/${unrelated.length}`);
    console.log(`guarded action latency p50: ${percentile(latencies, 0.5).toFixed(1)}ms, p95: ${percentile(latencies, 0.95).toFixed(1)}ms`);

    assert.equal(
      escaped.length,
      0,
      `stale actions escaped the guard: ${[...new Set(escaped.map((entry) => entry.scenario))].join(", ")}`,
    );
    assert.equal(
      falseConflicts.length,
      0,
      `unrelated changes were treated as conflicts: ${[...new Set(falseConflicts.map((entry) => entry.scenario))].join(", ")}`,
    );
    assert.ok(stale.length >= scenarios.filter((entry) => entry.kind === "stale").length, "every stale scenario must run");

    console.log("\nstate-recheck.test.ts passed");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
