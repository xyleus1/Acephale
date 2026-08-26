import "server-only";

import { assembleCompanyContextForAgent } from "@/lib/company-context";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import {
  mergeRequestContextDocuments,
  requestContextDocumentEntries,
  requestContextWorkspaceId,
  type RequestDocumentEntry,
} from "@/lib/procurement-request-document-merge";
import {
  getProcurementRequest,
  replaceProcurementRequestContext,
} from "@/lib/procurement-workflow";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";
import { buildProcurementCompanyContextSnapshot } from "@/lib/supply-os/procurement-company-context";

// Sourcing requests raised before Context snapshots were stored carry no link to
// the files they were built from, so supplier replies cannot attach anything.
// This operator command relinks a request to the Context documents of its own
// workspace, scoped to the office and company that own the request.

export type RequestDocumentLinkPreview = {
  orderId: string;
  material: string;
  workspaceId: string | null;
  linked: string[];
  available: string[];
  missing: string[];
};

export type RequestDocumentLinkResult = RequestDocumentLinkPreview & {
  added: string[];
};

async function loadRequest(orderId: string) {
  const summary = await loadBulkRfqOrder(orderId);
  if (!summary) return null;
  const order = await getProcurementRequest(summary.customerId, orderId);
  if (!order) return null;
  return { summary, order };
}

async function workspaceDocuments(args: { officeId: string; workspaceId: string }) {
  const access = await procurementOperatorAccess(args.officeId);
  const packet = await assembleCompanyContextForAgent(access, args.workspaceId);
  const snapshot = buildProcurementCompanyContextSnapshot(packet);
  return snapshot ? snapshot.documents : [];
}

function names(entries: readonly RequestDocumentEntry[]) {
  return entries.map((entry) => entry.name);
}

function missingNames(
  linked: readonly RequestDocumentEntry[],
  available: readonly RequestDocumentEntry[],
) {
  const known = new Set(available.map((entry) => entry.citation_id));
  return linked.filter((entry) => !known.has(entry.citation_id)).map((entry) => entry.name);
}

export async function previewProcurementRequestDocumentLink(
  orderId: string,
): Promise<RequestDocumentLinkPreview | null> {
  const request = await loadRequest(orderId);
  if (!request) return null;
  const linked = requestContextDocumentEntries(request.order.requestContext);
  const workspaceId = requestContextWorkspaceId(request.order.requestContext);
  const available = workspaceId
    ? await workspaceDocuments({ officeId: request.summary.officeId, workspaceId })
    : [];
  return {
    orderId: request.summary.orderId,
    material: request.summary.material,
    workspaceId,
    linked: names(linked),
    available: names(available),
    missing: missingNames(linked, available),
  };
}

export async function linkProcurementRequestDocuments(
  orderId: string,
): Promise<RequestDocumentLinkResult | null> {
  const request = await loadRequest(orderId);
  if (!request) return null;
  const workspaceId = requestContextWorkspaceId(request.order.requestContext);
  if (!workspaceId) {
    throw new SupplyPersistenceError(
      "This sourcing request records no Context workspace, so its files cannot be relinked.",
      "conflict",
    );
  }
  const available = await workspaceDocuments({ officeId: request.summary.officeId, workspaceId });
  if (!available.length) {
    throw new SupplyPersistenceError(
      "The Context workspace for this sourcing request holds no processed documents.",
      "conflict",
    );
  }
  const merged = mergeRequestContextDocuments(request.order.requestContext, available);
  if (merged.added.length) {
    await replaceProcurementRequestContext(
      request.summary.customerId,
      request.summary.orderId,
      merged.requestContext,
    );
  }
  const linked = requestContextDocumentEntries(merged.requestContext);
  return {
    orderId: request.summary.orderId,
    material: request.summary.material,
    workspaceId,
    added: names(merged.added),
    linked: names(linked),
    available: names(available),
    missing: missingNames(linked, available),
  };
}
