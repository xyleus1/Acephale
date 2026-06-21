import type { ReactNode } from "react";
import { CustomerQuoteDraftButton } from "@/components/customer-quote-draft-button";
import { ForwarderDraftsButton } from "@/components/forwarder-drafts-button";
import { MissingInfoDraftButton } from "@/components/missing-info-draft-button";
import { NegotiationPlanDraftButton } from "@/components/negotiation-plan-draft-button";
import type { CommercialChecklistActionKind } from "@/lib/commercial-checklist-actions";

export function CommercialChecklistAction({
  kind,
  inquiryId,
  jobId,
  quoteReady = false,
  forwarderDraftControl,
  className,
  noteClassName = "record-helper-text",
}: {
  kind: CommercialChecklistActionKind;
  inquiryId?: string | null;
  jobId?: string | null;
  quoteReady?: boolean;
  forwarderDraftControl?: ReactNode;
  className: string;
  noteClassName?: string;
}) {
  return (
    <div className={className}>
      {kind === "missing-info" && (inquiryId || jobId) && (
        <MissingInfoDraftButton inquiryId={inquiryId} jobId={jobId} />
      )}
      {kind === "missing-info" && !inquiryId && !jobId && (
        <span className={noteClassName}>Select an RFQ or job before drafting a missing-info ask.</span>
      )}
      {kind === "forwarder-drafts" && (
        forwarderDraftControl ?? (
          jobId ? (
            <ForwarderDraftsButton jobId={jobId} />
          ) : (
            <span className={noteClassName}>Link a job before creating forwarder drafts.</span>
          )
        )
      )}
      {kind === "negotiation-plan" && (
        jobId ? (
          <NegotiationPlanDraftButton jobId={jobId} />
        ) : (
          <span className={noteClassName}>Create or link the job before negotiation drafting.</span>
        )
      )}
      {kind === "customer-quote" && (
        jobId ? (
          <CustomerQuoteDraftButton jobId={jobId} quoteReady={quoteReady} />
        ) : (
          <span className={noteClassName}>Create or link the job before quote drafting.</span>
        )
      )}
    </div>
  );
}
