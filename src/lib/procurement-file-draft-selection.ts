import type { SupplierInboundKind } from "@/lib/procurement-inbound-triage";

// Pure selection rules for the operator file draft command, kept away from data
// access so they can be exercised without a database or a request context.

export type FileDraftTarget = {
  vendorId: string;
  vendorName: string;
  recipient: string;
  sourceMessageId: string;
  conversationSubject: string | null;
  inboundKind: SupplierInboundKind;
  hasDraft: boolean;
  // A saved draft answers one specific supplier message. If the supplier has
  // written again since, that draft would deliver an answer to the wrong
  // message, so it is redrafted rather than sent.
  staleDraft?: boolean;
  skipReason: string | null;
};

const SKIPPED_KIND_LABELS: Partial<Record<SupplierInboundKind, string>> = {
  BOUNCE: "a delivery bounce",
  AUTO_REPLY: "an automatic reply",
  WRONG_RECIPIENT: "a wrong recipient notice",
};

export function fileDraftSkipReason(inboundKind: SupplierInboundKind) {
  const label = SKIPPED_KIND_LABELS[inboundKind];
  if (!label) return null;
  return `The latest supplier message is ${label}, so no file reply is prepared.`;
}

export function eligibleFileDraftTargets<T extends FileDraftTarget>(
  targets: readonly T[],
  options: { redraft?: boolean } = {},
) {
  return targets.filter((target) => (
    !target.skipReason
    && (options.redraft === true || !target.hasDraft || target.staleDraft === true)
  ));
}
