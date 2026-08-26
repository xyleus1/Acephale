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
  skipReason: string | null;
};

const SKIPPED_KINDS: SupplierInboundKind[] = ["BOUNCE", "AUTO_REPLY", "WRONG_RECIPIENT"];

export function fileDraftSkipReason(inboundKind: SupplierInboundKind) {
  if (!SKIPPED_KINDS.includes(inboundKind)) return null;
  const label = inboundKind.toLowerCase().replace(/_/g, " ");
  return `The latest supplier message is a ${label}, so no file reply is prepared.`;
}

export function eligibleFileDraftTargets(
  targets: readonly FileDraftTarget[],
  options: { redraft?: boolean } = {},
) {
  return targets.filter((target) => (
    !target.skipReason && (options.redraft === true || !target.hasDraft)
  ));
}
