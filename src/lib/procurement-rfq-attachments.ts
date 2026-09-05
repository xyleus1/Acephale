import "server-only";

import type { OutboundEmailAttachment } from "@/lib/outbound-email-attachments";
import {
  documentContextLines,
  procurementRequestDocuments,
} from "@/lib/procurement-file-delivery-draft";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { getProcurementRequest } from "@/lib/procurement-workflow";
import { requireSupplyWorkspace } from "@/lib/supply-os/persistence";
import { loadRequestDocumentAttachments } from "@/lib/supply-os/request-document-attachments";
import { resolveSupplierSourcingCategory } from "@/lib/supply-os/supplier-sourcing-profile";
import { record } from "@/lib/supply-os/supplier-communication-shared";

// A first-contact RFQ carries the same technical package a reply does, so the
// supplier can quote from the files instead of asking for them. Only documents
// the request itself lists may travel, which is what keeps the board spec and
// bill of materials off a foam enquiry and the mold geometry off a board shop.

const MAX_RFQ_DOCUMENT_CONTEXT_CHARS = 4_000;

export type ProcurementRfqAttachmentPackage = {
  attachments: OutboundEmailAttachment[];
  names: string[];
  contextSections: string[];
  withheld: Array<{ name: string; reason: string }>;
};

export const EMPTY_RFQ_ATTACHMENT_PACKAGE: ProcurementRfqAttachmentPackage = {
  attachments: [],
  names: [],
  contextSections: [],
  withheld: [],
};

// The request file scope decides what may travel, and the category is a second
// independent check on top of it: a board shop never receives mold geometry and
// a molder never receives the bill of materials, even if a link is mis-scoped.
const CATEGORY_FILE_TYPES: Record<string, readonly string[]> = {
  pcba: ["png", "jpg", "jpeg", "pdf", "csv", "xls", "xlsx", "txt", "zip", "gbr", "ger"],
  "molded-foam": ["stl", "step", "stp", "igs", "iges", "dxf", "dwg", "pdf", "png", "jpg", "jpeg"],
};

function fileExtension(name: string) {
  return name.toLowerCase().split(".").at(-1)?.trim() ?? "";
}

export function categoryAllowsRfqFile(categoryKey: string | null, filename: string) {
  if (!categoryKey) return true;
  const allowed = CATEGORY_FILE_TYPES[categoryKey];
  if (!allowed) return true;
  return allowed.includes(fileExtension(filename));
}

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Resolve the files a sourcing request may send, screened and ready to attach.
 * Missing links, an unlinked company, or a file that fails screening leave the
 * package empty or partial rather than failing the campaign: an RFQ without the
 * package is still worth sending, and every omission is reported back.
 */
export async function loadProcurementRfqAttachmentPackage(args: {
  orderId: string;
  customerId: string;
  officeId: string;
}): Promise<ProcurementRfqAttachmentPackage> {
  const order = await getProcurementRequest(args.customerId, args.orderId);
  if (!order) return EMPTY_RFQ_ATTACHMENT_PACKAGE;
  const documents = procurementRequestDocuments(order);
  if (!documents.length) return EMPTY_RFQ_ATTACHMENT_PACKAGE;
  const source = record(record(order.requestContext).source);
  const workspaceId = typeof source.workspace_id === "string" ? source.workspace_id.trim() : "";
  if (!workspaceId) return EMPTY_RFQ_ATTACHMENT_PACKAGE;
  const access = await procurementOperatorAccess(args.officeId);
  const workspace = await requireSupplyWorkspace(access, workspaceId, "view");
  if (!workspace.companyId) return EMPTY_RFQ_ATTACHMENT_PACKAGE;
  const selection = await loadRequestDocumentAttachments({
    officeId: args.officeId,
    companyId: workspace.companyId,
    documentIds: documents.map((document) => document.documentId),
  });
  const category = resolveSupplierSourcingCategory({
    material: order.material,
    specification: order.specification,
  });
  const offCategory = selection.attachments.filter(
    (attachment) => !categoryAllowsRfqFile(category?.key ?? null, attachment.storedName),
  );
  const sendable = selection.attachments.filter(
    (attachment) => categoryAllowsRfqFile(category?.key ?? null, attachment.storedName),
  );
  const attached = new Map(sendable.map((attachment) => [attachment.documentId, attachment]));
  let budget = MAX_RFQ_DOCUMENT_CONTEXT_CHARS;
  const contextSections = documents.flatMap((document) => {
    const attachment = attached.get(document.documentId);
    if (!attachment || budget <= 0) return [];
    const lines = documentContextLines(document, budget);
    if (!lines.length) return [];
    budget -= lines.join("\n").length;
    return [[`From ${attachment.storedName}:`, ...lines].join("\n")];
  });
  return {
    attachments: sendable.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      bytes: attachment.bytes,
    })),
    names: sendable.map(
      (attachment) => `${attachment.storedName} (${attachment.contentType}, ${sizeLabel(attachment.bytes.length)})`,
    ),
    contextSections,
    withheld: [
      ...selection.skipped.map((skip) => ({ name: skip.name, reason: skip.reason })),
      ...offCategory.map((attachment) => ({
        name: attachment.storedName,
        reason: `this file type does not belong to a ${category?.label ?? "sourcing"} enquiry`,
      })),
    ],
  };
}
