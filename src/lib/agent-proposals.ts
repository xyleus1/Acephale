import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyAddMilestone, applyRenameCompany, applySetCustomer } from "@/lib/agent-actions";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { awardSupplier } from "@/lib/sourcing-award";
import { recordTargetPriceHistory, targetPriceChanged } from "@/lib/target-price-history";
import { buildAgentProposalDecisionImpact } from "@/lib/agent-proposal-impact";
import { filterScopedProposalFields } from "@/lib/agent-proposal-scope";
import { buildReviewedFieldChanges, type ReviewedFieldChange } from "@/lib/agent-proposal-review";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import { CLOSED_INQUIRY_STATUSES } from "@/lib/inquiry-status";

export type AgentProposalApplyResult = {
  ok: boolean;
  message: string;
  proposalId?: string;
  jobId?: string;
  inquiryId?: string | null;
};

type ApplyJobProposalInput = {
  officeId: string;
  userId?: string | null;
  requestedId?: string;
  proposalId?: string;
  acceptedFields?: string[] | null;
};

type JobActionProposalType =
  | "ADD_MILESTONE"
  | "SET_CUSTOMER"
  | "RENAME_COMPANY"
  | "AWARD_SUPPLIER"
  | "LINK_THREADS_TO_JOB";

type BulkActionProposalType =
  | "HIDE_THREADS"
  | "DEDUP_INQUIRIES"
  | "MERGE_INQUIRIES_INTO_ONE";

// Open = anything not closed; custom statuses added on the RFQ sheet stay open.
function isOpenInquiryStatus(status: string): boolean {
  return !CLOSED_INQUIRY_STATUSES.includes(status);
}

function proposalWhere(input: ApplyJobProposalInput): Prisma.AgentProposalWhereInput {
  const where: Prisma.AgentProposalWhereInput = {
    officeId: input.officeId,
    status: "PENDING",
  };
  if (input.userId) where.userId = input.userId;
  if (input.proposalId) {
    where.id = input.proposalId;
  } else if (input.requestedId) {
    where.OR = [
      { id: input.requestedId },
      { id: { startsWith: input.requestedId } },
    ];
  }
  return where;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

async function recordAgentProposalCreated(input: {
  officeId: string;
  userId?: string | null;
  proposal: {
    id: string;
    jobId: string | null;
    inquiryId: string | null;
    kind: string;
    status: string;
    sourceType: string | null;
    sourcePreview: string | null;
    createdAt: Date;
  };
  payload: Record<string, unknown>;
}) {
  await recordMemoryEvent({
    officeId: input.officeId,
    sourceType: "AGENT",
    sourceExternalId: `agent_proposal:${input.proposal.id}`,
    sourceLabel: "Agent proposal",
    eventType: "agent_proposal.created",
    entityType: "agent_proposal",
    entityId: input.proposal.id,
    actorType: input.userId ? "user" : "agent",
    actorId: input.userId ?? null,
    occurredAt: input.proposal.createdAt,
    payloadVersion: 1,
    payload: {
      proposalId: input.proposal.id,
      kind: input.proposal.kind,
      status: input.proposal.status,
      jobId: input.proposal.jobId,
      inquiryId: input.proposal.inquiryId,
      sourceType: input.proposal.sourceType,
      sourcePreview: input.proposal.sourcePreview?.slice(0, 700) ?? null,
      ...input.payload,
    },
    provenance: {
      source: "agent_proposals",
      operation: "create_agent_proposal",
      path: "src/lib/agent-proposals.ts",
      function: "recordAgentProposalCreated",
      sourceRecordId: input.proposal.id,
      actorType: input.userId ? "user" : "agent",
      actorId: input.userId ?? null,
    },
    idempotencyKey: `agent_proposal:${input.proposal.id}:created`,
  }).catch(() => null);
}

function compactValue(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value == null || value === "") return "blank";
  return String(value);
}

async function loadJobForProposal(jobId: string, officeId: string) {
  return prisma.job.findFirst({
    where: { id: jobId, officeId },
    include: {
      inquiry: true,
      company: { select: { id: true, name: true } },
      documents: { select: { id: true, name: true, status: true, docType: true, aiSummary: true, aiFlags: true, aiKeyFields: true } },
    },
  });
}

export async function createPendingJobUpdateProposal(input: {
  officeId: string;
  userId?: string | null;
  jobId: string;
  kind: string;
  sourceType?: string | null;
  sourcePreview?: string | null;
  update?: Record<string, unknown>;
  inquiryUpdate?: Record<string, unknown>;
  fieldLabels?: Record<string, string>;
  toolTrace?: Record<string, unknown>;
}) {
  const update = input.update ?? {};
  const inquiryUpdate = input.inquiryUpdate ?? {};
  if (Object.keys(update).length === 0 && Object.keys(inquiryUpdate).length === 0) {
    return { ok: false as const, error: "No recognized fields to propose." };
  }

  const job = await loadJobForProposal(input.jobId, input.officeId);
  if (!job) return { ok: false as const, error: "Job not found." };

  const fieldLabels = input.fieldLabels ?? {};
  const appliedLabels = [
    ...Object.entries(update).map(([field, value]) => `${fieldLabels[field] ?? field}: ${compactValue(value)}`),
    ...Object.entries(inquiryUpdate).map(([field, value]) => `RFQ ${fieldLabels[field] ?? field}: ${compactValue(value)}`),
  ];
  const decisionImpact = buildAgentProposalDecisionImpact({ current: job, update, inquiryUpdate });
  const qualification = {
    isMature: decisionImpact.after.mature,
    followUpQuestions: decisionImpact.after.missing,
  };

  const proposal = await prisma.agentProposal.create({
    data: {
      officeId: input.officeId,
      userId: input.userId ?? null,
      jobId: job.id,
      inquiryId: job.inquiryId,
      kind: input.kind,
      sourceType: input.sourceType ?? "AGENT_TOOL",
      sourcePreview: input.sourcePreview?.slice(0, 700) ?? null,
      toolTrace: toJson({
        ...(input.toolTrace ?? {}),
        proposedJobFields: Object.keys(update),
        proposedInquiryFields: Object.keys(inquiryUpdate),
        matureAfterApply: qualification.isMature,
        missingAfterApply: qualification.followUpQuestions,
        decisionImpact,
      }),
      payload: toJson({
        entity: "job",
        update,
        inquiryUpdate,
        fieldLabels,
        appliedLabels,
        skippedLabels: [],
        qualification,
        decisionImpact,
        sourceText: input.sourcePreview?.slice(0, 4000) ?? null,
      }),
    },
  });
  await recordAgentProposalCreated({
    officeId: input.officeId,
    userId: input.userId,
    proposal,
    payload: {
      proposalType: "job_update",
      proposedJobFields: Object.keys(update),
      proposedInquiryFields: Object.keys(inquiryUpdate),
      matureAfterApply: qualification.isMature,
      missingAfterApply: qualification.followUpQuestions,
    },
  });

  revalidatePath(`/dashboard/jobs/${job.id}`);
  if (job.inquiryId) revalidatePath(`/dashboard/rfq/${job.inquiryId}`);
  revalidatePath("/dashboard");

  return {
    ok: true as const,
    proposalId: proposal.id,
    jobId: job.id,
    inquiryId: job.inquiryId,
    message: `Created review proposal ${proposal.id.slice(0, 8)} for ${job.reference}. Nothing changed yet; open the job and apply or discard it.`,
  };
}

export async function createPendingJobActionProposal(input: {
  officeId: string;
  userId?: string | null;
  jobId: string;
  kind: string;
  action: JobActionProposalType;
  actionInput: Record<string, unknown>;
  actionLabel: string;
  actionDetails?: string[];
  sourceType?: string | null;
  sourcePreview?: string | null;
  toolTrace?: Record<string, unknown>;
}) {
  const job = await loadJobForProposal(input.jobId, input.officeId);
  if (!job) return { ok: false as const, error: "Job not found." };

  const proposal = await prisma.agentProposal.create({
    data: {
      officeId: input.officeId,
      userId: input.userId ?? null,
      jobId: job.id,
      inquiryId: job.inquiryId,
      kind: input.kind,
      sourceType: input.sourceType ?? "AGENT_TOOL",
      sourcePreview: input.sourcePreview?.slice(0, 700) ?? null,
      toolTrace: toJson({
        ...(input.toolTrace ?? {}),
        action: input.action,
        requiresHumanReview: true,
      }),
      payload: toJson({
        entity: "job",
        action: input.action,
        actionInput: input.actionInput,
        actionLabel: input.actionLabel,
        actionDetails: input.actionDetails ?? [],
        sourceText: input.sourcePreview?.slice(0, 4000) ?? null,
      }),
    },
  });
  await recordAgentProposalCreated({
    officeId: input.officeId,
    userId: input.userId,
    proposal,
    payload: {
      proposalType: "job_action",
      action: input.action,
      actionLabel: input.actionLabel,
      actionDetails: input.actionDetails ?? [],
      requiresHumanReview: true,
    },
  });

  revalidatePath(`/dashboard/jobs/${job.id}`);
  revalidatePath("/dashboard");

  return {
    ok: true as const,
    proposalId: proposal.id,
    jobId: job.id,
    inquiryId: job.inquiryId,
    message: `Created review proposal ${proposal.id.slice(0, 8)} for ${job.reference}. Nothing changed yet; open the job and apply or discard it.`,
  };
}

export async function createPendingBulkActionProposal(input: {
  officeId: string;
  userId?: string | null;
  kind: string;
  action: BulkActionProposalType;
  actionInput: Record<string, unknown>;
  actionLabel: string;
  actionDetails?: string[];
  reviewItems?: Record<string, unknown>[];
  sourceType?: string | null;
  sourcePreview?: string | null;
  toolTrace?: Record<string, unknown>;
}) {
  const reviewItems = input.reviewItems ?? [];
  if (reviewItems.length === 0) {
    return { ok: false as const, error: "No reviewable records found for this proposal." };
  }

  const proposal = await prisma.agentProposal.create({
    data: {
      officeId: input.officeId,
      userId: input.userId ?? null,
      kind: input.kind,
      sourceType: input.sourceType ?? "AGENT_TOOL",
      sourcePreview: input.sourcePreview?.slice(0, 700) ?? null,
      toolTrace: toJson({
        ...(input.toolTrace ?? {}),
        action: input.action,
        reviewItemCount: reviewItems.length,
        appliedImmediately: false,
        requiresHumanReview: true,
      }),
      payload: toJson({
        entity: "bulk",
        action: input.action,
        actionInput: input.actionInput,
        actionLabel: input.actionLabel,
        actionDetails: input.actionDetails ?? [],
        reviewItems,
        sourceText: input.sourcePreview?.slice(0, 4000) ?? null,
      }),
    },
  });
  await recordAgentProposalCreated({
    officeId: input.officeId,
    userId: input.userId,
    proposal,
    payload: {
      proposalType: "bulk_action",
      action: input.action,
      actionLabel: input.actionLabel,
      actionDetails: input.actionDetails ?? [],
      reviewItemCount: reviewItems.length,
      requiresHumanReview: true,
    },
  });

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard");

  return {
    ok: true as const,
    proposalId: proposal.id,
    message: `Created review proposal ${proposal.id.slice(0, 8)}. Nothing changed yet; review the listed records before applying it.`,
  };
}

export async function createPendingBulkHideThreadsProposal(input: {
  officeId: string;
  userId?: string | null;
  threadIds: string[];
  kind?: string;
  reason?: string;
  sourceType?: string | null;
  sourcePreview?: string | null;
  toolTrace?: Record<string, unknown>;
}) {
  const threadIds = [...new Set(input.threadIds.filter((id) => id.trim().length > 0))];
  if (threadIds.length === 0) return { ok: false as const, error: "No threads selected." };

  const threads = await prisma.emailThread.findMany({
    where: { id: { in: threadIds }, officeId: input.officeId },
    select: {
      id: true,
      subject: true,
      hiddenAt: true,
      snoozedUntil: true,
      lastMessageAt: true,
      job: { select: { reference: true } },
      inquiry: { select: { subject: true } },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { fromEmail: true, fromName: true, classification: true, classificationReason: true, bodyText: true, sentAt: true },
      },
    },
  });
  const visibleThreads = threads.filter((thread) => !thread.hiddenAt);
  if (visibleThreads.length === 0) return { ok: false as const, error: "No visible threads found to hide." };

  const reviewItems = visibleThreads.map((thread) => {
    const last = thread.messages[0];
    const linkedTo = thread.job?.reference ?? thread.inquiry?.subject ?? null;
    return {
      id: thread.id,
      title: thread.subject || "(no subject)",
      meta: [
        last?.classification ?? "UNCLASSIFIED",
        last?.fromName ?? last?.fromEmail ?? "unknown sender",
        linkedTo ? `linked: ${linkedTo}` : "unlinked",
      ].filter(Boolean).join(" · "),
      detail: last?.classificationReason ?? last?.bodyText?.replace(/\s+/g, " ").trim().slice(0, 220) ?? null,
      lastMessageAt: thread.lastMessageAt.toISOString(),
    };
  });

  return createPendingBulkActionProposal({
    officeId: input.officeId,
    userId: input.userId,
    kind: input.kind ?? "BULK_HIDE_THREADS",
    action: "HIDE_THREADS",
    actionInput: { threadIds: visibleThreads.map((thread) => thread.id), reason: input.reason ?? null },
    actionLabel: `Hide ${visibleThreads.length} inbox thread${visibleThreads.length === 1 ? "" : "s"}`,
    actionDetails: [
      "Threads will be hidden from the default Inbox.",
      "The email records stay in the database and can still be found under Hidden or All.",
      input.reason ? `Reason: ${input.reason}` : "",
    ].filter(Boolean),
    reviewItems,
    sourceType: input.sourceType ?? "INBOX_BULK_ACTION",
    sourcePreview: input.sourcePreview ?? `${visibleThreads.length} selected inbox thread${visibleThreads.length === 1 ? "" : "s"} proposed for hide.`,
    toolTrace: input.toolTrace,
  });
}

async function recordProposalReviewEvent(input: {
  officeId: string;
  userId?: string | null;
  proposal: {
    id: string;
    jobId: string | null;
    inquiryId: string | null;
    kind: string;
    sourceType: string | null;
    sourcePreview: string | null;
  };
  status: "APPLIED" | "DISCARDED";
  decision: string;
  note: string;
  acceptedFields?: string[];
  changedJobFields?: string[];
  changedInquiryFields?: string[];
  reviewedFieldChanges?: ReviewedFieldChange[];
  decisionImpact?: unknown;
}) {
  const payload = {
    userId: input.userId ?? null,
    proposalId: input.proposal.id,
    kind: input.proposal.kind,
    status: input.status,
    decision: input.decision,
    note: input.note,
    acceptedFields: input.acceptedFields ?? [],
    changedJobFields: input.changedJobFields ?? [],
    changedInquiryFields: input.changedInquiryFields ?? [],
    reviewedFieldChanges: input.reviewedFieldChanges ?? [],
    decisionImpact: input.decisionImpact ?? null,
    sourceType: input.proposal.sourceType,
    sourcePreview: input.proposal.sourcePreview?.slice(0, 700) ?? null,
  };
  const event = await prisma.event.create({
    data: {
      officeId: input.officeId,
      type: "agent.proposal_reviewed",
      entityType: input.proposal.jobId ? "job" : input.proposal.inquiryId ? "inquiry" : "agent_proposal",
      entityId: input.proposal.jobId ?? input.proposal.inquiryId ?? input.proposal.id,
      payload: toJson(payload),
    },
  }).catch(() => null);
  await recordMemoryEvent({
    officeId: input.officeId,
    sourceType: "AGENT",
    sourceExternalId: `agent_proposal:${input.proposal.id}`,
    sourceLabel: "Agent proposal review",
    eventType: "agent_proposal.reviewed",
    entityType: "agent_proposal",
    entityId: input.proposal.id,
    actorType: input.userId ? "user" : "system",
    actorId: input.userId ?? null,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      ...payload,
      eventId: event?.id ?? null,
      jobId: input.proposal.jobId,
      inquiryId: input.proposal.inquiryId,
    },
    provenance: {
      source: "agent_proposals",
      operation: "review_agent_proposal",
      path: "src/lib/agent-proposals.ts",
      function: "recordProposalReviewEvent",
      sourceRecordId: input.proposal.id,
      actorType: input.userId ? "user" : "system",
      actorId: input.userId ?? null,
    },
    idempotencyKey: `agent_proposal:${input.proposal.id}:reviewed:${input.status}`,
  }).catch(() => null);
}

async function appendInquiryAuditNote(inquiryId: string, note: string) {
  await prisma.$executeRaw`UPDATE "Inquiry" SET "notes" = COALESCE("notes", '') || ${note} WHERE "id" = ${inquiryId}`;
}

async function applyDedupClusters(officeId: string, clusters: Record<string, unknown>[]) {
  let clusterCount = 0;
  let mergedCount = 0;
  const affectedInquiryIds: string[] = [];

  for (const cluster of clusters) {
    const keeperInquiryId = typeof cluster.keeperInquiryId === "string" ? cluster.keeperInquiryId : "";
    const loserInquiryIds = asStringArray(cluster.loserInquiryIds);
    if (!keeperInquiryId || loserInquiryIds.length === 0) continue;
    const ids = [keeperInquiryId, ...loserInquiryIds];
    const inquiries = await prisma.inquiry.findMany({
      where: { id: { in: ids }, officeId },
      include: { job: { select: { id: true, status: true } } },
    });
    const inquiryById = new Map(inquiries.map((inquiry) => [inquiry.id, inquiry]));
    const keeper = inquiryById.get(keeperInquiryId);
    if (!keeper) continue;
    const losers: typeof inquiries = [];
    for (const loserInquiryId of loserInquiryIds) {
      const loser = inquiryById.get(loserInquiryId);
      if (loser) losers.push(loser);
    }
    if (losers.length === 0) continue;
    const unsafe = [keeper, ...losers].some((inquiry) =>
      !isOpenInquiryStatus(inquiry.status) || (inquiry.job && inquiry.job.status !== "PROPOSED")
    );
    if (unsafe) continue;

    for (const loser of losers) {
      await prisma.emailThread.updateMany({
        where: { inquiryId: loser.id, officeId },
        data: { inquiryId: keeper.id },
      });
      if (loser.job?.id) {
        await prisma.job.deleteMany({ where: { id: loser.job.id, officeId, status: "PROPOSED" } }).catch(() => {});
      }
      await prisma.carrierQuote.deleteMany({ where: { inquiryId: loser.id, inquiry: { officeId } } }).catch(() => {});
      await prisma.inquiry.deleteMany({ where: { id: loser.id, officeId } }).catch(() => {});
      affectedInquiryIds.push(loser.id);
      mergedCount++;
    }

    const reason = typeof cluster.reason === "string" ? cluster.reason : "Reviewed duplicate proposal";
    const note = `\n\n[Reviewed merge ${new Date().toISOString().split("T")[0]}: merged ${losers.length} duplicate inquir${losers.length === 1 ? "y" : "ies"} - ${reason}]`;
    await appendInquiryAuditNote(keeper.id, note);
    affectedInquiryIds.push(keeper.id);
    clusterCount++;
  }

  return { clusterCount, mergedCount, affectedInquiryIds: [...new Set(affectedInquiryIds)] };
}

async function applyMergeAllOpenInquiries(officeId: string, actionInput: Record<string, unknown>) {
  const keeperInquiryId = typeof actionInput.keeperInquiryId === "string" ? actionInput.keeperInquiryId : "";
  const loserInquiryIds = asStringArray(actionInput.loserInquiryIds);
  if (!keeperInquiryId || loserInquiryIds.length === 0) {
    return { ok: false as const, message: "Merge proposal is missing a keeper or loser inquiries." };
  }

  const ids = [keeperInquiryId, ...loserInquiryIds];
  const inquiries = await prisma.inquiry.findMany({
    where: { id: { in: ids }, officeId },
    include: { job: { select: { id: true, status: true } } },
  });
  const inquiryById = new Map(inquiries.map((inquiry) => [inquiry.id, inquiry]));
  const keeper = inquiryById.get(keeperInquiryId);
  if (!keeper) return { ok: false as const, message: "Merge keeper no longer exists. Nothing changed." };
  const losers: typeof inquiries = [];
  for (const loserInquiryId of loserInquiryIds) {
    const loser = inquiryById.get(loserInquiryId);
    if (loser) losers.push(loser);
  }
  if (losers.length === 0) return { ok: false as const, message: "No proposed loser inquiries still exist. Nothing changed." };
  const unsafe = [keeper, ...losers].some((inquiry) =>
    !isOpenInquiryStatus(inquiry.status) || (inquiry.job && inquiry.job.status !== "PROPOSED")
  );
  if (unsafe) {
    return { ok: false as const, message: "At least one inquiry became a real job or closed after the proposal was created. Nothing changed." };
  }

  for (const loser of losers) {
    await prisma.emailThread.updateMany({
      where: { inquiryId: loser.id, officeId },
      data: { inquiryId: keeper.id },
    });
    if (loser.job?.id) {
      await prisma.job.deleteMany({ where: { id: loser.job.id, officeId, status: "PROPOSED" } }).catch(() => {});
    }
    await prisma.carrierQuote.deleteMany({ where: { inquiryId: loser.id, inquiry: { officeId } } }).catch(() => {});
    await prisma.inquiry.deleteMany({ where: { id: loser.id, officeId } }).catch(() => {});
  }

  const update: Prisma.InquiryUpdateManyMutationInput = {};
  const subject = typeof actionInput.subject === "string" ? actionInput.subject.trim() : "";
  const commodity = typeof actionInput.commodity === "string" ? actionInput.commodity.trim() : "";
  const origin = typeof actionInput.origin === "string" ? actionInput.origin.trim() : "";
  const destination = typeof actionInput.destination === "string" ? actionInput.destination.trim() : "";
  const weightKg = typeof actionInput.weightKg === "number" && Number.isFinite(actionInput.weightKg) ? actionInput.weightKg : null;
  if (subject) update.subject = subject.slice(0, 200);
  if (commodity) update.commodity = commodity.slice(0, 200);
  if (origin) update.origin = origin.slice(0, 200);
  if (destination) update.destination = destination.slice(0, 200);
  if (weightKg != null) update.weight = weightKg;
  if (Object.keys(update).length > 0) {
    await prisma.inquiry.updateMany({ where: { id: keeper.id, officeId }, data: update });
  }
  const note = `\n\n[Reviewed consolidation ${new Date().toISOString().split("T")[0]}: merged ${losers.length} inquir${losers.length === 1 ? "y" : "ies"} into this deal: ${losers.map((loser) => `"${loser.subject}"`).join(", ")}]`;
  await appendInquiryAuditNote(keeper.id, note);

  const keeperJob = await prisma.job.findFirst({
    where: { inquiryId: keeper.id, officeId },
    select: { id: true, commodity: true, origin: true, destination: true, weight: true },
  });
  if (keeperJob) {
    const jobUpdate: Prisma.JobUpdateManyMutationInput = {};
    if (commodity && !keeperJob.commodity) jobUpdate.commodity = commodity;
    if (origin && !keeperJob.origin) jobUpdate.origin = origin;
    if (destination && !keeperJob.destination) jobUpdate.destination = destination;
    if (weightKg != null && keeperJob.weight == null) jobUpdate.weight = weightKg;
    if (Object.keys(jobUpdate).length > 0) {
      await prisma.job.updateMany({ where: { id: keeperJob.id, officeId }, data: jobUpdate });
    }
  }

  return {
    ok: true as const,
    keeperInquiryId: keeper.id,
    keeperJobId: keeperJob?.id ?? null,
    mergedCount: losers.length,
    affectedInquiryIds: [keeper.id, ...losers.map((loser) => loser.id)],
  };
}

async function applyPendingBulkActionProposal(input: ApplyJobProposalInput, proposal: {
  id: string;
  officeId: string;
  jobId: string | null;
  inquiryId: string | null;
  kind: string;
  sourceType: string | null;
  sourcePreview: string | null;
}, payload: Record<string, unknown>): Promise<AgentProposalApplyResult> {
  const action = typeof payload.action === "string" ? payload.action : "";
  const actionInput = asRecord(payload.actionInput);
  let note = typeof payload.actionLabel === "string" ? payload.actionLabel : action;
  let affectedRecords: string[] = [];

  if (action === "HIDE_THREADS") {
    const threadIds = asStringArray(actionInput.threadIds);
    if (threadIds.length === 0) return { ok: false, proposalId: proposal.id, message: "Hide proposal has no thread ids. Nothing changed." };
    const validThreads = await prisma.emailThread.findMany({
      where: { id: { in: threadIds }, officeId: input.officeId, hiddenAt: null },
      select: { id: true },
    });
    if (validThreads.length === 0) return { ok: false, proposalId: proposal.id, message: "No proposed threads are still visible. Nothing changed." };
    await prisma.emailThread.updateMany({
      where: { id: { in: validThreads.map((thread) => thread.id) }, officeId: input.officeId },
      data: { hiddenAt: new Date() },
    });
    affectedRecords = validThreads.map((thread) => `thread:${thread.id}`);
    note = `Hid ${validThreads.length} reviewed inbox thread${validThreads.length === 1 ? "" : "s"}.`;
  } else if (action === "DEDUP_INQUIRIES") {
    const result = await applyDedupClusters(input.officeId, asRecordArray(actionInput.clusters));
    if (result.mergedCount === 0) {
      return { ok: false, proposalId: proposal.id, message: "No proposed duplicate inquiries were still safe to merge. Nothing changed." };
    }
    affectedRecords = result.affectedInquiryIds.map((id) => `inquiry:${id}`);
    note = `Merged ${result.mergedCount} duplicate inquir${result.mergedCount === 1 ? "y" : "ies"} across ${result.clusterCount} reviewed cluster${result.clusterCount === 1 ? "" : "s"}.`;
  } else if (action === "MERGE_INQUIRIES_INTO_ONE") {
    const result = await applyMergeAllOpenInquiries(input.officeId, actionInput);
    if (!result.ok) return { ok: false, proposalId: proposal.id, message: result.message };
    affectedRecords = result.affectedInquiryIds.map((id) => `inquiry:${id}`);
    note = `Consolidated ${result.mergedCount} inquir${result.mergedCount === 1 ? "y" : "ies"} into one reviewed deal.`;
  } else {
    return { ok: false, proposalId: proposal.id, message: `Unsupported bulk proposal "${action}". Nothing changed.` };
  }

  await prisma.agentProposal.updateMany({
    where: { id: proposal.id, officeId: input.officeId },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      reviewedByUserId: input.userId ?? null,
      reviewedAt: new Date(),
      reviewDecision: "APPLY_BULK_ACTION",
      reviewNote: note,
    },
  });
  await recordProposalReviewEvent({
    officeId: input.officeId,
    userId: input.userId,
    proposal,
    status: "APPLIED",
    decision: "APPLY_BULK_ACTION",
    note,
    acceptedFields: affectedRecords,
    changedJobFields: [],
    changedInquiryFields: action === "HIDE_THREADS" ? [] : affectedRecords,
  });

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard");

  return {
    ok: true,
    proposalId: proposal.id,
    message: `Applied proposal ${proposal.id.slice(0, 8)}: ${note}`,
  };
}

async function applyPendingJobActionProposal(input: ApplyJobProposalInput, proposal: {
  id: string;
  officeId: string;
  jobId: string | null;
  inquiryId: string | null;
  kind: string;
  sourceType: string | null;
  sourcePreview: string | null;
}, payload: Record<string, unknown>): Promise<AgentProposalApplyResult> {
  if (!proposal.jobId) {
    return { ok: false, proposalId: proposal.id, message: `Proposal ${proposal.id.slice(0, 8)} has no job scope. Nothing changed.` };
  }

  const action = typeof payload.action === "string" ? payload.action : "";
  const actionInput = asRecord(payload.actionInput);
  let actionResult: { ok: true; message?: string } | { error: string };
  let changedJobFields: string[] = [];
  let note = typeof payload.actionLabel === "string" ? payload.actionLabel : action;

  if (action === "ADD_MILESTONE") {
    actionResult = await applyAddMilestone(proposal.jobId, input.officeId, {
      type: String(actionInput.type ?? ""),
      plannedAt: typeof actionInput.plannedAt === "string" ? actionInput.plannedAt : undefined,
      actualAt: typeof actionInput.actualAt === "string" ? actionInput.actualAt : undefined,
      note: typeof actionInput.note === "string" ? actionInput.note : undefined,
    });
    changedJobFields = ["milestones"];
  } else if (action === "SET_CUSTOMER") {
    actionResult = await applySetCustomer(proposal.jobId, input.officeId, {
      companyName: String(actionInput.companyName ?? ""),
      createIfMissing: actionInput.createIfMissing !== false,
    });
    changedJobFields = ["companyId"];
  } else if (action === "RENAME_COMPANY") {
    actionResult = await applyRenameCompany(proposal.jobId, input.officeId, String(actionInput.newName ?? ""));
    changedJobFields = ["company.name"];
  } else if (action === "AWARD_SUPPLIER") {
    const threadId = typeof actionInput.threadId === "string" ? actionInput.threadId : "";
    if (!threadId) return { ok: false, proposalId: proposal.id, message: "Supplier award proposal is missing a thread id. Nothing changed." };
    const thread = await prisma.emailThread.findFirst({
      where: { id: threadId, officeId: input.officeId },
      select: { id: true, inquiryId: true },
    });
    if (!thread) return { ok: false, proposalId: proposal.id, message: "Supplier thread no longer exists. Nothing changed." };
    if (proposal.inquiryId && thread.inquiryId !== proposal.inquiryId) {
      return { ok: false, proposalId: proposal.id, message: "Supplier thread is no longer linked to this proposal's RFQ. Nothing changed." };
    }
    const result = await awardSupplier(thread.id);
    actionResult = "error" in result ? { error: result.error } : { ok: true, message: `Awarded supplier thread ${thread.id.slice(0, 8)}.` };
    changedJobFields = ["status", "cost", "supplierAward", "childForwardingJob"];
  } else if (action === "LINK_THREADS_TO_JOB") {
    const threadIds = asStringArray(actionInput.threadIds);
    const inquiryId = typeof actionInput.inquiryId === "string" ? actionInput.inquiryId : proposal.inquiryId;
    if (!inquiryId) return { ok: false, proposalId: proposal.id, message: "Thread-link proposal has no target RFQ. Nothing changed." };
    if (threadIds.length === 0) return { ok: false, proposalId: proposal.id, message: "Thread-link proposal has no thread ids. Nothing changed." };

    const job = await prisma.job.findFirst({
      where: { id: proposal.jobId, officeId: input.officeId },
      select: { id: true, type: true, inquiryId: true },
    });
    if (!job?.inquiryId || job.inquiryId !== inquiryId) {
      return { ok: false, proposalId: proposal.id, message: "Target job/RFQ changed since the proposal was created. Nothing changed." };
    }

    const validThreads = await prisma.emailThread.findMany({
      where: { id: { in: threadIds }, officeId: input.officeId },
      select: { id: true },
    });
    if (validThreads.length === 0) return { ok: false, proposalId: proposal.id, message: "No proposed threads still exist in this office. Nothing changed." };

    await prisma.emailThread.updateMany({
      where: { id: { in: validThreads.map((thread) => thread.id) }, officeId: input.officeId },
      data: { inquiryId, autoLinkedAt: new Date() },
    });
    if (job.type === "SOURCING") {
      await enqueueBackgroundJob({
        officeId: input.officeId,
        type: "PREWARM_INQUIRY_SUMMARY",
        payload: { inquiryId },
        dedupeKey: `prewarm-inquiry:${inquiryId}`,
      }).catch(() => null);
    }
    actionResult = { ok: true, message: `Linked ${validThreads.length} thread${validThreads.length === 1 ? "" : "s"} to the job RFQ.` };
    changedJobFields = ["emailThreads"];
  } else {
    return { ok: false, proposalId: proposal.id, message: `Unsupported agent action proposal "${action}". Nothing changed.` };
  }

  if ("error" in actionResult) {
    return { ok: false, proposalId: proposal.id, message: actionResult.error };
  }
  if (actionResult.message) note = `${note} - ${actionResult.message}`;

  await prisma.agentProposal.updateMany({
    where: { id: proposal.id, officeId: input.officeId },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      reviewedByUserId: input.userId ?? null,
      reviewedAt: new Date(),
      reviewDecision: "APPLY_ACTION",
      reviewNote: note,
    },
  });
  await recordProposalReviewEvent({
    officeId: input.officeId,
    userId: input.userId,
    proposal,
    status: "APPLIED",
    decision: "APPLY_ACTION",
    note,
    acceptedFields: changedJobFields,
    changedJobFields,
    changedInquiryFields: [],
  });

  revalidatePath(`/dashboard/jobs/${proposal.jobId}`);
  if (proposal.inquiryId) revalidatePath(`/dashboard/rfq/${proposal.inquiryId}`);
  revalidatePath("/dashboard");

  return {
    ok: true,
    proposalId: proposal.id,
    jobId: proposal.jobId,
    inquiryId: proposal.inquiryId,
    message: `Applied proposal ${proposal.id.slice(0, 8)}: ${note}.`,
  };
}

export async function applyPendingJobAgentProposal(input: ApplyJobProposalInput): Promise<AgentProposalApplyResult> {
  const identifier = input.proposalId ?? input.requestedId ?? "";
  const proposal = await prisma.agentProposal.findFirst({
    where: { ...proposalWhere(input), officeId: input.officeId },
  });
  if (!proposal) {
    return { ok: false, message: `No pending update proposal found for "${identifier}". Nothing changed.` };
  }

  const payload = proposal.payload as any;
  if (payload?.entity === "bulk") {
    return applyPendingBulkActionProposal(input, proposal, asRecord(payload));
  }
  if (payload?.entity !== "job" || !proposal.jobId) {
    return {
      ok: false,
      proposalId: proposal.id,
      message: `Proposal ${proposal.id.slice(0, 8)} is not a job update. Nothing changed.`,
    };
  }

  if (payload.action) {
    return applyPendingJobActionProposal(input, proposal, asRecord(payload));
  }

  const accepted = input.acceptedFields ? new Set(input.acceptedFields) : null;
  const filtered = filterScopedProposalFields({
    update: (payload.update ?? {}) as Record<string, unknown>,
    inquiryUpdate: (payload.inquiryUpdate ?? {}) as Record<string, unknown>,
    acceptedFields: input.acceptedFields,
  });
  let update = filtered.update;
  let inquiryUpdate = filtered.inquiryUpdate;

  const job = await prisma.job.findFirst({
    where: { id: proposal.jobId, officeId: input.officeId },
    include: {
      inquiry: true,
      documents: {
        select: {
          id: true,
          name: true,
          status: true,
          docType: true,
          aiSummary: true,
          aiFlags: true,
          aiKeyFields: true,
        },
      },
    },
  });
  if (!job) {
    return {
      ok: false,
      proposalId: proposal.id,
      message: "Focused job no longer exists. Nothing changed.",
    };
  }

  const reviewDecisionImpact = buildAgentProposalDecisionImpact({
    current: job,
    update,
    inquiryUpdate,
  });

  if (Object.keys(update).length === 0 && Object.keys(inquiryUpdate).length === 0) {
    const note = "Reviewer applied the proposal with no accepted fields.";
    await prisma.agentProposal.updateMany({
      where: { id: proposal.id, officeId: input.officeId },
      data: {
        status: "DISCARDED",
        reviewedByUserId: input.userId ?? null,
        reviewedAt: new Date(),
        reviewDecision: "NO_FIELDS_ACCEPTED",
        reviewNote: note,
      },
    });
    await recordProposalReviewEvent({
      officeId: input.officeId,
      userId: input.userId,
      proposal,
      status: "DISCARDED",
      decision: "NO_FIELDS_ACCEPTED",
      note,
      acceptedFields: [],
      changedJobFields: [],
      changedInquiryFields: [],
      decisionImpact: reviewDecisionImpact,
    });
    return {
      ok: false,
      proposalId: proposal.id,
      message: `Proposal ${proposal.id.slice(0, 8)} had no applicable changes. Nothing changed.`,
    };
  }

  if (Object.keys(update).length > 0) {
    await prisma.job.updateMany({
      where: { id: job.id, officeId: input.officeId },
      data: update,
    });
    if (targetPriceChanged(job, { ...job, ...update })) {
      await recordTargetPriceHistory({
        officeId: input.officeId,
        jobId: job.id,
        inquiryId: job.inquiryId,
        createdByUserId: input.userId ?? null,
        amount: typeof update.targetPrice === "number" ? update.targetPrice : job.targetPrice,
        currency: typeof update.targetCurrency === "string" ? update.targetCurrency : job.targetCurrency,
        status: typeof update.targetPriceStatus === "string" ? update.targetPriceStatus : job.targetPriceStatus,
        source: typeof update.targetPriceSource === "string" ? update.targetPriceSource : job.targetPriceSource,
        note: "Applied from reviewed agent paste proposal.",
      });
    }
  }

  if (job.inquiryId && Object.keys(inquiryUpdate).length > 0) {
    if (job.inquiry && targetPriceChanged(job.inquiry, { ...job.inquiry, ...inquiryUpdate })) {
      await recordTargetPriceHistory({
        officeId: input.officeId,
        inquiryId: job.inquiryId,
        jobId: job.id,
        createdByUserId: input.userId ?? null,
        amount: typeof inquiryUpdate.targetPrice === "number" ? inquiryUpdate.targetPrice : job.inquiry.targetPrice,
        currency: typeof inquiryUpdate.targetCurrency === "string" ? inquiryUpdate.targetCurrency : job.inquiry.targetCurrency,
        status: typeof inquiryUpdate.targetPriceStatus === "string" ? inquiryUpdate.targetPriceStatus : job.inquiry.targetPriceStatus,
        source: typeof inquiryUpdate.targetPriceSource === "string" ? inquiryUpdate.targetPriceSource : job.inquiry.targetPriceSource,
        note: "Applied from reviewed agent paste proposal.",
      });
    }
    await prisma.inquiry.updateMany({
      where: { id: job.inquiryId, officeId: input.officeId },
      data: inquiryUpdate,
    });
  }

  const reviewDecision = accepted ? "PARTIAL_APPLY" : "APPLY_ALL";
  const changedJobFields = Object.keys(update);
  const changedInquiryFields = Object.keys(inquiryUpdate);
  const fieldLabels = asStringRecord(payload.fieldLabels);
  const reviewedFieldChanges = buildReviewedFieldChanges({
    jobBefore: job as unknown as Record<string, unknown>,
    inquiryBefore: job.inquiry as unknown as Record<string, unknown> | null,
    update,
    inquiryUpdate,
    fieldLabels,
  });
  const acceptedFieldTokens = accepted
    ? [...accepted]
    : [
      ...changedJobFields.map((field) => `job:${field}`),
      ...changedInquiryFields.map((field) => `rfq:${field}`),
    ];
  const reviewNote = accepted
    ? `Accepted fields: ${acceptedFieldTokens.join(", ") || "none"}.`
    : "Applied all proposed fields.";

  await prisma.agentProposal.updateMany({
    where: { id: proposal.id, officeId: input.officeId },
    data: {
      status: "APPLIED",
      appliedAt: new Date(),
      reviewedByUserId: input.userId ?? null,
      reviewedAt: new Date(),
      reviewDecision,
      reviewNote,
    },
  });
  await recordProposalReviewEvent({
    officeId: input.officeId,
    userId: input.userId,
    proposal,
    status: "APPLIED",
    decision: reviewDecision,
    note: reviewNote,
    acceptedFields: acceptedFieldTokens,
    changedJobFields,
    changedInquiryFields,
    reviewedFieldChanges,
    decisionImpact: reviewDecisionImpact,
  });

  revalidatePath(`/dashboard/jobs/${job.id}`);
  if (job.inquiryId) revalidatePath(`/dashboard/rfq/${job.inquiryId}`);
  revalidatePath("/dashboard");

  const appliedFieldLabel = (scope: "Job" | "RFQ", field: string) => `${scope} ${typeof fieldLabels[field] === "string" ? fieldLabels[field] : field}`;
  const applied = accepted
    ? [
      ...changedJobFields.map((field) => appliedFieldLabel("Job", field)),
      ...changedInquiryFields.map((field) => appliedFieldLabel("RFQ", field)),
    ]
    : (payload.appliedLabels ?? []) as string[];
  return {
    ok: true,
    proposalId: proposal.id,
    jobId: job.id,
    inquiryId: job.inquiryId,
    message: `Applied proposal ${proposal.id.slice(0, 8)} to ${job.reference}: ${applied.length ? applied.join("; ") : "fields updated"}.`,
  };
}

export async function discardPendingAgentProposal(input: {
  officeId: string;
  userId?: string | null;
  proposalId: string;
  jobId?: string | null;
  inquiryId?: string | null;
}) {
  const proposal = await prisma.agentProposal.findFirst({
    where: {
      id: input.proposalId,
      officeId: input.officeId,
      status: "PENDING",
    },
    select: { id: true, jobId: true, inquiryId: true, kind: true, sourceType: true, sourcePreview: true, payload: true },
  });
  if (!proposal) return null;

  const proposalPayload = asRecord(proposal.payload);
  const storedDecisionImpact = asRecord(proposalPayload.decisionImpact);
  const reviewNote = "Discarded by reviewer.";
  await prisma.agentProposal.updateMany({
    where: { id: proposal.id, officeId: input.officeId },
    data: {
      status: "DISCARDED",
      reviewedByUserId: input.userId ?? null,
      reviewedAt: new Date(),
      reviewDecision: "DISCARDED",
      reviewNote,
    },
  });
  await recordProposalReviewEvent({
    officeId: input.officeId,
    userId: input.userId,
    proposal,
    status: "DISCARDED",
    decision: "DISCARDED",
    note: reviewNote,
    decisionImpact: Object.keys(storedDecisionImpact).length > 0 ? storedDecisionImpact : null,
  });

  const jobId = input.jobId ?? proposal.jobId;
  const inquiryId = input.inquiryId ?? proposal.inquiryId;
  if (jobId) revalidatePath(`/dashboard/jobs/${jobId}`);
  if (inquiryId) revalidatePath(`/dashboard/rfq/${inquiryId}`);
  revalidatePath("/dashboard");

  return proposal.id;
}
