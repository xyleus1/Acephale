import type { SavedProcurementCase } from "@/app/dashboard/supply-os/supply-os-sourcing-research-types";

export type BuyerRecommendation = {
  state: "REVIEW_REQUIRED" | "AWAITING_APPROVAL" | "READY_TO_ISSUE" | "AWAITING_ACKNOWLEDGMENT" | "EXCEPTION_REVIEW" | "HANDOFF_READY";
  title: string;
  detail: string;
  nextAction: string;
  canCreatePaymentHandoff: boolean;
};

// This is intentionally deterministic. The agent can explain the current
// buying state but it cannot manufacture commercial facts or bypass gates.
export function buyerRecommendation(procurementCase: SavedProcurementCase): BuyerRecommendation {
  const result = procurementCase.result;
  const purchaseAction = procurementCase.purchaseAction;
  const release = purchaseAction?.result?.state === "RELEASED"
    || purchaseAction?.result?.state === "PARTIALLY_ACKNOWLEDGED"
    || purchaseAction?.result?.state === "ACKNOWLEDGED"
    ? purchaseAction.result
    : null;

  if (!result) {
    return {
      state: "REVIEW_REQUIRED",
      title: "Review procurement case",
      detail: "The buying workflow needs an operator review before the next commitment.",
      nextAction: "Open procurement",
      canCreatePaymentHandoff: false,
    };
  }

  if (result.sourcingReturn?.state === "REQUIRED") {
    return {
      state: "EXCEPTION_REVIEW",
      title: "Return to sourcing",
      detail: "The supplier rejected the released order. Select and qualify another supplier before issuing a replacement.",
      nextAction: "Review alternatives",
      canCreatePaymentHandoff: false,
    };
  }

  if (release?.supplierOrderExceptions?.some((entry) => entry.status === "OPEN_REVIEW" || entry.status === "REVISION_REQUIRED" || entry.status === "REVISION_DRAFTED")) {
    return {
      state: "EXCEPTION_REVIEW",
      title: "Supplier terms changed",
      detail: "A supplier exception blocks normal acceptance until it is resolved or a replacement order is authorized.",
      nextAction: "Review exception",
      canCreatePaymentHandoff: false,
    };
  }

  if (release?.state === "ACKNOWLEDGED") {
    return {
      state: "HANDOFF_READY",
      title: "Accepted order ready",
      detail: "The supplier accepted the full authorized quantity. The customer can now begin payment and logistics through their own approved systems.",
      nextAction: "Prepare customer handoff",
      canCreatePaymentHandoff: true,
    };
  }

  if (release?.state === "PARTIALLY_ACKNOWLEDGED") {
    return {
      state: "AWAITING_ACKNOWLEDGMENT",
      title: "Partial acceptance",
      detail: `${release.remainingQuantity} ${release.unitOfMeasure} remains unaccepted. Keep the order thread open until the full authorized quantity is confirmed.`,
      nextAction: "Follow up with supplier",
      canCreatePaymentHandoff: false,
    };
  }

  if (release?.state === "RELEASED") {
    return {
      state: "AWAITING_ACKNOWLEDGMENT",
      title: "Awaiting supplier acknowledgment",
      detail: "The exact authorized order was released. Capture the supplier's acceptance or any changed terms from the order thread.",
      nextAction: "Check order thread",
      canCreatePaymentHandoff: false,
    };
  }

  if (purchaseAction?.approval?.status === "APPROVED") {
    return {
      state: "READY_TO_ISSUE",
      title: "Ready to issue",
      detail: "The supplier, terms, quantity, and destination are frozen under final approval. Prepare the separate approved PO email for delivery.",
      nextAction: "Prepare PO delivery",
      canCreatePaymentHandoff: false,
    };
  }

  if (purchaseAction?.approval?.status === "PENDING" || result.stage === "APPROVAL_PENDING") {
    return {
      state: "AWAITING_APPROVAL",
      title: "Approval required",
      detail: "A human approver must decide the exact supplier or order scope before Derya can continue.",
      nextAction: "Request or decide approval",
      canCreatePaymentHandoff: false,
    };
  }

  const stageDetails: Record<string, BuyerRecommendation> = {
    SOURCE_EVIDENCE: { state: "REVIEW_REQUIRED", title: "Qualify supplier", detail: "Confirm supplier identity, capability, and relationship from attributable evidence.", nextAction: "Review supplier evidence", canCreatePaymentHandoff: false },
    COMMERCIAL_CONFIRMATION: { state: "REVIEW_REQUIRED", title: "Confirm quote", detail: "Record a supplier quote with price, unit, MOQ, delivery, validity, and evidence.", nextAction: "Review quote", canCreatePaymentHandoff: false },
    QUALITY_REVIEW: { state: "REVIEW_REQUIRED", title: "Verify quality", detail: "Record a passing sample, inspection, or document review for this exact supplier award.", nextAction: "Record quality verification", canCreatePaymentHandoff: false },
    APPROVAL: { state: "AWAITING_APPROVAL", title: "Request award approval", detail: "The qualified supplier and reviewed commercial scope are ready for manager approval.", nextAction: "Request award approval", canCreatePaymentHandoff: false },
    PURCHASE_READY: { state: "REVIEW_REQUIRED", title: "Prepare purchase order", detail: "Create the internal order draft before final purchase authorization.", nextAction: "Prepare order", canCreatePaymentHandoff: false },
  };
  return stageDetails[result.stage] ?? {
    state: "REVIEW_REQUIRED",
    title: "Review procurement case",
    detail: "The buying workflow needs an operator review before the next commitment.",
    nextAction: "Open procurement",
    canCreatePaymentHandoff: false,
  };
}
