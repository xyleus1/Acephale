import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BATCH_REVIEW_MAX_ITEMS,
  batchRecipientHash,
  isFreeMailAddress,
  isRoleAddress,
  recipientQualityLines,
  spotCheckLabel,
  spotCheckSample,
  summarizeRecipientQuality,
} from "../src/lib/batch-review";
import {
  campaignRevisionHash,
  campaignRowEligible,
  campaignStatusBlocker,
  normalizeCampaignExcludeEmails,
} from "../src/lib/outreach-campaign-copy";
import {
  OUTREACH_CHAT_APPROVAL_REDIRECT,
  OUTREACH_PROPOSAL_UNRENDERED_BLOCKER,
  STALE_OUTREACH_CLAIM_MS,
  claimOutreachProposal,
  finalizeOutreachClaim,
  outreachProposalReviewFromPayload,
  reconcileStaleOutreachClaims,
  releaseOutreachClaim,
} from "../src/lib/outreach-proposal-review";

const audience = Array.from({ length: 250 }, (_, index) => ({
  id: `rec-${index}`,
  email: `buyer${index}@company-${index}.eu`,
  country: index % 3 === 0 ? "Germany" : index % 3 === 1 ? "Turkey" : "Netherlands",
}));

// Bounded, deterministic, and spread across the audience.
const sample = spotCheckSample(audience, { seed: "rev-1" });
assert.equal(sample.length, BATCH_REVIEW_MAX_ITEMS, "the sample is bounded regardless of audience size");
assert.deepEqual(sample.slice(0, 3).map((pick) => pick.position), [0, 1, 2], "the head shows the first rows");
assert.ok(sample.slice(0, 3).every((pick) => pick.pick === "head"));
assert.ok(sample.slice(3).every((pick) => pick.pick === "spot"));
assert.equal(new Set(sample.map((pick) => pick.position)).size, sample.length, "no row is sampled twice");
assert.ok(sample.some((pick) => pick.position >= 200), "spot checks reach the back of the audience");
assert.ok(sample.some((pick) => pick.position >= 80 && pick.position < 170), "spot checks cover the middle");
assert.deepEqual(
  spotCheckSample(audience, { seed: "rev-1" }).map((pick) => pick.position),
  sample.map((pick) => pick.position),
  "the same seed and audience always give the same sample",
);
assert.notDeepEqual(
  spotCheckSample(audience, { seed: "rev-2" }).map((pick) => pick.position),
  sample.map((pick) => pick.position),
  "a new revision shows different spot rows",
);
for (const pick of sample) assert.equal(pick.item, audience[pick.position], "positions point at the sampled item");

const small = spotCheckSample(audience.slice(0, 4), { seed: "rev-1" });
assert.deepEqual(small.map((pick) => pick.position), [0, 1, 2, 3], "a small audience is shown whole");
assert.deepEqual(spotCheckSample([], { seed: "rev-1" }), []);
assert.equal(spotCheckSample(audience.slice(0, 2), { seed: "x" }).length, 2);
assert.equal(spotCheckLabel(sample[0], 250), "Row 1 of 250");
assert.equal(spotCheckLabel(sample[3], 250), `Spot check, row ${sample[3].position + 1} of 250`);

// Audience quality counts are deterministic and warn on the risky shapes.
assert.equal(isRoleAddress("info@acme.eu"), true);
assert.equal(isRoleAddress("Sales.Team@acme.eu"), true);
assert.equal(isRoleAddress("no-reply@acme.eu"), true);
assert.equal(isRoleAddress("jane.doe@acme.eu"), false);
assert.equal(isFreeMailAddress("someone@gmail.com"), true);
assert.equal(isFreeMailAddress("someone@acme.eu"), false);

const clean = summarizeRecipientQuality(audience);
assert.equal(clean.total, 250);
assert.equal(clean.uniqueDomains, 250);
assert.deepEqual(clean.warnings, [], "a clean audience has no warnings");
assert.deepEqual(clean.countries.map((entry) => entry.country), ["Germany", "Netherlands", "Turkey"]);
assert.equal(clean.countries.reduce((sum, entry) => sum + entry.count, 0), 250);

const risky = summarizeRecipientQuality([
  { email: "info@one.eu", country: "Turkey" },
  { email: "sales@one.eu", country: "Turkey" },
  { email: "INFO@one.eu", country: null },
  { email: "contact@two.eu" },
  { email: "jane@gmail.com" },
  { email: "not-an-email" },
]);
assert.equal(risky.total, 6);
assert.equal(risky.invalidAddresses, 1);
assert.equal(risky.duplicateAddresses, 1, "case-insensitive duplicate detected");
assert.equal(risky.roleAddresses, 4);
assert.equal(risky.freeMailAddresses, 1);
assert.deepEqual(risky.repeatedDomains, [{ domain: "one.eu", count: 3 }]);
assert.deepEqual(risky.countries, [{ country: "unknown", count: 3 }, { country: "Turkey", count: 2 }]);
assert.ok(risky.warnings.some((warning) => warning.includes("share the domain one.eu")), "domain concentration warning");
assert.ok(risky.warnings.some((warning) => warning.includes("role mailboxes")), "role mailbox warning");
assert.ok(risky.warnings.some((warning) => warning.includes("appears more than once")), "duplicate warning");
assert.ok(risky.warnings.some((warning) => warning.includes("not valid email syntax")), "invalid syntax warning");
const lines = recipientQualityLines(risky);
assert.match(lines[0], /^Audience quality: 6 recipients across 3 domains/);
assert.equal(lines.filter((line) => line.startsWith("Warning: ")).length, risky.warnings.length);
for (const line of [...lines, ...risky.warnings]) assert.ok(!line.includes("\u2014"), "no em dashes in review copy");

// The approved procurement scope is pinned by an order-independent hash.
const entries = [{ id: "v1", email: "A@one.eu" }, { id: "v2", email: "b@two.eu" }];
assert.equal(batchRecipientHash(entries), batchRecipientHash([...entries].reverse()));
assert.equal(batchRecipientHash(entries), batchRecipientHash([{ id: "v1", email: "a@one.eu" }, entries[1]]), "address case does not change the batch");
assert.notEqual(batchRecipientHash(entries), batchRecipientHash(entries.slice(0, 1)));
assert.notEqual(batchRecipientHash(entries), batchRecipientHash([entries[0], { id: "v2", email: "c@two.eu" }]));
assert.match(batchRecipientHash([]), /^[a-f0-9]{64}$/);

// Reviewer exclusions remove rows from eligibility and change the revision.
assert.deepEqual(normalizeCampaignExcludeEmails([" Buyer1@Company-1.eu ", "buyer1@company-1.eu", "junk", 4]), ["buyer1@company-1.eu"]);
assert.deepEqual(normalizeCampaignExcludeEmails("buyer1@company-1.eu"), [], "only arrays are accepted");
const row = { status: "new", data: { email: "Buyer1@Company-1.eu", country: "Germany" } };
assert.equal(campaignRowEligible({ row, statuses: ["new"], emailField: "email" }), true);
assert.equal(campaignRowEligible({ row, statuses: ["new"], emailField: "email", excludeEmails: ["buyer1@company-1.eu"] }), false, "excluded addresses are ineligible regardless of case");
assert.equal(campaignRowEligible({ row, statuses: ["new"], emailField: "email", excludeEmails: ["someone-else@company-1.eu"] }), true);
const base = {
  subject: "Hello {{company}}",
  bodyTemplate: "Body",
  emailField: "email",
  rowStatuses: ["new"],
  dailyCap: 40,
  senderAccountId: null,
  senderDisplayName: null,
  audienceRecordIds: ["rec-0"],
  audiencePersonalization: { "rec-0": { email: "buyer0@company-0.eu", company: null, country: null } },
};
assert.notEqual(
  campaignRevisionHash({ ...base, filters: { countries: ["Germany"] } }),
  campaignRevisionHash({ ...base, filters: { countries: ["Germany"], excludeEmails: ["buyer1@company-1.eu"] } }),
  "an exclusion is part of the approved revision",
);
assert.equal(
  campaignRevisionHash({ ...base, filters: { countries: ["Germany"] } }),
  campaignRevisionHash({ ...base, filters: { countries: ["Germany"], excludeEmails: undefined } }),
  "no exclusions keeps existing revision hashes stable",
);

// The proposal card shows the planned snapshot. The approval must pin that
// revision and refuse when the saved draft landed on another one.
const agentTools = readFileSync("src/lib/agent-tools.ts", "utf8");
const planBlock = agentTools.slice(
  agentTools.indexOf('case "plan_outreach_campaign"'),
  agentTools.indexOf('case "list_outreach_campaigns"'),
);
const mismatch = planBlock.indexOf("campaign.revisionHash !== plan.revisionHash");
assert.ok(mismatch >= 0, "plan_outreach_campaign compares the draft revision with the planned one");
assert.ok(
  mismatch > planBlock.indexOf("await saveDraftCampaign(") && mismatch < planBlock.indexOf("createPendingBulkActionProposal("),
  "the comparison sits after the draft is saved and before any proposal is created",
);
assert.match(planBlock.slice(mismatch, planBlock.indexOf("createPendingBulkActionProposal(")), /ok: false/, "a revision mismatch is a tool error, not a proposal");
assert.match(planBlock, /actionInput: \{ campaignId, revisionHash: plan\.revisionHash \}/, "the proposal pins the planned revision that the review items were rendered from");
assert.ok(!planBlock.includes("revisionHash: campaign.revisionHash"), "the proposal never pins the draft's own revision");

// Global outreach proposals have no job or inquiry page. The Outreach desk
// renders the stored review items and is the only place an approval can be
// applied; a chat command never substitutes for reading the spot check.
const review = outreachProposalReviewFromPayload({
  id: "proposal-1",
  createdAt: new Date("2026-09-01T10:00:00Z"),
  payload: {
    entity: "bulk",
    action: "START_OUTREACH_CAMPAIGN",
    actionInput: { campaignId: "camp-1", revisionHash: "rev-1" },
    actionLabel: "Start campaign to 240 recipients",
    actionDetails: ["Sender: sales@acme.eu", "Daily cap: 30"],
    reviewItems: [
      { id: "rec-0", title: "buyer0@company-0.eu", meta: "Row 1 of 240 · Company 0 · Germany", detail: "Subject: Hello Company 0\nBody line one\n\nOpt out: reply STOP" },
      { id: "rec-7", title: "buyer7@company-7.eu", meta: "Row 8 of 240", detail: "Subject: Hello Company 7\nBody seven" },
      { id: "", title: "dropped", meta: "", detail: "no id" },
    ],
  },
});
assert.ok(review, "a START_OUTREACH_CAMPAIGN proposal is reviewable");
assert.equal(review.campaignId, "camp-1");
assert.equal(review.revisionHash, "rev-1");
assert.deepEqual(review.actionDetails, ["Sender: sales@acme.eu", "Daily cap: 30"]);
assert.equal(review.reviewItems.length, 2, "review items without an id cannot be marked read and are dropped");
assert.equal(review.reviewItems[0].subject, "Hello Company 0");
assert.equal(review.reviewItems[0].body, "Body line one\n\nOpt out: reply STOP", "the rendered body is kept verbatim for the reviewer");
assert.equal(review.reviewItems[0].meta, "Row 1 of 240 · Company 0 · Germany");
assert.equal(review.blocker, null, "a proposal whose every item carries a rendered email can be started");
assert.equal(
  outreachProposalReviewFromPayload({ id: "p", createdAt: new Date(), payload: { entity: "bulk", action: "HIDE_THREADS", reviewItems: [] } }),
  null,
  "other bulk proposals are not outreach approvals",
);

// Proposals planned before spot checks were rendered carry only recipient
// labels. They stay visible so they can be discarded, but they cannot be
// started from any surface: there is no message to review.
const legacyReview = outreachProposalReviewFromPayload({
  id: "proposal-legacy",
  createdAt: new Date("2026-08-30T10:00:00Z"),
  payload: {
    entity: "bulk",
    action: "START_OUTREACH_CAMPAIGN",
    actionInput: { campaignId: "camp-0" },
    reviewItems: [
      { id: "rec-1", title: "buyer1@company-1.eu", meta: "Company 1", detail: "Eligible research-list row." },
      { id: "rec-2", title: "buyer2@company-2.eu", meta: "Company 2", detail: "Subject: Hello Company 2\nBody two" },
    ],
  },
});
assert.ok(legacyReview, "legacy proposals stay listed so they can be discarded");
assert.equal(legacyReview.blocker, OUTREACH_PROPOSAL_UNRENDERED_BLOCKER, "one unrendered item blocks the whole proposal");
assert.match(legacyReview.blocker ?? "", /plan the campaign again/, "the blocker tells the operator how to recover");
const emptyReview = outreachProposalReviewFromPayload({
  id: "proposal-empty",
  createdAt: new Date(),
  payload: { entity: "bulk", action: "START_OUTREACH_CAMPAIGN", actionInput: { campaignId: "camp-2" }, reviewItems: [] },
});
assert.equal(emptyReview?.blocker, OUTREACH_PROPOSAL_UNRENDERED_BLOCKER, "a proposal with nothing to review cannot be started");

const agentChat = readFileSync("src/lib/agent-chat.ts", "utf8");
const applyBlock = agentChat.slice(
  agentChat.indexOf("const applyMatch = userMessage.trim().match(CAMPAIGN_APPLY_COMMAND)"),
  agentChat.indexOf("if (!apiKey) {"),
);
assert.match(applyBlock, /const reviewer = await resolveOutreachReviewer\(session\);\s*const targetsOutreach = await chatApplyTargetsOutreachProposal\(\{\s*officeId: session\.officeId,\s*requestedId: applyMatch\[1\],\s*ownerUserId: reviewer\.canView \? undefined : session\.userId,/, "apply <id> resolves the caller's live access first; only a viewer is matched against office-wide proposals, everyone else only against their own");
assert.match(applyBlock, /if \(targetsOutreach\) \{\s*if \(!reviewer\.canView\) \{/, "the operator-only reply is gated on live access, never on the cookie role");
assert.ok(!applyBlock.includes("session.role"), "chat approval routing never trusts the cookie role, so a demoted or deactivated session cannot probe pending approvals");
assert.equal((applyBlock.match(/await resolveOutreachReviewer\(session\)/g) ?? []).length, 2, "both the apply and greenlight paths resolve live access");
const reviewModule = readFileSync("src/lib/outreach-proposal-review.ts", "utf8");
const chatTargetBlock = reviewModule.slice(reviewModule.indexOf("export async function chatApplyTargetsOutreachProposal"));
assert.match(chatTargetBlock, /\.\.\.\(input\.ownerUserId \? \{ userId: input\.ownerUserId \} : \{\}\),/, "viewers match office wide like the review surface; restricted callers only see their own proposals");
assert.ok(!applyBlock.slice(applyBlock.indexOf("greenlightMatch")).includes("userId: session.userId"), "the greenlight redirect counts office proposals, not only the caller's");
assert.ok(
  applyBlock.indexOf("OUTREACH_CHAT_APPROVAL_REDIRECT") < applyBlock.indexOf("return applyAgentProposal("),
  "an outreach proposal is redirected to the review surface before any apply",
);
assert.equal((applyBlock.match(/return applyAgentProposal\(/g) ?? []).length, 1, "only non-outreach proposals can be applied from chat");
assert.match(applyBlock, /kind: "OUTREACH_CAMPAIGN_START",\s*\},\s*\}\);\s*if \(pending > 0\) \{\s*return \{ reply: OUTREACH_CHAT_APPROVAL_REDIRECT \}/, "the greenlight phrase never applies a pending outreach proposal");
assert.match(OUTREACH_CHAT_APPROVAL_REDIRECT, /Pending approvals/, "the redirect names the review surface");
assert.match(OUTREACH_CHAT_APPROVAL_REDIRECT, /Nothing was sent/, "the redirect states that nothing happened");

const approvalActions = readFileSync("src/app/dashboard/supply-os/outreach-approval-actions.ts", "utf8");
const applyAction = approvalActions.slice(
  approvalActions.indexOf("export async function applyOutreachProposalAction"),
  approvalActions.indexOf("export async function discardOutreachProposalAction"),
);
assert.match(applyAction, /pending\.reviewItems\.filter\(\(item\) => !reviewed\.has\(item\.id\)\)/, "the apply action recomputes unread spot checks from the stored proposal, not from the client");
assert.ok(
  applyAction.indexOf("if (unreviewed.length > 0) {") < applyAction.indexOf("await applyPendingJobAgentProposal("),
  "an unread spot check blocks the apply before it reaches the proposal",
);
assert.ok(
  applyAction.indexOf("if (pending.blocker)") < applyAction.indexOf("await applyPendingJobAgentProposal("),
  "a proposal without rendered spot checks is refused server side before any apply",
);
assert.match(applyAction, /if \(!reviewer\.canApprove\) return/, "only approver sessions can apply");
assert.match(reviewModule, /const OUTREACH_APPROVER_ROLES = \["ADMIN", "MANAGER"\] as const;/, "campaign approval mirrors the procurement approval roles");
const reviewerResolver = reviewModule.slice(
  reviewModule.indexOf("export async function resolveOutreachReviewer"),
  reviewModule.indexOf("export async function chatApplyTargetsOutreachProposal"),
);
assert.match(approvalActions, /const reviewer = await resolveOutreachReviewer\(session\);/, "the actions share the live-access resolver with chat");
assert.match(reviewerResolver, /prisma\.user\.findFirst\(\{\s*where: \{ id: session\.userId, officeId: session\.officeId, isActive: true \}/, "approval rights come from the current user row, not the session cookie, so demoted or deactivated operators lose them at once");
assert.match(reviewerResolver, /if \(!user \|\| user\.role === "EMPLOYEE"\) return NO_ACCESS;/, "inactive users and loadboard operators see nothing");
assert.match(reviewerResolver, /canApprove: OUTREACH_APPROVER_ROLES\.some\(\(role\) => role === user\.role\)/, "approvers are operators with an approval role in the database; SALES plans but does not start campaigns");
assert.ok(!approvalActions.includes("session.role"), "the actions never trust the cookie role");
const discardAction = approvalActions.slice(approvalActions.indexOf("export async function discardOutreachProposalAction"));
assert.match(discardAction, /if \(!reviewer\.canApprove\) return/, "discard uses the same approver gate");
assert.match(applyAction, /officeWide: true,\s*kind: OUTREACH_PROPOSAL_KIND,/, "any approver in the office can start a colleague's planned campaign, matching what the list shows, and only an outreach proposal");
assert.match(discardAction, /kind: OUTREACH_PROPOSAL_KIND,/, "the outreach surface cannot discard job, inquiry, or inbox proposals");
const agentProposals = readFileSync("src/lib/agent-proposals.ts", "utf8");
assert.match(agentProposals, /if \(input\.userId && !input\.officeWide\) where\.userId = input\.userId;/, "officeWide only widens the lookup; the reviewer is still recorded through userId");
assert.match(agentProposals, /if \(input\.kind\) where\.kind = input\.kind;/, "the apply lookup honours the kind filter");
assert.ok(!readFileSync("src/app/dashboard/inbox/actions.ts", "utf8").includes("officeWide"), "inbox proposal applies keep their creator scope");

const outreachApply = agentProposals.slice(
  agentProposals.indexOf('action === "START_OUTREACH_CAMPAIGN"'),
  agentProposals.indexOf("} else {", agentProposals.indexOf('action === "START_OUTREACH_CAMPAIGN"')),
);
const claimIndex = outreachApply.indexOf("const claimed = await claimOutreachProposal(prisma, claim, input.userId ?? null);");
assert.ok(claimIndex >= 0, "the proposal is claimed with a compare-and-set from PENDING before the campaign is touched");
assert.ok(claimIndex < outreachApply.indexOf("await activateCampaign("), "the claim happens before activation");
assert.match(outreachApply, /if \(!claimed\) return \{ ok: false, proposalId: proposal\.id, message: NO_LONGER_PENDING_MESSAGE \};/, "a losing start performs no campaign side effect and reports the proposal is no longer pending");
assert.match(outreachApply, /finalize: \(tx\) => finalizeOutreachClaim\(tx, claim, /, "the proposal is finalized inside the activation transaction under the same claim");
assert.match(outreachApply, /catch \(error\) \{\s*await releaseOutreachClaim\(prisma, claim\);\s*throw error;/, "a failed activation call returns the proposal to PENDING only while this claim still owns it");
assert.match(outreachApply, /if \(!activation\.activated\) \{\s*await releaseOutreachClaim\(prisma, claim\);/, "a blocked activation returns the proposal to PENDING only while this claim still owns it");
assert.match(agentProposals, /if \(action !== "START_OUTREACH_CAMPAIGN"\) \{\s*await prisma\.agentProposal\.updateMany\(\{\s*where: \{ id: proposal\.id, officeId: input\.officeId, status: "PENDING" \}/, "other bulk actions finalize from PENDING; the outreach proposal is already finalized by its activation transaction");
const discardHelper = agentProposals.slice(agentProposals.indexOf("export async function discardPendingAgentProposal"));
assert.match(discardHelper, /const discarded = await prisma\.agentProposal\.updateMany\(\{\s*where: \{ id: proposal\.id, officeId: input\.officeId, status: "PENDING" \}/, "discard is a compare-and-set from PENDING, so it cannot overwrite a claimed or applied proposal");
assert.match(discardHelper, /if \(discarded\.count === 0\) return null;/, "a losing discard reports the proposal is no longer pending");
assert.match(discardHelper, /\.\.\.\(input\.kind \? \{ kind: input\.kind \} : \{\}\),/, "discard honours the kind filter");

const approvalsPanel = readFileSync("src/app/dashboard/supply-os/supply-os-outreach-approvals.tsx", "utf8");
assert.match(approvalsPanel, /proposal\.actionDetails\.map\(\(detail\) => <li key=\{detail\}>\{detail\}<\/li>\)/, "action details are rendered");
assert.match(approvalsPanel, /proposal\.reviewItems\.map\(\(item\) =>/, "every review item is rendered");
assert.match(approvalsPanel, /<pre className=\{styles\.approvalBody\}>\{item\.body\}<\/pre>/, "the rendered body is shown in full, not collapsed");
assert.ok(
  approvalsPanel.indexOf("{item.body}") < approvalsPanel.indexOf("Start campaign"),
  "the spot-check content precedes the apply control",
);
assert.match(approvalsPanel, /disabled=\{busy \|\| !canApprove \|\| !allRead\}/, "the apply control stays disabled until every item is marked read by an approver");
assert.match(approvalsPanel, /const allRead = !blocked && total > 0/, "a blocked proposal never counts as read");
assert.match(approvalsPanel, /if \(!loadError && \(!canView \|\| \(proposals\.length === 0 && !notice\)\)\) return null;/, "a confirmed no-access response hides the panel; a failed initial load is still shown");
assert.match(approvalsPanel, /catch \{\s*setLoadError\("Pending approvals could not be loaded\."\);/, "a failed load is tracked separately from action notices and access");
assert.match(approvalsPanel, /setProposals\(result\.proposals\);\s*setLoadError\(null\);/, "a later successful load clears the error");
assert.match(approvalsPanel, /const message = loadError \?\? notice;/, "the load error is what the panel shows when present");
const inventorySourcing = readFileSync("src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx", "utf8");
assert.match(inventorySourcing, /<SupplyOsOutreachApprovals refreshKey=\{0\} \/>/, "prospecting projects mount the approvals panel");
assert.match(inventorySourcing, /SupplyOsMail researchProjectId=\{selectedProject\.key\}/, "prospecting Messages scope office mail to the selected project");
const decisionQueue = readFileSync("src/lib/decision-queue.ts", "utf8");
assert.match(decisionQueue, /outreachProjectId[\s\S]*materialsView=projects&project=prospecting:/, "the decision queue links outreach proposals to their project when available");

// Approval can only start a draft; a cancelled, active, paused, or completed campaign is refused.
assert.equal(campaignStatusBlocker("DRAFT"), null);
for (const status of ["CANCELLED", "ACTIVE", "PAUSED", "COMPLETED"]) {
  assert.match(campaignStatusBlocker(status) ?? "", new RegExp(`is ${status.toLowerCase()}, not a draft`), `${status} campaigns cannot be started by approval`);
}
const outreachCampaigns = readFileSync("src/lib/outreach-campaigns.ts", "utf8");
const activate = outreachCampaigns.slice(
  outreachCampaigns.indexOf("export async function activateCampaign"),
  outreachCampaigns.indexOf("export async function pauseCampaign"),
);
assert.ok(
  activate.indexOf("campaignStatusBlocker(campaign.status)") < activate.indexOf("eligibleRecords(campaign, true)"),
  "the status precondition runs before any audience or revision work",
);
assert.match(activate, /prisma\.\$transaction\(async \(tx\) => \{\s*const written = await tx\.outreachCampaign\.updateMany\(\{\s*where: campaignActivationTransitionWhere\(\{\s*officeId: input\.officeId,\s*campaignId: campaign\.id,\s*revisionHash: campaign\.revisionHash,\s*\}\)/, "activation is a compare-and-set from DRAFT on the reviewed revision inside a transaction, so a cancel or re-plan racing the approval wins");
assert.match(activate, /approvedAt: now,\s*startedAt: now,/, "activation stamps approvedAt in the same write that leaves DRAFT; recovery relies on it");
assert.match(activate, /if \(written\.count > 0 && input\.finalize && !\(await input\.finalize\(tx\)\)\) throw new ClaimLostError\(\);/, "a claim that no longer belongs to the caller rolls the activation back inside the transaction");
assert.match(activate, /if \(error instanceof ClaimLostError\) return \{ activated: false, blockers: \[CAMPAIGN_CLAIM_LOST_BLOCKER\] \};/, "a lost claim is reported as a blocker, not thrown");
assert.match(activate, /if \(updated\.count === 0\) \{/, "a lost activation race reports a blocker instead of success");

// A claim left in APPLYING by an interrupted approval is settled from the campaign state.
type FakeProposal = { id: string; officeId: string; kind: string; status: string; reviewedAt: Date | null; reviewedByUserId: string | null; payload: unknown; reviewNote?: string };
function fakeClaimDb(proposals: FakeProposal[], campaigns: Array<{ id: string; officeId: string; approvedAt: Date | null }>) {
  const updates: Array<{ id: string; status: string }> = [];
  return {
    updates,
    db: {
      agentProposal: {
        findMany: async (args: { where: { officeId: string; kind: string; status: string; reviewedAt: { lt: Date } } }) => proposals.filter((proposal) =>
          proposal.officeId === args.where.officeId
          && proposal.kind === args.where.kind
          && proposal.status === args.where.status
          && proposal.reviewedAt !== null
          && proposal.reviewedAt < args.where.reviewedAt.lt),
        updateMany: async (args: { where: { id: string; officeId: string; status: string; reviewedAt?: Date }; data: { status: string; reviewedByUserId?: string | null; reviewedAt?: Date | null; reviewNote?: string } }) => {
          const target = proposals.find((proposal) =>
            proposal.id === args.where.id
            && proposal.officeId === args.where.officeId
            && proposal.status === args.where.status
            && (args.where.reviewedAt === undefined || proposal.reviewedAt?.getTime() === args.where.reviewedAt.getTime()));
          if (!target) return { count: 0 };
          target.status = args.data.status;
          if (args.data.reviewedByUserId !== undefined) target.reviewedByUserId = args.data.reviewedByUserId;
          if (args.data.reviewedAt !== undefined) target.reviewedAt = args.data.reviewedAt;
          if (args.data.reviewNote) target.reviewNote = args.data.reviewNote;
          updates.push({ id: target.id, status: target.status });
          return { count: 1 };
        },
      },
      outreachCampaign: {
        findFirst: async (args: { where: { id: string; officeId: string } }) => campaigns.find((campaign) => campaign.id === args.where.id && campaign.officeId === args.where.officeId) ?? null,
      },
    } as never,
  };
}
const now = new Date("2026-09-02T12:00:00Z");
const staleAt = new Date(now.getTime() - STALE_OUTREACH_CLAIM_MS - 1_000);
const freshAt = new Date(now.getTime() - 10_000);
const outreachPayload = (campaignId: string) => ({ entity: "bulk", action: "START_OUTREACH_CAMPAIGN", actionInput: { campaignId } });
const claimProposals: FakeProposal[] = [
  { id: "p-activated", officeId: "office-1", kind: "OUTREACH_CAMPAIGN_START", status: "APPLYING", reviewedAt: staleAt, reviewedByUserId: "reviewer-1", payload: outreachPayload("c-activated") },
  { id: "p-never", officeId: "office-1", kind: "OUTREACH_CAMPAIGN_START", status: "APPLYING", reviewedAt: staleAt, reviewedByUserId: "reviewer-1", payload: outreachPayload("c-draft") },
  { id: "p-fresh", officeId: "office-1", kind: "OUTREACH_CAMPAIGN_START", status: "APPLYING", reviewedAt: freshAt, reviewedByUserId: "reviewer-1", payload: outreachPayload("c-draft") },
  { id: "p-other-office", officeId: "office-2", kind: "OUTREACH_CAMPAIGN_START", status: "APPLYING", reviewedAt: staleAt, reviewedByUserId: "reviewer-2", payload: outreachPayload("c-activated") },
  { id: "p-other-kind", officeId: "office-1", kind: "JOB_UPDATE", status: "APPLYING", reviewedAt: staleAt, reviewedByUserId: "reviewer-1", payload: {} },
];
const claimFixture = fakeClaimDb(claimProposals, [
  { id: "c-activated", officeId: "office-1", approvedAt: new Date(now.getTime() - STALE_OUTREACH_CLAIM_MS) },
  { id: "c-draft", officeId: "office-1", approvedAt: null },
]);
async function reconcileChecks() {
  const outcomes = await reconcileStaleOutreachClaims("office-1", { now, db: claimFixture.db });
  assert.deepEqual(outcomes, [
    { proposalId: "p-activated", outcome: "finalized" },
    { proposalId: "p-never", outcome: "released" },
  ], "an activated campaign finalizes its proposal; one still in draft releases the claim");
  assert.equal(claimProposals.find((proposal) => proposal.id === "p-activated")?.status, "APPLIED");
  assert.equal(claimProposals.find((proposal) => proposal.id === "p-activated")?.reviewedByUserId, "reviewer-1", "the reviewer recorded at claim time is kept on finalize");
  assert.match(claimProposals.find((proposal) => proposal.id === "p-activated")?.reviewNote ?? "", /Finalized after the approving request was interrupted/);
  assert.equal(claimProposals.find((proposal) => proposal.id === "p-never")?.status, "PENDING");
  assert.equal(claimProposals.find((proposal) => proposal.id === "p-never")?.reviewedByUserId, null, "a released claim forgets the interrupted reviewer");
  assert.equal(claimProposals.find((proposal) => proposal.id === "p-fresh")?.status, "APPLYING", "an in-flight claim inside the stale window is left alone");
  assert.equal(claimProposals.find((proposal) => proposal.id === "p-other-office")?.status, "APPLYING", "reconciliation is office scoped");
  assert.equal(claimProposals.find((proposal) => proposal.id === "p-other-kind")?.status, "APPLYING", "reconciliation only touches outreach proposals");
  const reviewSource = readFileSync("src/lib/outreach-proposal-review.ts", "utf8");
  assert.match(reviewSource, /export async function listPendingOutreachProposals\(officeId: string\)[^{]*\{\s*await reconcileStaleOutreachClaims\(officeId\);/, "the review surface settles stale claims before listing, so apply and discard see the recovered state");
  const reconcileBlock = reviewSource.slice(reviewSource.indexOf("export async function reconcileStaleOutreachClaims"), reviewSource.indexOf("export type OutreachClaimDb"));
  assert.match(reconcileBlock, /select: \{ id: true, payload: true, reviewedAt: true \}/, "reconciliation selects the claim token it will settle");
  assert.equal((reconcileBlock.match(/where: ownedClaimWhere\(claim\)/g) ?? []).length, 2, "both the finalize and the release write match the selected token, never status alone");
  assert.doesNotMatch(reconcileBlock, /where: \{ id: proposal\.id, officeId, status: "APPLYING" \}/);
}

// A claim released by stale recovery cannot be finalized or released by the request that made it,
// so an activation that resumes after its claim expired cannot start the campaign.
async function claimOwnershipChecks() {
  const claimedAt = new Date("2026-09-02T11:00:00Z");
  const proposals: FakeProposal[] = [
    { id: "p-race", officeId: "office-1", kind: "OUTREACH_CAMPAIGN_START", status: "PENDING", reviewedAt: null, reviewedByUserId: null, payload: outreachPayload("c-race") },
  ];
  const fixture = fakeClaimDb(proposals, [{ id: "c-race", officeId: "office-1", approvedAt: null }]);
  const db = fixture.db as unknown as Parameters<typeof claimOutreachProposal>[0];
  const claim = { proposalId: "p-race", officeId: "office-1", claimedAt };
  const proposal = () => proposals[0];

  // 1. Approval claims the proposal.
  assert.equal(await claimOutreachProposal(db, claim, "reviewer-1"), true);
  assert.equal(proposal().status, "APPLYING");
  assert.equal(await claimOutreachProposal(db, { ...claim, claimedAt: new Date(claimedAt.getTime() + 1) }, "reviewer-2"), false, "a second start loses the claim");

  // 2-3. The activation stalls past the stale window and recovery releases the claim.
  const later = new Date(claimedAt.getTime() + STALE_OUTREACH_CLAIM_MS + 1_000);
  assert.deepEqual(await reconcileStaleOutreachClaims("office-1", { now: later, db: fixture.db }), [{ proposalId: "p-race", outcome: "released" }]);
  assert.equal(proposal().status, "PENDING");

  // 5-6. The original activation resumes: its finalize is refused, which rolls the campaign write back.
  assert.equal(await finalizeOutreachClaim(db, claim, { userId: "reviewer-1", note: "late" }), false, "an expired claim cannot finalize");
  assert.equal(proposal().status, "PENDING", "the proposal stays pending for a fresh decision");
  assert.equal(await releaseOutreachClaim(db, claim), false, "the expired claim cannot release anything either");

  // 4. A second approval claims it afresh; the stale request still cannot touch it.
  const secondClaim = { proposalId: "p-race", officeId: "office-1", claimedAt: new Date(later.getTime() + 1_000) };
  assert.equal(await claimOutreachProposal(db, secondClaim, "reviewer-2"), true);
  assert.equal(await finalizeOutreachClaim(db, claim, { userId: "reviewer-1", note: "late" }), false, "the stale request cannot finalize a colleague's live claim");
  assert.equal(await releaseOutreachClaim(db, claim), false, "the stale request cannot release a colleague's live claim");
  assert.equal(proposal().status, "APPLYING");
  assert.equal(proposal().reviewedByUserId, "reviewer-2");

  // The live claim finalizes normally.
  assert.equal(await finalizeOutreachClaim(db, secondClaim, { userId: "reviewer-2", note: "Activated outreach campaign c-race." }), true);
  assert.equal(proposal().status, "APPLIED");
  assert.equal(proposal().reviewNote, "Activated outreach campaign c-race.");
  assert.equal(await releaseOutreachClaim(db, secondClaim), false, "an applied proposal is never released");

  // A discard that wins after a release also blocks the stale request.
  const discardable: FakeProposal[] = [
    { id: "p-discard", officeId: "office-1", kind: "OUTREACH_CAMPAIGN_START", status: "PENDING", reviewedAt: null, reviewedByUserId: null, payload: outreachPayload("c-discard") },
  ];
  const discardDb = fakeClaimDb(discardable, [{ id: "c-discard", officeId: "office-1", approvedAt: null }]).db as unknown as Parameters<typeof claimOutreachProposal>[0];
  const discardClaim = { proposalId: "p-discard", officeId: "office-1", claimedAt };
  assert.equal(await claimOutreachProposal(discardDb, discardClaim, "reviewer-1"), true);
  await reconcileStaleOutreachClaims("office-1", { now: later, db: discardDb as never });
  discardable[0].status = "DISCARDED";
  assert.equal(await finalizeOutreachClaim(discardDb, discardClaim, { userId: "reviewer-1", note: "late" }), false, "a discarded proposal cannot be finalized by the interrupted approval");
  assert.equal(discardable[0].status, "DISCARDED");

  // Recovery holds the same invariant: a reconciler that selected a stale row but writes after another
  // path released it and a reviewer re-claimed it must leave the fresh claim alone.
  const contested: FakeProposal[] = [
    { id: "p-contested", officeId: "office-1", kind: "OUTREACH_CAMPAIGN_START", status: "APPLYING", reviewedAt: claimedAt, reviewedByUserId: "reviewer-1", payload: outreachPayload("c-contested") },
  ];
  type ReconcileDb = NonNullable<NonNullable<Parameters<typeof reconcileStaleOutreachClaims>[1]>["db"]>;
  const contestedFixture = fakeClaimDb(contested, [{ id: "c-contested", officeId: "office-1", approvedAt: null }]);
  const contestedFixtureDb = contestedFixture.db as unknown as ReconcileDb;
  const contestedDb = contestedFixture.db as unknown as Parameters<typeof claimOutreachProposal>[0];
  const freshClaim = { proposalId: "p-contested", officeId: "office-1", claimedAt: new Date(later.getTime() + 5_000) };
  const slowReconcilerDb = {
    agentProposal: contestedFixtureDb.agentProposal,
    outreachCampaign: {
      findFirst: async () => {
        // Between the stale select and the write, a second reconciler releases and a reviewer re-claims.
        await reconcileStaleOutreachClaims("office-1", { now: later, db: contestedFixtureDb });
        assert.equal(contested[0].status, "PENDING");
        assert.equal(await claimOutreachProposal(contestedDb, freshClaim, "reviewer-2"), true);
        return { approvedAt: null };
      },
    },
  } as unknown as ReconcileDb;
  assert.deepEqual(
    await reconcileStaleOutreachClaims("office-1", { now: later, db: slowReconcilerDb }),
    [],
    "the delayed reconciler reports nothing because its selected token no longer matches",
  );
  assert.equal(contested[0].status, "APPLYING", "the fresh claim survives the delayed reconciler");
  assert.equal(contested[0].reviewedByUserId, "reviewer-2");
  assert.equal(contested[0].reviewedAt?.getTime(), freshClaim.claimedAt.getTime());
}

reconcileChecks().then(claimOwnershipChecks).then(() => {
  console.log("batch-review: all assertions passed");
}, (error: unknown) => {
  console.error(error);
  process.exit(1);
});
