import "server-only";
import { prisma } from "./prisma";
import { requiredRfqMissing, type StrategyBlockerResolution } from "./commercial-strategy";
import { assessInquiryStrategy } from "./commercial-strategy-persistence";
import { buildForwarderDraft, coversForwarderMode, forwarderModeCoverageLabel } from "./forwarder-draft-core";
import { recordMemoryEvent } from "./memory/record-event";

type ForwarderDraftBlockedReason = {
  key: string;
  label: string;
  priority: StrategyBlockerResolution["priority"] | "high";
  ask: string;
  why: string;
};

export async function createForwarderRequestDrafts(args: {
  officeId: string;
  userId?: string | null;
  inquiryId: string;
  forwarderIds?: string[];
  recordBlockedNote?: boolean;
}) {
  const inquiry = await prisma.inquiry.findFirst({
    where: { id: args.inquiryId, officeId: args.officeId },
  });
  if (!inquiry) {
    return {
      status: "NOT_FOUND" as const,
      inquiry: null,
      missing: [],
      blockedReasons: [] as ForwarderDraftBlockedReason[],
      eligibleForwarders: 0,
      createdDrafts: [],
      existingDrafts: [],
      skippedForwarders: [],
    };
  }

  const strategyRun = await assessInquiryStrategy(args.officeId, inquiry.id).catch(() => null);
  const strategy = strategyRun?.strategy ?? null;
  const missing = strategy?.quoteGate.blockers.length
    ? strategy.quoteGate.blockers
    : requiredRfqMissing(inquiry);
  const blockedReasons: ForwarderDraftBlockedReason[] = strategy?.blockerResolutionPlan.length
    ? strategy.blockerResolutionPlan.map((item) => ({
        key: item.key,
        label: item.label,
        priority: item.priority,
        ask: item.ask,
        why: item.why,
      }))
    : missing.map((item) => ({
        key: item.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        label: item,
        priority: "high" as const,
        ask: `Please confirm ${item.toLowerCase()}.`,
        why: "This RFQ is not mature enough to send to forwarders.",
      }));
  const canSendToForwarders = strategy?.quoteGate.canSendToForwarders ?? missing.length === 0;
  if (!canSendToForwarders || missing.length > 0) {
    if (args.recordBlockedNote) {
      await prisma.inquiry.update({
        where: { id: inquiry.id },
        data: {
          notes: [
            inquiry.notes,
            `Blocked forwarder draft: ${blockedReasons.slice(0, 3).map((item) => item.label).join(", ") || missing.join(", ")}.`,
          ].filter(Boolean).join("\n"),
        },
      });
    }
    return {
      status: "BLOCKED" as const,
      inquiry,
      missing,
      blockedReasons,
      eligibleForwarders: 0,
      createdDrafts: [],
      existingDrafts: [],
      skippedForwarders: [],
    };
  }

  const requestedIds = (args.forwarderIds ?? []).filter(Boolean);
  const forwarders = await prisma.forwarder.findMany({
    where: {
      officeId: args.officeId,
      active: true,
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
    },
    orderBy: { name: "asc" },
  });
  const eligible = forwarders.filter((forwarder) => coversForwarderMode(forwarder, inquiry.mode));
  const skippedForwarders = forwarders
    .filter((forwarder) => !coversForwarderMode(forwarder, inquiry.mode))
    .map((forwarder) => ({
      id: forwarder.id,
      name: forwarder.name,
      email: forwarder.email,
      reason: `Mode coverage ${forwarderModeCoverageLabel(forwarder.modeCoverage)} does not include ${inquiry.mode ?? "unknown mode"}.`,
    }));

  const createdDrafts: Array<{ id: string; forwarderName: string; toEmail: string; subject: string }> = [];
  const existingDrafts: Array<{ id: string; forwarderName: string; toEmail: string; subject: string }> = [];

  for (const forwarder of eligible) {
    const existing = await prisma.forwarderRequestDraft.findFirst({
      where: {
        officeId: args.officeId,
        inquiryId: inquiry.id,
        toEmail: forwarder.email,
        status: "DRAFT",
      },
      select: { id: true, forwarderName: true, toEmail: true, subject: true },
    });
    if (existing) {
      existingDrafts.push(existing);
      continue;
    }

    const draft = buildForwarderDraft(inquiry, forwarder);
    const created = await prisma.forwarderRequestDraft.create({
      data: {
        officeId: args.officeId,
        inquiryId: inquiry.id,
        forwarderId: forwarder.id,
        forwarderName: forwarder.name,
        toEmail: forwarder.email,
        subject: draft.subject,
        body: draft.body,
        createdByUserId: args.userId ?? null,
      },
      select: { id: true, forwarderName: true, toEmail: true, subject: true },
    });
    await recordMemoryEvent({
      officeId: args.officeId,
      sourceType: "INQUIRY",
      sourceExternalId: `forwarder_draft:${created.id}`,
      sourceLabel: "Forwarder request draft",
      eventType: "forwarder_draft.created",
      entityType: "forwarder_draft",
      entityId: created.id,
      actorType: args.userId ? "user" : "system",
      actorId: args.userId ?? null,
      occurredAt: new Date(),
      payloadVersion: 1,
      payload: {
        draftId: created.id,
        inquiryId: inquiry.id,
        forwarderId: forwarder.id,
        forwarderName: created.forwarderName,
        toEmail: created.toEmail,
        subject: created.subject,
        status: "DRAFT",
      },
      provenance: {
        source: "forwarder_drafts",
        operation: "create_forwarder_request_draft",
        path: "src/lib/forwarder-drafts.ts",
        function: "createForwarderRequestDrafts",
        sourceRecordId: created.id,
        actorType: args.userId ? "user" : "system",
        actorId: args.userId ?? null,
      },
      idempotencyKey: `forwarder_draft:${created.id}:created`,
    }).catch(() => null);
    createdDrafts.push(created);
  }

  return {
    status: "READY" as const,
    inquiry,
    missing: [],
    blockedReasons: [] as ForwarderDraftBlockedReason[],
    eligibleForwarders: eligible.length,
    createdDrafts,
    existingDrafts,
    skippedForwarders,
  };
}
