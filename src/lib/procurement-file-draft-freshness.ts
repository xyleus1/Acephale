import { createHash } from "crypto";

// A saved supplier file reply repeats the request state it was built from:
// quantity, needed by date, specification, and the stored files it attaches. A
// draft is delivered later, sometimes days later and sometimes by the sourcing
// loop rather than the operator who read it, so the send path recomputes this
// fingerprint from live state and refuses a delivery whose inputs moved.

export const PROCUREMENT_FILE_DRAFT_STATE_SCOPE = "procurement_file_reply";

export const PROCUREMENT_FILE_DRAFT_STALE_REASON =
  "The sourcing request or its attached files changed after this draft was saved. Redraft before sending.";

export const PROCUREMENT_FILE_DRAFT_UNVERIFIED_REASON =
  "This draft was saved without a state fingerprint, so its inputs cannot be rechecked. Redraft before sending.";

// Only what a reply actually repeats: the document lines the body renders, not
// the whole stored file. A document the attachment screen withheld says nothing
// to the supplier, so it is left out by the caller.
export type ProcurementFileDraftStateDocument = {
  documentId: string;
  name: string;
  lines: readonly string[];
};

export type ProcurementFileDraftStateAttachment = {
  documentId: string;
  name: string;
  mimeType: string;
  size: number;
};

export type ProcurementFileDraftStateInput = {
  material?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  neededBy?: string | null;
  specification?: string | null;
  documents: readonly ProcurementFileDraftStateDocument[];
  attachments: readonly ProcurementFileDraftStateAttachment[];
};

function text(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function quantity(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? String(parsed) : text(value);
}

function byKey(a: string, b: string) {
  return a.localeCompare(b);
}

// The recipient, the subject, the supplier message being answered and the
// answers folded into the body are all guarded elsewhere on the send path, so
// they stay out of this fingerprint. Including them would report a conflict on
// a change the send path already refuses on its own terms.
export function procurementFileDraftStateKey(input: ProcurementFileDraftStateInput) {
  const snapshot = {
    material: text(input.material),
    quantity: quantity(input.quantity),
    unit: text(input.unit),
    neededBy: text(input.neededBy)?.slice(0, 10) ?? null,
    specification: text(input.specification),
    documents: input.documents
      .map((document) => ({
        documentId: document.documentId,
        name: text(document.name),
        lines: createHash("sha256").update(document.lines.join("\n")).digest("hex"),
      }))
      .sort((a, b) => byKey(a.documentId, b.documentId)),
    attachments: input.attachments
      .map((attachment) => ({
        documentId: attachment.documentId,
        name: text(attachment.name),
        mimeType: text(attachment.mimeType),
        size: Number.isFinite(attachment.size) ? attachment.size : null,
      }))
      .sort((a, b) => byKey(a.documentId, b.documentId)),
  };
  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return `${PROCUREMENT_FILE_DRAFT_STATE_SCOPE}:${hash}`;
}
