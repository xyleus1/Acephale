"use server";

import { requireSession } from "@/lib/auth";
import { applyPendingJobAgentProposal, discardPendingAgentProposal } from "@/lib/agent-proposals";
import {
  listPendingOutreachProposals,
  OUTREACH_PROPOSAL_KIND,
  resolveOutreachReviewer,
  type OutreachProposalReview,
  type OutreachReviewer,
} from "@/lib/outreach-proposal-review";

const APPROVER_ONLY_MESSAGE = "Starting or discarding an outreach campaign needs an admin or manager account. Nothing changed.";

const NOT_PENDING_MESSAGE = "This outreach proposal is no longer pending. Nothing changed.";

export async function listPendingOutreachProposalsAction(): Promise<OutreachReviewer & {
  proposals: OutreachProposalReview[];
}> {
  const session = await requireSession();
  const reviewer = await resolveOutreachReviewer(session);
  if (!reviewer.canView) return { ...reviewer, proposals: [] };
  return { ...reviewer, proposals: await listPendingOutreachProposals(session.officeId) };
}

export async function applyOutreachProposalAction(
  proposalId: string,
  reviewedItemIds: string[],
): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  const reviewer = await resolveOutreachReviewer(session);
  if (!reviewer.canApprove) return { ok: false, message: APPROVER_ONLY_MESSAGE };
  const pending = (await listPendingOutreachProposals(session.officeId)).find((proposal) => proposal.id === proposalId);
  if (!pending) return { ok: false, message: NOT_PENDING_MESSAGE };
  if (pending.blocker) return { ok: false, message: `${pending.blocker} Nothing changed.` };
  const reviewed = new Set(reviewedItemIds);
  const unreviewed = pending.reviewItems.filter((item) => !reviewed.has(item.id));
  if (unreviewed.length > 0) {
    return {
      ok: false,
      message: `${unreviewed.length} spot-check email${unreviewed.length === 1 ? "" : "s"} not yet confirmed as read. Nothing changed.`,
    };
  }
  const result = await applyPendingJobAgentProposal({
    officeId: session.officeId,
    userId: session.userId,
    proposalId,
    officeWide: true,
    kind: OUTREACH_PROPOSAL_KIND,
  });
  return { ok: result.ok, message: result.message };
}

export async function discardOutreachProposalAction(proposalId: string): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  const reviewer = await resolveOutreachReviewer(session);
  if (!reviewer.canApprove) return { ok: false, message: APPROVER_ONLY_MESSAGE };
  const discarded = await discardPendingAgentProposal({
    officeId: session.officeId,
    userId: session.userId,
    proposalId,
    kind: OUTREACH_PROPOSAL_KIND,
  });
  return discarded
    ? { ok: true, message: "Proposal discarded. The campaign stays in draft and nothing was sent." }
    : { ok: false, message: NOT_PENDING_MESSAGE };
}
