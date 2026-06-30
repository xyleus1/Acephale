"use server";

import { requireSession } from "@/lib/auth";
import { applyPendingJobAgentProposal, discardPendingAgentProposal } from "@/lib/agent-proposals";

export async function applyInboxAgentProposalAction(proposalId: string) {
  const session = await requireSession();
  await applyPendingJobAgentProposal({
    officeId: session.officeId,
    userId: session.userId,
    proposalId,
  });
}

export async function discardInboxAgentProposalAction(proposalId: string) {
  const session = await requireSession();
  await discardPendingAgentProposal({
    officeId: session.officeId,
    userId: session.userId,
    proposalId,
  });
}
