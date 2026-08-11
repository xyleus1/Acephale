type PublicEvidence<T> = {
  value: T | null;
  state: "SUPPORTED" | "PARTIAL" | "INFERRED" | "UNKNOWN";
  sources: Array<{ url: string; sourceType: "OFFICIAL" | "PUBLIC" | "QUOTE" | "AUTHORITY" }>;
  observedAt: string | null;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};

export type PublicResearchCandidate = {
  id: string;
  companyName: string;
  website: string | null;
  roles: string[];
  country: PublicEvidence<string>;
  facility: PublicEvidence<string>;
  productCapability: PublicEvidence<string>;
  price: PublicEvidence<number>;
  currency: PublicEvidence<string>;
  minimumOrderQuantity: PublicEvidence<number>;
  leadTimeDays: PublicEvidence<number>;
  sourceUrls: string[];
  status: string;
  cautions: string[];
};

export type PublicResearchResult = {
  candidates: PublicResearchCandidate[];
  degraded: boolean;
  warnings: string[];
};

export type SavedSourcingResearchRun = {
  id: string;
  status: string;
  input: {
    componentItemKey: string;
    componentName: string;
    manufacturer: string | null;
    mpn: string | null;
    specification: string | null;
    targetCountry: string | null;
    requestText: string;
    requestedQuantity?: number | null;
    requestedUnit?: string | null;
    sourceRegion?: string | null;
    deliveryLocation?: string | null;
    needByDate?: string | null;
  };
  output: PublicResearchResult | null;
  createdAt: string;
  completedAt: string | null;
};

export type SourcingQueuePage = {
  nextCursor: string | null;
};

export type SupplierSenderAccount = {
  id: string;
  email: string;
  provider: "GMAIL";
};

type SupplierEmailApproval = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  requiredRole: "MANAGER";
  scopeHash: string;
  requestReason: string | null;
  requestedByUserId: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
};

type SupplierEmailMessage = {
  senderAccountId: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  body: string;
};

export type ConnectedSupplierReply = {
  evidenceId: string;
  evidenceClass: "CONNECTED_PROVIDER";
  sourceRecordId: string;
  localMessageId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  excerpt: string;
  attachments: Array<{ name: string; mimeType: string | null; size: number | null }>;
  receivedAt: string;
  sourceUrl: string;
  reviewState: "REVIEW_REQUIRED";
};

export type SavedProcurementCase = {
  id: string;
  status: string;
  taskKey: string;
  input: {
    researchRunId: string;
    researchInput: SavedSourcingResearchRun["input"];
    supplierId?: string;
  };
  result: {
    stage: "SOURCE_EVIDENCE" | "SUPPLIER_REJECTED" | "COMMERCIAL_CONFIRMATION" | "QUALITY_REVIEW" | "APPROVAL" | "APPROVAL_PENDING" | "PURCHASE_READY";
    selectedOption: {
      id: string;
      name: string;
      sourceClass: "Official" | "Trusted" | "New";
      sourceUrl: string | null;
      price: number | null;
      currency: string | null;
      minimumOrderQuantity: number | null;
      priceType: "Modeled" | "Sourced" | "Unknown";
      deliveryDate: string | null;
      deliveryType: "Modeled" | "Sourced" | "Unknown";
      quality: "Strong" | "Conditional" | "Unverified";
    };
    gates: {
      sourceEvidence: "EVIDENCE_COMPLETE" | "REVIEW_REQUIRED" | "BLOCKED";
      commercialTerms: "EVIDENCE_COMPLETE" | "REVIEW_REQUIRED";
      qualityPlan: "EVIDENCE_COMPLETE" | "REVIEW_REQUIRED";
      purchaseApproval: "BLOCKED" | "PENDING" | "APPROVED" | "REJECTED";
    };
    evidenceState?: { commercialTerms?: "EVIDENCE_COMPLETE" | "REVIEW_REQUIRED" };
    confirmedTerms?: {
      price: number;
      currency: string;
      minimumOrderQuantity: number;
      unitOfMeasure: string;
      deliveryDate: string;
      evidenceUrl: string;
      evidenceId?: string;
      quoteReference: string;
      validUntil: string;
      quoteCycleTaskId: string;
      responseHash: string;
      evidenceClass: "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER";
    };
    qualityPlan?: {
      method: "SAMPLE" | "PRE_SHIPMENT_INSPECTION" | "DOCUMENT_REVIEW";
      acceptanceCriteria: string;
      owner: string;
      targetDate: string;
    };
    reviews?: {
      sourceEvidence?: {
        sourceUrl: string | null;
        evidenceId?: string;
        outcome: "QUALIFIED" | "REJECTED";
        relationship?: "MANUFACTURER" | "AUTHORIZED_DISTRIBUTOR" | "INDEPENDENT_DISTRIBUTOR";
        identityEvidenceUrl?: string;
        capabilityEvidenceUrl?: string;
        authorizationEvidenceUrl?: string | null;
        validUntil?: string;
        rejectionReason?: "IDENTITY_UNRESOLVED" | "CAPABILITY_UNRESOLVED" | "AUTHORIZATION_UNRESOLVED" | "SOURCE_UNVERIFIABLE" | "OTHER";
        note: string;
        reviewedAt: string;
        reviewHash: string;
      };
      commercialTerms?: { reviewedAt: string; reviewHash: string };
      qualityPlan?: { reviewedAt: string; reviewHash: string };
    };
    approval?: {
      id: string;
      taskId: string;
      scopeHash: string;
      status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
      requestedAt: string;
      decidedAt?: string;
      decisionNote?: string | null;
    } | null;
    purchasePreparation?: {
      draftTaskId: string;
      state: "DRAFT";
      revision: number;
      orderHash: string;
    };
    purchaseAuthorization?: {
      actionTaskId: string;
      approvalId: string;
      scopeHash: string;
      status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "RELEASED" | "PARTIALLY_ACKNOWLEDGED" | "ACKNOWLEDGED";
      draftTaskId: string;
      draftRevision: number;
      decidedByUserId?: string;
      decidedAt?: string;
      decisionNote?: string | null;
    };
    purchaseRelease?: {
      state: "RELEASED" | "PARTIALLY_ACKNOWLEDGED" | "ACKNOWLEDGED";
      orderedQuantity: string;
      acknowledgedQuantity: string;
      remainingQuantity: string;
      unitOfMeasure: string;
      release?: {
        actionScopeHash: string;
        channel: "EMAIL" | "SUPPLIER_PORTAL" | "EDI" | "PHONE_CONFIRMED" | "OTHER";
        releasedOn: string;
        acknowledgmentDueOn: string;
        purchaseOrderReference: string;
        evidenceUrl: string;
        evidenceId: string;
        note: string | null;
        releaseHash: string;
        recordedByUserId: string;
        recordedAt: string;
      };
      lastSupplierOrderReference?: string;
      lastConfirmedDeliveryDate?: string;
      updatedAt: string;
    };
    quoteCycle?: {
      taskId: string;
      state: "DRAFT" | "AWAITING_RESPONSE" | "RESPONSES_RECEIVED" | "RESPONSE_SELECTED";
      revision: number;
      requestHash: string;
      responseCount: number;
      releasedOn?: string;
      lastQuoteReference?: string;
      selectedResponseHash?: string;
      connectedReplyCount?: number;
      updatedAt: string;
    };
    selectionHash: string;
    updatedAt: string;
  } | null;
  quoteCycle?: {
    id: string;
    status: "PLANNED" | "RUNNING" | "CANCELLED";
    taskKey: string;
    taskType: "SUPPLIER_QUOTE_CYCLE";
    capabilityKey: "record.supplier_quote_cycle";
    input: {
      procurementCaseId: string;
      selectionHash: string;
      supplier: { id: string; name: string; sourceUrl: string | null };
    };
    resultHash: string | null;
    result: {
      state: "DRAFT" | "AWAITING_RESPONSE" | "RESPONSES_RECEIVED" | "RESPONSE_SELECTED";
      revision: number;
      request: {
        quantity: string;
        unitOfMeasure: string;
        needBy: string;
        shipTo: string;
        responseDue: string;
        requirements: string;
        note: string | null;
      };
      requestHash: string;
      release?: {
        channel: "EMAIL" | "SUPPLIER_PORTAL" | "EDI" | "PHONE_CONFIRMED" | "OTHER";
        releasedOn: string;
        evidenceUrl: string;
        evidenceId?: string;
        note: string | null;
        releaseHash: string;
        evidenceClass: "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER";
        recordedByUserId: string;
        recordedAt: string;
      } | null;
      responses: Array<{
        receivedOn: string;
        price: string;
        currency: string;
        minimumOrderQuantity: string;
        unitOfMeasure: string;
        deliveryDate: string;
        quoteReference: string;
        validUntil: string;
        evidenceUrl: string;
        evidenceId?: string;
        note: string | null;
        responseHash: string;
        connectedReplyEvidenceId?: string | null;
        evidenceClass: "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER";
        recordedByUserId: string;
        recordedAt: string;
      }>;
      connectedReplies?: ConnectedSupplierReply[];
      lastReplySyncAt?: string;
      selectedResponseHash: string | null;
      externalSideEffect: false | "RECORDED_ONLY" | "CONNECTED_PROVIDER";
      updatedAt: string;
    } | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  supplierEmailDraft?: {
    id: string;
    status: "PLANNED" | "BLOCKED" | "READY" | "RUNNING" | "SUCCEEDED" | "CANCELLED";
    resultHash: string | null;
    result: {
      revision: number;
      message: SupplierEmailMessage;
      messageHash: string;
      approval: { id: string; actionId: string; status: SupplierEmailApproval["status"] } | null;
      updatedAt: string;
    } | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  supplierEmailAction?: {
    id: string;
    status: "PLANNED" | "BLOCKED" | "READY" | "RUNNING" | "SUCCEEDED" | "CANCELLED";
    input: {
      procurementCaseId: string;
      quoteCycleId: string;
      draftId: string;
      draftRevision: number;
      draftMessageHash: string;
      message: SupplierEmailMessage;
    };
    inputHash: string;
    result: {
      state: "APPROVED" | "REJECTED" | "SENDING" | "SEND_FAILED" | "DELIVERY_UNKNOWN" | "NOT_FOUND_REVIEW_REQUIRED" | "RETRY_READY" | "SENT";
      attempt?: number;
      rfcMessageId?: string;
      error?: string;
      sourceUrl?: string;
      evidenceId?: string;
      sentAt?: string;
    } | null;
    approval: SupplierEmailApproval | null;
    externalSystem: string | null;
    externalRef: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  purchaseOrderEmailDraft?: {
    id: string;
    status: "PLANNED" | "BLOCKED" | "READY" | "RUNNING" | "SUCCEEDED" | "CANCELLED";
    resultHash: string | null;
    result: {
      revision: number;
      message: SupplierEmailMessage;
      issuance: {
        purchaseOrderReference: string;
        acknowledgmentDueOn: string;
        note: string | null;
      };
      messageHash: string;
      approval: { id: string; actionId: string; status: SupplierEmailApproval["status"] } | null;
      updatedAt: string;
    } | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  purchaseOrderEmailAction?: {
    id: string;
    status: "PLANNED" | "BLOCKED" | "READY" | "RUNNING" | "SUCCEEDED" | "CANCELLED";
    input: {
      procurementCaseId: string;
      purchaseDraftId: string;
      purchaseActionId: string;
      purchaseActionScopeHash: string;
      draftId: string;
      draftRevision: number;
      draftMessageHash: string;
      message: SupplierEmailMessage;
      issuance: {
        purchaseOrderReference: string;
        acknowledgmentDueOn: string;
        note: string | null;
      };
    };
    inputHash: string;
    result: {
      state: "APPROVED" | "REJECTED" | "SENDING" | "SEND_FAILED" | "DELIVERY_UNKNOWN" | "NOT_FOUND_REVIEW_REQUIRED" | "RETRY_READY" | "SENT";
      attempt?: number;
      rfcMessageId?: string;
      error?: string;
      sourceUrl?: string;
      evidenceId?: string;
      releaseHash?: string;
      sentAt?: string;
    } | null;
    approval: SupplierEmailApproval | null;
    externalSystem: string | null;
    externalRef: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  purchaseDraft?: {
    id: string;
    status: string;
    taskKey: string;
    input: {
      procurementCaseId: string;
      procurementApprovalId: string;
      procurementApprovalScopeHash: string;
    };
    resultHash: string | null;
    result: {
      revision: number;
      state: "DRAFT";
      order: {
        quantity: string;
        unitOfMeasure: string;
        needBy: string;
        shipTo: string;
        incoterm: "EXW" | "FCA" | "FOB" | "CPT" | "CIP" | "DAP" | "DDP";
        paymentTerms: string;
        buyerReference: string | null;
        notes: string | null;
      };
      orderHash: string;
      supplier: { id: string; name: string; sourceUrl: string | null };
      commercial: {
        unitPrice: string;
        currency: string;
        minimumOrderQuantity: string;
        quoteReference: string;
        quoteValidUntil: string;
        deliveryDate: string;
        quoteCycleTaskId: string;
        quoteResponseHash: string;
        quoteEvidenceUrl: string;
        quoteEvidenceId?: string | null;
        evidenceClass: "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER";
      };
      totals: { materialSubtotal: string; currency: string };
      approvedProcurementScope: { approvalId: string; scopeHash: string };
      updatedAt: string;
    } | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  purchaseAction?: {
    id: string;
    status: "PLANNED" | "BLOCKED" | "READY" | "RUNNING" | "SUCCEEDED" | "CANCELLED";
    taskKey: string;
    taskType: "PURCHASE_ORDER_ACTION";
    capabilityKey: "authorize.purchase_order";
    input: {
      action: "PLACE_ORDER";
      procurementCaseId: string;
      purchaseDraftId: string;
      purchaseDraftRevision: number;
      purchaseDraftResultHash: string;
      order: {
        quantity: string;
        unitOfMeasure: string;
        needBy: string;
        shipTo: string;
        incoterm: "EXW" | "FCA" | "FOB" | "CPT" | "CIP" | "DAP" | "DDP";
        paymentTerms: string;
        buyerReference: string | null;
        notes: string | null;
      };
      supplier: { id: string; name: string; sourceUrl: string | null };
      commercial: {
        unitPrice: string;
        currency: string;
        minimumOrderQuantity: string;
        quoteReference: string;
        quoteValidUntil: string;
        deliveryDate: string;
        quoteCycleTaskId: string;
        quoteResponseHash: string;
        quoteEvidenceUrl: string;
        quoteEvidenceId?: string | null;
        evidenceClass: "OPERATOR_RECORDED_EXTERNAL" | "CONNECTED_PROVIDER";
      };
      totals: { materialSubtotal: string; currency: string };
      procurementApproval: { id: string; scopeHash: string };
      sourceEvidenceReview: Record<string, unknown>;
      qualityPlan: {
        method: "SAMPLE" | "PRE_SHIPMENT_INSPECTION" | "DOCUMENT_REVIEW";
        acceptanceCriteria: string;
        owner: string;
        targetDate: string;
      };
    };
    inputHash: string;
    result: ({
      state: "AUTHORIZED" | "REJECTED";
      approvalId: string;
      scopeHash: string;
      decidedByUserId: string;
      decidedAt: string;
      decisionNote: string | null;
      externalSideEffect: false;
    } | {
      state: "RELEASED" | "PARTIALLY_ACKNOWLEDGED" | "ACKNOWLEDGED";
      authorization: {
        approvalId: string;
        scopeHash: string;
        decidedByUserId: string | null;
        decidedAt: string | null;
      };
      release: {
        actionScopeHash: string;
        channel: "EMAIL" | "SUPPLIER_PORTAL" | "EDI" | "PHONE_CONFIRMED" | "OTHER";
        releasedOn: string;
        acknowledgmentDueOn: string;
        purchaseOrderReference: string;
        evidenceUrl: string;
        evidenceId: string;
        note: string | null;
        releaseHash: string;
        recordedByUserId: string;
        recordedAt: string;
      };
      orderedQuantity: string;
      acknowledgedQuantity: string;
      remainingQuantity: string;
      unitOfMeasure: string;
      acknowledgments: Array<{
        releaseHash: string;
        releaseChannel: "EMAIL" | "SUPPLIER_PORTAL" | "EDI" | "PHONE_CONFIRMED" | "OTHER";
        releasedOn: string;
        acknowledgmentDueOn: string;
        acknowledgedOn: string;
        supplierOrderReference: string;
        acceptedQuantity: string;
        unitOfMeasure: string;
        confirmedDeliveryDate: string;
        evidenceUrl: string;
        evidenceId?: string;
        note: string | null;
        acknowledgmentHash: string;
        recordedByUserId: string;
        recordedAt: string;
      }>;
      totals: { acknowledgedMaterialValue: string; currency: string };
      lastAcknowledgment?: {
        supplierOrderReference: string;
        acceptedQuantity: string;
        confirmedDeliveryDate: string;
        evidenceUrl: string;
        evidenceId?: string;
      };
      externalSideEffect: "RECORDED_ONLY";
      updatedAt: string;
    }) | null;
    approval: {
      id: string;
      status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
      requiredRole: "ADMIN";
      scopeHash: string;
      requestReason: string;
      requestedByUserId: string | null;
      decidedByUserId: string | null;
      decisionNote: string | null;
      requestedAt: string;
      decidedAt: string | null;
      expiresAt: string | null;
    } | null;
    externalSystem: null;
    externalRef: null;
    createdAt: string;
    updatedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};
