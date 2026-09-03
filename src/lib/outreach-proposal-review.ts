import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const OUTREACH_PROPOSAL_KIND = "OUTREACH_CAMPAIGN_START";

export const OUTREACH_CHAT_APPROVAL_REDIRECT =
  "Outreach campaigns are approved in the Pending approvals panel of the Outreach desk, where every spot-check email is shown. Nothing was sent.";

export type OutreachProposalReviewItem = {
  id: string;
  title: string;
  meta: string;
  subject: string;
  body: string;
};

export type OutreachProposalReview = {
  id: string;
  createdAt: string;
  campaignId: string | null;
  revisionHash: string | null;
  actionLabel: string;
  actionDetails: string[];
  reviewItems: OutreachProposalReviewItem[];
  /** Set when the proposal cannot be started from the review surface; only discard remains. */
  blocker: string | null;
};

export const OUTREACH_PROPOSAL_UNRENDERED_BLOCKER =
  "This proposal was planned before spot-check emails were rendered, so there is nothing to review. Discard it and plan the campaign again.";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function splitDetail(detail: string): { subject: string; body: string } | null {
  const match = detail.match(/^Subject: ([^\n]*)\n([\s\S]*)$/);
  if (!match) return null;
  return { subject: match[1].trim(), body: match[2] };
}

export function outreachProposalReviewFromPayload(proposal: {
  id: string;
  createdAt: Date;
  payload: unknown;
}): OutreachProposalReview | null {
  const payload = asRecord(proposal.payload);
  if (payload.entity !== "bulk" || payload.action !== "START_OUTREACH_CAMPAIGN") return null;
  const actionInput = asRecord(payload.actionInput);
  const reviewItems = (Array.isArray(payload.reviewItems) ? payload.reviewItems : [])
    .map((raw) => {
      const item = asRecord(raw);
      const detail = typeof item.detail === "string" ? item.detail : "";
      const rendered = splitDetail(detail);
      return {
        id: typeof item.id === "string" ? item.id : "",
        title: typeof item.title === "string" ? item.title : "",
        meta: typeof item.meta === "string" ? item.meta : "",
        subject: rendered?.subject ?? "",
        body: rendered?.body ?? detail,
        rendered: rendered !== null,
      };
    })
    .filter((item) => item.id && item.title);
  const unrendered = reviewItems.some((item) => !item.rendered);
  return {
    id: proposal.id,
    createdAt: proposal.createdAt.toISOString(),
    campaignId: typeof actionInput.campaignId === "string" ? actionInput.campaignId : null,
    revisionHash: typeof actionInput.revisionHash === "string" ? actionInput.revisionHash : null,
    actionLabel: typeof payload.actionLabel === "string" ? payload.actionLabel : "Start outreach campaign",
    actionDetails: asStringList(payload.actionDetails),
    reviewItems: reviewItems.map(({ id, title, meta, subject, body }) => ({ id, title, meta, subject, body })),
    blocker: unrendered || reviewItems.length === 0 ? OUTREACH_PROPOSAL_UNRENDERED_BLOCKER : null,
  };
}

/** A claim older than this with no finalization means the approving request died mid-flight. */
export const STALE_OUTREACH_CLAIM_MS = 5 * 60_000;

export type StaleClaimOutcome = "finalized" | "released";

/**
 * Settles outreach proposals left in APPLYING by an interrupted approval.
 * `activateCampaign` stamps `approvedAt` in the same write that leaves DRAFT, so a
 * campaign with `approvedAt` was activated (finalize the proposal as APPLIED with the
 * reviewer recorded at claim time); a campaign still without it never activated (release
 * the claim back to PENDING so the reviewer can decide again). Both writes are
 * compare-and-set on APPLYING, so a finalization racing in from the original request wins.
 */
export async function reconcileStaleOutreachClaims(
  officeId: string,
  options: { now?: Date; db?: Pick<PrismaClient, "agentProposal" | "outreachCampaign"> } = {},
): Promise<Array<{ proposalId: string; outcome: StaleClaimOutcome }>> {
  const now = options.now ?? new Date();
  const db = options.db ?? prisma;
  const stale = await db.agentProposal.findMany({
    where: {
      officeId,
      kind: OUTREACH_PROPOSAL_KIND,
      status: "APPLYING",
      reviewedAt: { lt: new Date(now.getTime() - STALE_OUTREACH_CLAIM_MS) },
    },
    select: { id: true, payload: true, reviewedAt: true },
    take: 20,
  });
  const outcomes: Array<{ proposalId: string; outcome: StaleClaimOutcome }> = [];
  for (const proposal of stale) {
    if (!proposal.reviewedAt) continue;
    const claim = { proposalId: proposal.id, officeId, claimedAt: proposal.reviewedAt };
    const actionInput = asRecord(asRecord(proposal.payload).actionInput);
    const campaignId = typeof actionInput.campaignId === "string" ? actionInput.campaignId : null;
    const campaign = campaignId
      ? await db.outreachCampaign.findFirst({
        where: { id: campaignId, officeId },
        select: { approvedAt: true },
      })
      : null;
    const activated = Boolean(campaign?.approvedAt);
    const settled = activated
      ? await db.agentProposal.updateMany({
        where: ownedClaimWhere(claim),
        data: {
          status: "APPLIED",
          appliedAt: campaign?.approvedAt ?? now,
          reviewDecision: "APPLY_BULK_ACTION",
          reviewNote: `Activated outreach campaign ${campaignId?.slice(0, 8) ?? ""}. Finalized after the approving request was interrupted.`,
        },
      })
      : await db.agentProposal.updateMany({
        where: ownedClaimWhere(claim),
        data: { status: "PENDING", reviewedByUserId: null, reviewedAt: null },
      });
    if (settled.count > 0) outcomes.push({ proposalId: proposal.id, outcome: activated ? "finalized" : "released" });
  }
  return outcomes;
}

export async function listPendingOutreachProposals(officeId: string): Promise<OutreachProposalReview[]> {
  await reconcileStaleOutreachClaims(officeId);
  const proposals = await prisma.agentProposal.findMany({
    where: { officeId, status: "PENDING", kind: OUTREACH_PROPOSAL_KIND },
    select: { id: true, createdAt: true, payload: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return proposals
    .map((proposal) => outreachProposalReviewFromPayload(proposal))
    .filter((review): review is OutreachProposalReview => review !== null);
}

export type OutreachClaimDb = Pick<Prisma.TransactionClient, "agentProposal">;

/**
 * Identifies one approval's claim on a proposal. The claim timestamp is the ownership
 * token: a claim released by stale-claim recovery, or re-claimed by another reviewer,
 * carries a different `reviewedAt`, so the original request can no longer finalize or
 * release it.
 */
export type OutreachClaim = { proposalId: string; officeId: string; claimedAt: Date };

function ownedClaimWhere(claim: OutreachClaim): Prisma.AgentProposalWhereInput {
  return { id: claim.proposalId, officeId: claim.officeId, status: "APPLYING", reviewedAt: claim.claimedAt };
}

/** Compare-and-set claim from PENDING. False when another decision already won. */
export async function claimOutreachProposal(
  db: OutreachClaimDb,
  claim: OutreachClaim,
  userId: string | null,
): Promise<boolean> {
  const claimed = await db.agentProposal.updateMany({
    where: { id: claim.proposalId, officeId: claim.officeId, status: "PENDING" },
    data: { status: "APPLYING", reviewedByUserId: userId, reviewedAt: claim.claimedAt },
  });
  return claimed.count === 1;
}

/** Returns the proposal to PENDING only while this claim still owns it. */
export async function releaseOutreachClaim(db: OutreachClaimDb, claim: OutreachClaim): Promise<boolean> {
  const released = await db.agentProposal.updateMany({
    where: ownedClaimWhere(claim),
    data: { status: "PENDING", reviewedByUserId: null, reviewedAt: null },
  });
  return released.count === 1;
}

/**
 * Marks the proposal APPLIED only while this claim still owns it. Run inside the same
 * transaction as the campaign activation so a lost claim rolls the activation back.
 */
export async function finalizeOutreachClaim(
  db: OutreachClaimDb,
  claim: OutreachClaim,
  input: { userId: string | null; note: string; appliedAt?: Date },
): Promise<boolean> {
  const appliedAt = input.appliedAt ?? new Date();
  const finalized = await db.agentProposal.updateMany({
    where: ownedClaimWhere(claim),
    data: {
      status: "APPLIED",
      appliedAt,
      reviewedByUserId: input.userId,
      reviewedAt: appliedAt,
      reviewDecision: "APPLY_BULK_ACTION",
      reviewNote: input.note,
    },
  });
  return finalized.count === 1;
}

const OUTREACH_APPROVER_ROLES = ["ADMIN", "MANAGER"] as const;

export type OutreachReviewer = { canView: boolean; canApprove: boolean };

const NO_ACCESS: OutreachReviewer = { canView: false, canApprove: false };

/**
 * Resolves what the caller may do from the current user row, not the session cookie,
 * so a demoted or deactivated operator loses approval rights immediately.
 * Operators on the Outreach desk may read pending proposals; only ADMIN and MANAGER
 * may start or discard a campaign, mirroring the procurement approval gate.
 */
export async function resolveOutreachReviewer(session: {
  accessKind?: "operator" | "customer";
  userId: string;
  officeId: string;
}): Promise<OutreachReviewer> {
  if (session.accessKind === "customer") return NO_ACCESS;
  const user = await prisma.user.findFirst({
    where: { id: session.userId, officeId: session.officeId, isActive: true },
    select: { role: true },
  });
  if (!user || user.role === "EMPLOYEE") return NO_ACCESS;
  return {
    canView: true,
    canApprove: OUTREACH_APPROVER_ROLES.some((role) => role === user.role),
  };
}

/**
 * Whether a chat "apply <id>" points at a pending outreach proposal. A caller who may
 * not view the office's pending approvals is only matched against their own proposals,
 * so the reply cannot reveal whether a colleague's proposal exists.
 */
export async function chatApplyTargetsOutreachProposal(input: {
  officeId: string;
  requestedId: string;
  ownerUserId?: string;
}): Promise<boolean> {
  const matches = await prisma.agentProposal.findMany({
    where: {
      officeId: input.officeId,
      ...(input.ownerUserId ? { userId: input.ownerUserId } : {}),
      status: "PENDING",
      OR: [{ id: input.requestedId }, { id: { startsWith: input.requestedId } }],
    },
    select: { kind: true },
  });
  return matches.some((proposal) => proposal.kind === OUTREACH_PROPOSAL_KIND);
}
