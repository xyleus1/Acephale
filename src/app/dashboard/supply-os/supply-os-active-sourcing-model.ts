import type { CustomerProcurementListItem } from "@/lib/supply-os/customer-procurement";
import type {
  CustomerProcurementRequestDetail,
  CustomerProcurementVendor,
} from "@/lib/supply-os/customer-procurement-status";
import type {
  SavedProcurementCase,
  SavedSourcingResearchRun,
} from "./supply-os-sourcing-research-types";

export type HistoricalSourcingGroup = {
  id: string;
  title: string;
  itemKey: string;
  requestText: string;
  updatedAt: string;
  run: SavedSourcingResearchRun | null;
  cases: SavedProcurementCase[];
  supplierCount: number;
  contactedCount: number;
  responseCount: number;
  poReadyCount: number;
};

export function historicalSupplierContacted(procurementCase: SavedProcurementCase) {
  return procurementCase.supplierEmailAction?.result?.state === "SENT"
    || Boolean(procurementCase.quoteCycle?.result?.release);
}

export function historicalSupplierResponded(procurementCase: SavedProcurementCase) {
  return historicalResponseCount(procurementCase) > 0;
}

export function historicalResponseCount(procurementCase: SavedProcurementCase) {
  return procurementCase.quoteCycle?.result?.connectedReplies?.length
    || procurementCase.quoteCycle?.result?.responses.length
    || 0;
}

export function historicalSourcingActive(procurementCase: SavedProcurementCase) {
  return procurementCase.result?.purchaseRelease?.state !== "ACKNOWLEDGED"
    && procurementCase.result?.stage !== "SUPPLIER_REJECTED";
}

export function historicalPoReady(procurementCase: SavedProcurementCase) {
  return procurementCase.result?.stage === "PURCHASE_READY"
    || procurementCase.purchaseAction?.approval?.status === "APPROVED"
    || procurementCase.purchaseOrderEmailAction?.approval?.status === "APPROVED"
    || procurementCase.purchaseOrderEmailAction?.result?.state === "SENT"
    || Boolean(procurementCase.result?.purchaseRelease);
}

export function historicalPoState(procurementCase: SavedProcurementCase) {
  if (procurementCase.result?.purchaseRelease?.state === "ACKNOWLEDGED") return "Supplier acknowledged";
  if (procurementCase.result?.purchaseRelease?.state === "PARTIALLY_ACKNOWLEDGED") return "Partially acknowledged";
  if (procurementCase.result?.purchaseRelease?.state === "RELEASED") return "Purchase order sent";
  if (procurementCase.purchaseOrderEmailAction?.result?.state === "SENT") return "Purchase order sent";
  if (procurementCase.purchaseOrderEmailAction?.approval?.status === "APPROVED") return "Ready to send PO";
  if (procurementCase.purchaseAction?.approval?.status === "APPROVED") return "Ready to prepare PO";
  if (procurementCase.purchaseAction?.approval?.status === "PENDING") return "PO approval pending";
  if (procurementCase.purchaseDraft) return "PO draft ready";
  if (procurementCase.result?.stage === "PURCHASE_READY") return "Ready to prepare PO";
  if (procurementCase.result?.stage === "APPROVAL_PENDING") return "Supplier approval pending";
  if (procurementCase.result?.stage === "APPROVAL") return "Ready for supplier approval";
  return "Not ready for PO";
}

export function historicalSituation(procurementCase: SavedProcurementCase) {
  if (procurementCase.result?.sourcingReturn?.state === "REQUIRED") return procurementCase.result.sourcingReturn.reason;
  if (procurementCase.result?.purchaseRelease?.openSupplierExceptionCount) return "Supplier changed the authorized order. Review the exception before continuing.";
  if (procurementCase.result?.purchaseRelease?.state === "ACKNOWLEDGED") return "The supplier accepted the released order. The sourcing workstream is complete.";
  if (procurementCase.result?.purchaseRelease?.state === "PARTIALLY_ACKNOWLEDGED") return "The supplier accepted part of the order. The remaining quantity is still open.";
  if (procurementCase.result?.purchaseRelease?.state === "RELEASED") return "The purchase order was released and is waiting for supplier acknowledgment.";
  if (procurementCase.purchaseAction?.approval?.status === "APPROVED") return "The exact order scope is approved and ready for controlled release.";
  if (procurementCase.purchaseAction?.approval?.status === "PENDING") return "The exact purchase order is waiting for admin approval.";
  if (procurementCase.purchaseDraft) return "A purchase order draft exists. Final authorization is still required.";
  if (procurementCase.quoteCycle?.result?.responses.length) return "A supplier quote is recorded and ready for commercial comparison or approval.";
  if (procurementCase.quoteCycle?.result?.connectedReplies?.length) return "A supplier replied. The response still needs structured commercial review.";
  if (procurementCase.supplierEmailAction?.result?.state === "SENT") return "The quote request was delivered. Derya is waiting for a supplier response.";
  if (procurementCase.supplierEmailAction?.approval?.status === "APPROVED") return "The exact supplier email is approved but has not been delivered yet.";
  if (procurementCase.supplierEmailDraft) return "A supplier message draft exists and still needs approval.";
  if (procurementCase.result?.stage === "SUPPLIER_REJECTED") return "This supplier was rejected during qualification.";
  if (procurementCase.result?.stage === "COMMERCIAL_CONFIRMATION") return "The supplier is qualified. Commercial terms still need confirmation.";
  return "The supplier workstream is still in qualification.";
}

export function externalPoState(status: string) {
  if (status === "ordered") return "Purchase order placed";
  if (status === "awaiting_order_approval") return "Ready for PO approval";
  if (status === "sourcing") return "Collecting supplier responses";
  if (status === "awaiting_shortlist_approval") return "Shortlist approval pending";
  if (status === "needs_attention") return "Blocked, needs attention";
  if (status === "cancelled") return "Canceled";
  return "Not ready for PO";
}

export function externalPoReady(request: CustomerProcurementListItem) {
  return request.status === "awaiting_order_approval" || request.status === "ordered";
}

export function externalSourcingActive(request: CustomerProcurementListItem) {
  return !["ordered", "cancelled"].includes(request.status);
}

export function externalVendorResponseCount(vendor: Pick<CustomerProcurementVendor, "quote" | "responseCount">) {
  return Math.max(vendor.responseCount, vendor.quote ? 1 : 0);
}

export type SupplierThreadReceipt = { outbound: number; inbound: number };

export const EMPTY_SUPPLIER_THREAD_RECEIPT: SupplierThreadReceipt = { outbound: 0, inbound: 0 };

export function supplierThreadReceipt(
  conversation: { available: boolean; messages: Array<{ direction: "INBOUND" | "OUTBOUND" }> } | null,
): SupplierThreadReceipt {
  if (!conversation?.available) return EMPTY_SUPPLIER_THREAD_RECEIPT;
  return {
    outbound: conversation.messages.filter((message) => message.direction === "OUTBOUND").length,
    inbound: conversation.messages.filter((message) => message.direction === "INBOUND").length,
  };
}

export function externalVendorOutreachRead(
  vendor: Pick<CustomerProcurementVendor, "contacted">,
  receipt: SupplierThreadReceipt = EMPTY_SUPPLIER_THREAD_RECEIPT,
) {
  if (vendor.contacted) return "Gmail contact recorded";
  if (receipt.outbound > 0) {
    return `${receipt.outbound} message${receipt.outbound === 1 ? "" : "s"} in the connected thread, no workflow receipt saved`;
  }
  return "No contact receipt";
}

export function externalVendorResponseRead(
  vendor: Pick<CustomerProcurementVendor, "quote" | "responseCount">,
  receipt: SupplierThreadReceipt = EMPTY_SUPPLIER_THREAD_RECEIPT,
) {
  const responses = externalVendorResponseCount(vendor);
  if (responses > 0) return `${responses} response${responses === 1 ? "" : "s"} recorded`;
  if (receipt.inbound > 0) {
    return `${receipt.inbound} repl${receipt.inbound === 1 ? "y" : "ies"} in the connected thread, not recorded by the workflow`;
  }
  return "No response recorded";
}

export function externalVendorActivityLabel(
  vendor: Pick<CustomerProcurementVendor, "contacted" | "quote" | "responseCount">,
  receipt: SupplierThreadReceipt = EMPTY_SUPPLIER_THREAD_RECEIPT,
) {
  if (externalVendorResponseCount(vendor) > 0 || receipt.inbound > 0) return "Responded";
  if (vendor.contacted || receipt.outbound > 0) return "Contacted";
  return "Identified";
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function explicitVendorId(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const candidate = record(value);
  if (!candidate) return null;
  for (const key of ["selectedVendorId", "selected_vendor_id", "vendorId", "vendor_id"]) {
    const id = candidate[key];
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  const vendor = record(candidate.vendor);
  return typeof vendor?.id === "string" && vendor.id.trim() ? vendor.id.trim() : null;
}

export function externalSelectedVendorId(detail: CustomerProcurementRequestDetail) {
  const snapshot = record(detail.decisionSnapshot);
  if (!snapshot) return null;
  for (const candidate of [
    snapshot,
    snapshot.selection,
    snapshot.selectedVendor,
    snapshot.selected_vendor,
    snapshot.decision,
    snapshot.recommendation,
  ]) {
    const id = explicitVendorId(candidate);
    if (id) return id;
  }
  return null;
}

export function externalVendorPoState(
  request: CustomerProcurementListItem,
  detail: CustomerProcurementRequestDetail,
  vendorId: string,
) {
  const selectedVendorId = externalSelectedVendorId(detail);
  if (request.status === "ordered") {
    if (selectedVendorId === vendorId) return "Purchase order placed";
    if (selectedVendorId) return "Not selected for PO";
    return "Order placed, supplier selection not recorded";
  }
  if (request.status === "awaiting_order_approval") {
    if (selectedVendorId === vendorId) return "Ready for PO approval";
    if (selectedVendorId) return "Not selected for PO";
    return "PO approval pending, supplier selection not recorded";
  }
  return "Not ready for PO";
}

export function externalVendorPoReady(
  request: CustomerProcurementListItem,
  detail: CustomerProcurementRequestDetail,
  vendorId: string,
) {
  return externalPoReady(request) && externalSelectedVendorId(detail) === vendorId;
}

export function groupHistoricalSourcing(
  runs: SavedSourcingResearchRun[],
  cases: SavedProcurementCase[],
) {
  const runById = new Map(runs.map((run) => [run.id, run]));
  const grouped = new Map<string, SavedProcurementCase[]>();
  for (const procurementCase of cases) {
    const key = procurementCase.input.researchRunId;
    grouped.set(key, [...(grouped.get(key) ?? []), procurementCase]);
  }
  return [...grouped.entries()].map(([runId, groupCases]) => {
    const run = runById.get(runId) ?? null;
    const fallback = groupCases[0]!.input.researchInput;
    const sortedCases = [...groupCases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      id: runId,
      title: run?.input.componentName ?? fallback.componentName,
      itemKey: run?.input.componentItemKey ?? fallback.componentItemKey,
      requestText: run?.input.requestText ?? fallback.requestText,
      updatedAt: sortedCases[0]!.updatedAt,
      run,
      cases: sortedCases,
      supplierCount: groupCases.length,
      contactedCount: groupCases.filter(historicalSupplierContacted).length,
      responseCount: groupCases.filter(historicalSupplierResponded).length,
      poReadyCount: groupCases.filter(historicalPoReady).length,
    } satisfies HistoricalSourcingGroup;
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function groupActiveHistoricalSourcing(
  runs: SavedSourcingResearchRun[],
  cases: SavedProcurementCase[],
) {
  return groupHistoricalSourcing(runs, cases.filter(historicalSourcingActive));
}
