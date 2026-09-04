import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { runOutreachCampaignBatch } from "../src/lib/outreach-campaign-send";
import {
  activateCampaign,
  campaignRecipientFeedback,
  campaignReplyDigest,
  cancelCampaign,
  completeCampaignIfDone,
  listCampaignSummaries,
  planOutreachCampaign,
  saveDraftCampaign,
  setCampaignFollowUps,
} from "../src/lib/outreach-campaigns";
import {
  campaignFollowUpBlockers,
  normalizeCampaignFollowUps,
} from "../src/lib/outreach-campaign-copy";

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the outreach planning database test.");
  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({ data: { name: `Outreach planning ${suffix}` } });
  try {
    const list = await prisma.researchList.create({
      data: {
        officeId: office.id,
        slug: `wens-${suffix}`,
        name: `Wens ${suffix}`,
        fields: [
          { key: "company_name", label: "Company", type: "text" },
          { key: "country_name", label: "Country", type: "text" },
          { key: "primary_email", label: "Email", type: "text" },
        ],
      },
    });
    const record = await prisma.researchRecord.create({
      data: {
        officeId: office.id,
        listId: list.id,
        data: {
          company_name: "Wens Test Bakery",
          country_name: "GB",
          primary_email: `wens-${suffix}@example.test`,
        },
      },
    });
    const duplicateList = await prisma.researchList.create({
      data: {
        officeId: office.id,
        slug: `duplicate-${suffix}`,
        name: `Duplicate ${suffix}`,
        fields: [
          { key: "company", label: "Company", type: "text" },
          { key: "email", label: "Email", type: "email" },
        ],
      },
    });
    const duplicateFirst = await prisma.researchRecord.create({
      data: {
        officeId: office.id,
        listId: duplicateList.id,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        data: { company: "First Duplicate", email: ` Duplicate-${suffix}@example.test ` },
      },
      select: { id: true },
    });
    const duplicateSecond = await prisma.researchRecord.create({
      data: {
        officeId: office.id,
        listId: duplicateList.id,
        createdAt: new Date("2026-01-01T00:00:01.000Z"),
        data: { company: "Second Duplicate", email: `duplicate-${suffix}@EXAMPLE.TEST` },
      },
      select: { id: true },
    });
    assert.notEqual(duplicateSecond.id, duplicateFirst.id);
    const sender = await prisma.emailAccount.create({
      data: {
        officeId: office.id,
        email: `sender-${suffix}@example.test`,
        displayName: "Wens Test",
        provider: "GMAIL_APP_PASSWORD",
        credentialSecret: "test-secret",
        isActive: true,
        sendEnabled: true,
        dailySendLimit: 30,
      },
    });
    const baseInput = {
      officeId: office.id,
      list: list.slug,
      senderAccountId: sender.id,
      subject: "Wens test",
      bodyTemplate: "Hello {{company}}. Reply STOP to opt out.",
    };
    const plan = await planOutreachCampaign(baseInput);
    assert.equal(plan.emailField, "primary_email");
    assert.equal(plan.eligible, 1);
    const draft = await saveDraftCampaign({ ...baseInput, emailField: plan.emailField });
    const originalRevisionHash = draft.revisionHash;
    await saveDraftCampaign({
      ...baseInput,
      subject: "Replanned Wens test",
      emailField: plan.emailField,
    });
    const staleActivation = await activateCampaign({
      officeId: office.id,
      campaignId: draft.id,
      userId: null,
      expectedRevisionHash: originalRevisionHash,
    });
    assert.deepEqual(staleActivation, {
      activated: false,
      blockers: ["This campaign changed after it was proposed. Plan it again."],
    });
    const replanned = await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: draft.id },
      select: { status: true, subject: true },
    });
    assert.deepEqual(replanned, { status: "DRAFT", subject: "Replanned Wens test" });

    const rejectedPlan = await planOutreachCampaign({
      ...baseInput,
      campaignName: `Rejected after plan ${suffix}`,
      emailField: plan.emailField,
    });
    const rejectedDraft = await saveDraftCampaign({
      ...baseInput,
      campaignName: `Rejected after plan ${suffix}`,
      emailField: rejectedPlan.emailField,
    });
    await prisma.researchRecord.update({
      where: { officeId: office.id, id: record.id },
      data: { status: "rejected" },
    });
    const rejectedActivation = await activateCampaign({
      officeId: office.id,
      campaignId: rejectedDraft.id,
      userId: null,
      expectedRevisionHash: rejectedDraft.revisionHash,
    });
    assert.equal(rejectedActivation.activated, true);
    const rejectedRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: rejectedDraft.id,
      pauseMs: 0,
    });
    assert.equal(rejectedRun.sent, 0);
    assert.equal(await prisma.outreachCampaignSend.count({
      where: { officeId: office.id, campaignId: rejectedDraft.id },
    }), 0);
    await prisma.researchRecord.update({
      where: { officeId: office.id, id: record.id },
      data: { status: "new" },
    });
    const feedbackList = await prisma.researchList.create({
      data: {
        officeId: office.id,
        slug: `feedback-${suffix}`,
        name: `Feedback ${suffix}`,
        fields: [{ key: "primary_email", label: "Email", type: "email" }],
      },
    });
    const feedbackRecord = await prisma.researchRecord.create({
      data: {
        officeId: office.id,
        listId: feedbackList.id,
        data: {
          company_name: "Feedback Test Bakery",
          country_name: "GB",
          primary_email: `feedback-clean-${suffix}@example.test`,
        },
      },
    });
    const feedbackCampaign = await prisma.outreachCampaign.create({
      data: {
        officeId: office.id,
        listId: feedbackList.id,
        name: `Feedback Wens campaign ${suffix}`,
        status: "ACTIVE",
        subject: "Feedback",
        bodyTemplate: "Reply STOP to opt out.",
        emailField: "primary_email",
        rowStatuses: ["new"],
        filters: Prisma.DbNull,
        senderAccountId: sender.id,
        senderDisplayName: null,
        variants: Prisma.DbNull,
        audienceTotal: 2,
        audienceRecordIds: [record.id, feedbackRecord.id],
        audiencePersonalization: {
          [record.id]: { email: `feedback-bounced-${suffix}@example.test` },
          [feedbackRecord.id]: { email: `feedback-clean-${suffix}@example.test` },
        },
        revisionHash: "feedback",
      },
      select: { id: true },
    });
    const feedbackEmptyCampaign = await prisma.outreachCampaign.create({
      data: {
        officeId: office.id,
        listId: feedbackList.id,
        name: `Feedback empty campaign ${suffix}`,
        status: "DRAFT",
        subject: "Feedback empty",
        bodyTemplate: "Reply STOP to opt out.",
        emailField: "primary_email",
        rowStatuses: ["new"],
        filters: Prisma.DbNull,
        senderAccountId: sender.id,
        senderDisplayName: null,
        variants: Prisma.DbNull,
        audienceTotal: 0,
        audienceRecordIds: [],
        audiencePersonalization: Prisma.DbNull,
        revisionHash: "feedback-empty",
      },
      select: { id: true },
    });
    const answeredReplyThread = await prisma.emailThread.create({
      data: {
        officeId: office.id,
        subject: "Re: Feedback",
        participants: JSON.stringify([`feedback-clean-${suffix}@example.test`, sender.email]),
      },
    });
    const awaitingReplyThread = await prisma.emailThread.create({
      data: {
        officeId: office.id,
        subject: "Re: Feedback awaiting",
        participants: JSON.stringify([`feedback-awaiting-${suffix}@example.test`, sender.email]),
      },
    });
    const autoReplyThread = await prisma.emailThread.create({
      data: {
        officeId: office.id,
        subject: "Out of office",
        participants: JSON.stringify([`feedback-auto-${suffix}@example.test`, sender.email]),
      },
    });
    const bounceThread = await prisma.emailThread.create({
      data: {
        officeId: office.id,
        subject: "Delivery failure",
        participants: JSON.stringify([`feedback-bounced-${suffix}@example.test`, sender.email]),
      },
    });
    const unfinishedFeedbackThread = await prisma.emailThread.create({
      data: {
        officeId: office.id,
        subject: "Delivery feedback pending",
        participants: JSON.stringify([`feedback-pending-${suffix}@example.test`, sender.email]),
      },
    });
    const unclassifiedReplyThread = await prisma.emailThread.create({
      data: {
        officeId: office.id,
        subject: "Unclassified reply",
        participants: JSON.stringify([`feedback-unclassified-${suffix}@example.test`, sender.email]),
      },
    });
    await prisma.emailMessage.createMany({
      data: [
        {
          officeId: office.id,
          threadId: answeredReplyThread.id,
          direction: "INBOUND",
          fromEmail: `feedback-clean-${suffix}@example.test`,
          fromName: "Clean Bakery",
          toEmails: JSON.stringify([sender.email]),
          subject: "Re: Feedback",
          bodyText: "  We can supply   this product.\nPlease send the next steps. ",
          sentAt: new Date("2026-01-02T10:00:00.000Z"),
          deliveryKind: null,
          classification: "CUSTOMER_REPLY",
        },
        {
          officeId: office.id,
          threadId: answeredReplyThread.id,
          direction: "OUTBOUND",
          fromEmail: sender.email,
          toEmails: JSON.stringify([`feedback-clean-${suffix}@example.test`]),
          subject: "Re: Feedback",
          bodyText: "Thanks.",
          sentAt: new Date("2026-01-02T11:00:00.000Z"),
        },
        {
          officeId: office.id,
          threadId: awaitingReplyThread.id,
          direction: "OUTBOUND",
          fromEmail: sender.email,
          toEmails: JSON.stringify([`feedback-awaiting-${suffix}@example.test`]),
          subject: "Feedback awaiting",
          bodyText: "Please let us know.",
          sentAt: new Date("2026-01-03T09:00:00.000Z"),
        },
        {
          officeId: office.id,
          threadId: awaitingReplyThread.id,
          direction: "INBOUND",
          fromEmail: `feedback-awaiting-${suffix}@example.test`,
          fromName: "Awaiting Bakery",
          toEmails: JSON.stringify([sender.email]),
          subject: "Re: Feedback awaiting",
          bodyText: "We need more details.",
          sentAt: new Date("2026-01-03T10:00:00.000Z"),
          deliveryKind: null,
          classification: "CUSTOMER_REPLY",
        },
        {
          officeId: office.id,
          threadId: autoReplyThread.id,
          direction: "INBOUND",
          fromEmail: `feedback-auto-${suffix}@example.test`,
          toEmails: JSON.stringify([sender.email]),
          subject: "Out of office",
          bodyText: "I am away.",
          sentAt: new Date("2026-01-04T10:00:00.000Z"),
          deliveryKind: "AUTO_REPLY",
          classification: "DELIVERY_FEEDBACK",
        },
        {
          officeId: office.id,
          threadId: bounceThread.id,
          direction: "INBOUND",
          fromEmail: "mailer-daemon@example.test",
          toEmails: JSON.stringify([sender.email]),
          subject: "Delivery failure",
          bodyText: "Delivery failed.",
          sentAt: new Date("2026-01-05T10:00:00.000Z"),
          deliveryKind: "BOUNCE",
          classification: "DELIVERY_FEEDBACK",
        },
        {
          officeId: office.id,
          threadId: unfinishedFeedbackThread.id,
          direction: "INBOUND",
          fromEmail: "mailer-daemon@example.test",
          toEmails: JSON.stringify([sender.email]),
          subject: "Delivery feedback pending",
          bodyText: "Delivery feedback is still being processed.",
          sentAt: new Date("2026-01-06T10:00:00.000Z"),
          deliveryKind: null,
          classification: "DELIVERY_FEEDBACK",
        },
        {
          officeId: office.id,
          threadId: unclassifiedReplyThread.id,
          direction: "INBOUND",
          fromEmail: `feedback-unclassified-${suffix}@example.test`,
          fromName: "Unclassified Bakery",
          toEmails: JSON.stringify([sender.email]),
          subject: "Unclassified reply",
          bodyText: "This reply has no classification.",
          sentAt: new Date("2026-01-07T10:00:00.000Z"),
          deliveryKind: null,
          classification: null,
        },
      ],
    });
    await prisma.outreachCampaignSend.createMany({
      data: [
        {
          officeId: office.id,
          campaignId: feedbackCampaign.id,
          recordId: record.id,
          recipient: `feedback-bounced-${suffix}@example.test`,
          status: "SENT",
          localThreadId: bounceThread.id,
        },
        {
          officeId: office.id,
          campaignId: feedbackCampaign.id,
          recordId: feedbackRecord.id,
          recipient: `feedback-clean-${suffix}@example.test`,
          status: "SENT",
          localThreadId: answeredReplyThread.id,
        },
        {
          officeId: office.id,
          campaignId: feedbackCampaign.id,
          recordId: `feedback-awaiting-${suffix}`,
          recipient: `feedback-awaiting-${suffix}@example.test`,
          status: "SENT",
          localThreadId: awaitingReplyThread.id,
        },
        {
          officeId: office.id,
          campaignId: feedbackCampaign.id,
          recordId: `feedback-auto-${suffix}`,
          recipient: `feedback-auto-${suffix}@example.test`,
          status: "SENT",
          localThreadId: autoReplyThread.id,
        },
        {
          officeId: office.id,
          campaignId: feedbackCampaign.id,
          recordId: `feedback-pending-${suffix}`,
          recipient: `feedback-pending-${suffix}@example.test`,
          status: "SENT",
          localThreadId: unfinishedFeedbackThread.id,
        },
        {
          officeId: office.id,
          campaignId: feedbackCampaign.id,
          recordId: `feedback-unclassified-${suffix}`,
          recipient: `feedback-unclassified-${suffix}@example.test`,
          status: "SENT",
          localThreadId: unclassifiedReplyThread.id,
        },
      ],
    });
    await prisma.emailSuppression.create({
      data: {
        officeId: office.id,
        email: `feedback-bounced-${suffix}@example.test`,
        reason: "BOUNCED",
        source: "GMAIL",
      },
    });
    const feedback = await campaignRecipientFeedback({
      officeId: office.id,
      campaignIds: [feedbackCampaign.id, feedbackEmptyCampaign.id],
    });
    assert.deepEqual(feedback.get(feedbackCampaign.id), {
      bounced: 1,
      complained: 0,
      optedOut: 0,
      blocked: 0,
    });
    assert.deepEqual(feedback.get(feedbackEmptyCampaign.id), {
      bounced: 0,
      complained: 0,
      optedOut: 0,
      blocked: 0,
    });
    const digest = await campaignReplyDigest({
      officeId: office.id,
      campaignIds: [feedbackCampaign.id],
      limit: 10,
    });
    assert.deepEqual(digest.counts.get(feedbackCampaign.id), {
      replyThreads: 3,
      answered: 1,
      awaitingAnswer: 2,
      autoReplies: 1,
      bounces: 1,
      optOuts: 0,
      complaints: 0,
    });
    assert.equal(digest.replies.length, 3);
    assert.equal(digest.replies[0]?.threadId, unclassifiedReplyThread.id);
    assert.deepEqual(digest.replies.find((reply) => reply.threadId === awaitingReplyThread.id), {
      campaignId: feedbackCampaign.id,
      threadId: awaitingReplyThread.id,
      recipient: `feedback-awaiting-${suffix}@example.test`,
      fromEmail: `feedback-awaiting-${suffix}@example.test`,
      fromName: "Awaiting Bakery",
      subject: "Re: Feedback awaiting",
      variantKey: null,
      receivedAt: new Date("2026-01-03T10:00:00.000Z"),
      answered: false,
      answeredAt: null,
      snippet: "We need more details.",
    });
    const answeredReply = digest.replies.find((reply) => reply.threadId === answeredReplyThread.id);
    assert.equal(answeredReply?.answered, true);
    assert.equal(answeredReply?.answeredAt?.toISOString(), "2026-01-02T11:00:00.000Z");
    assert.equal(answeredReply?.snippet, "We can supply this product. Please send the next steps.");
    assert.equal(digest.replies.some((reply) => reply.threadId === unfinishedFeedbackThread.id), false);
    assert.equal(digest.replies.some((reply) => reply.threadId === unclassifiedReplyThread.id), true);
    const summaries = await listCampaignSummaries(office.id, ["ACTIVE"]);
    assert.equal(summaries.find((summary) => summary.id === feedbackCampaign.id)?.replies, 3);

    const rotationPlan = await planOutreachCampaign({
      ...baseInput,
      senderAccountId: null,
      senderRotation: true,
      subject: "Rotating Wens test",
    });
    assert.equal(rotationPlan.senderRotation, true);
    assert.equal(rotationPlan.senderEmail, null);
    assert.ok(rotationPlan.poolCapacityToday >= sender.dailySendLimit);
    const rotationDraft = await saveDraftCampaign({
      ...baseInput,
      senderAccountId: null,
      senderRotation: true,
      subject: "Rotating Wens test",
      emailField: rotationPlan.emailField,
    });
    const rotationActivation = await activateCampaign({
      officeId: office.id,
      campaignId: rotationDraft.id,
      userId: null,
      expectedRevisionHash: rotationDraft.revisionHash,
    });
    assert.equal(rotationActivation.activated, true);
    const storedRotation = await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: rotationDraft.id },
      select: { senderAccountId: true, senderRotation: true, status: true },
    });
    assert.deepEqual(storedRotation, { senderAccountId: null, senderRotation: true, status: "ACTIVE" });

    const duplicateInput = {
      officeId: office.id,
      list: duplicateList.slug,
      senderAccountId: sender.id,
      subject: "Duplicate test",
      bodyTemplate: "Hello {{company}}. Reply STOP to opt out.",
    };
    const duplicatePlan = await planOutreachCampaign(duplicateInput);
    assert.equal(duplicatePlan.eligible, 1);
    assert.equal(duplicatePlan.audienceTotal, 1);
    const duplicateDraft = await saveDraftCampaign({
      ...duplicateInput,
      emailField: duplicatePlan.emailField,
    });
    const duplicateAudience = await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: duplicateDraft.id },
      select: { audienceRecordIds: true, audienceTotal: true },
    });
    assert.deepEqual(duplicateAudience, {
      audienceRecordIds: [duplicateFirst.id],
      audienceTotal: 1,
    });
    const duplicateActivation = await activateCampaign({
      officeId: office.id,
      campaignId: duplicateDraft.id,
      userId: null,
      expectedRevisionHash: duplicateDraft.revisionHash,
    });
    assert.equal(duplicateActivation.activated, true);
    const duplicateRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: duplicateDraft.id,
      pauseMs: 0,
      provider: {
        send: async () => ({
          state: "SENT" as const,
          provider: "GMAIL" as const,
          providerMessageId: "duplicate-message",
          providerThreadId: "duplicate-thread",
          sourceUrl: "https://mail.google.com",
        }),
        reconcile: async () => ({ state: "UNKNOWN" as const, error: "unused" }),
      },
    });
    assert.equal(duplicateRun.sent, 1);
    assert.equal(await prisma.outreachCampaignSend.count({
      where: { officeId: office.id, campaignId: duplicateDraft.id },
    }), 1);

    await assert.rejects(
      () => saveDraftCampaign({
        ...baseInput,
        senderRotation: true,
        campaignName: `Conflicting ${suffix}`,
      }),
      /Pick either a sender mailbox or rotation, not both/,
    );
    assert.equal(await prisma.outreachCampaign.count({
      where: { officeId: office.id, name: `Conflicting ${suffix}` },
    }), 0);

    const activeCampaignName = `Explicit Wens campaign ${suffix}`;
    const activePlan = await planOutreachCampaign({
      ...baseInput,
      campaignName: activeCampaignName,
      subject: "Active Wens test",
    });
    const activeDraft = await saveDraftCampaign({
      ...baseInput,
      campaignName: activeCampaignName,
      subject: "Active Wens test",
      emailField: activePlan.emailField,
    });
    const activated = await activateCampaign({
      officeId: office.id,
      campaignId: activeDraft.id,
      userId: null,
      expectedRevisionHash: activeDraft.revisionHash,
    });
    assert.equal(activated.activated, true);
    const activeBeforeFollowUp = await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: activeDraft.id },
      select: {
        subject: true,
        bodyTemplate: true,
        audienceRecordIds: true,
        audiencePersonalization: true,
        senderAccountId: true,
        senderDisplayName: true,
        senderRotation: true,
        dailyCap: true,
        revisionHash: true,
      },
    });
    const followUpSteps = normalizeCampaignFollowUps([{
      waitDays: 3,
      body: "Still interested in {{company}}? Reply STOP to opt out.",
    }]);
    const activeFollowUpUpdate = await setCampaignFollowUps({
      officeId: office.id,
      campaignId: activeDraft.id,
      followUps: followUpSteps,
      approvedByUserId: "follow-up-approver",
    });
    assert.equal(activeFollowUpUpdate.updated, true);
    assert.notEqual(activeFollowUpUpdate.revisionHash, activeBeforeFollowUp.revisionHash);
    const activeAfterFollowUp = await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: activeDraft.id },
      select: {
        followUps: true,
        subject: true,
        bodyTemplate: true,
        audienceRecordIds: true,
        audiencePersonalization: true,
        senderAccountId: true,
        senderDisplayName: true,
        senderRotation: true,
        dailyCap: true,
        revisionHash: true,
      },
    });
    assert.deepEqual(activeAfterFollowUp, {
      ...activeBeforeFollowUp,
      followUps: followUpSteps,
      revisionHash: activeFollowUpUpdate.revisionHash,
    });
    const malformedFollowUps = [
      ...followUpSteps,
      { waitDays: "bad", body: "Reply STOP to opt out." },
    ] as unknown as typeof followUpSteps;
    await assert.rejects(
      () => setCampaignFollowUps({
        officeId: office.id,
        campaignId: activeDraft.id,
        followUps: malformedFollowUps,
        approvedByUserId: "follow-up-approver",
      }),
      /Every follow-up step must have an integer waitDays and a body/,
    );
    assert.deepEqual(await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: activeDraft.id },
      select: { followUps: true, revisionHash: true },
    }), {
      followUps: followUpSteps,
      revisionHash: activeFollowUpUpdate.revisionHash,
    });
    const invalidFollowUp = normalizeCampaignFollowUps([{
      waitDays: 3,
      body: "Still interested in {{company}}?",
    }]);
    assert.deepEqual(campaignFollowUpBlockers(invalidFollowUp), [
      "Follow-up 1 body must contain an opt-out line.",
    ]);
    await assert.rejects(
      () => setCampaignFollowUps({
        officeId: office.id,
        campaignId: activeDraft.id,
        followUps: invalidFollowUp,
        approvedByUserId: "follow-up-approver",
      }),
      /Follow-up 1 body must contain an opt-out line/,
    );
    assert.deepEqual(normalizeCampaignFollowUps([{ waitDays: "bad", body: "Reply STOP to opt out." }]), []);
    await assert.rejects(
      () => setCampaignFollowUps({
        officeId: office.id,
        campaignId: activeDraft.id,
        followUps: [],
        approvedByUserId: "follow-up-approver",
      }),
      /At least one follow-up step is required/,
    );
    const afterActivation = await saveDraftCampaign({
      ...baseInput,
      campaignName: activeCampaignName,
      subject: "Fresh Wens draft",
      emailField: activePlan.emailField,
    });
    assert.notEqual(afterActivation.id, activeDraft.id);
    const rows = await prisma.outreachCampaign.findMany({
      where: { officeId: office.id, listId: list.id },
      select: { id: true, status: true, subject: true },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(rows.slice(-2), [
      { id: activeDraft.id, status: "ACTIVE", subject: "Active Wens test" },
      { id: afterActivation.id, status: "DRAFT", subject: "Fresh Wens draft" },
    ]);
    await prisma.outreachCampaign.update({
      where: { id: activeDraft.id },
      data: { status: "COMPLETED" },
    });
    assert.deepEqual(await setCampaignFollowUps({
      officeId: office.id,
      campaignId: activeDraft.id,
      followUps: followUpSteps,
      approvedByUserId: "follow-up-approver",
    }), { updated: false, reason: "CAMPAIGN_NOT_EDITABLE", revisionHash: null });
    await prisma.outreachCampaign.update({
      where: { id: activeDraft.id },
      data: { status: "CANCELLED" },
    });
    assert.deepEqual(await setCampaignFollowUps({
      officeId: office.id,
      campaignId: activeDraft.id,
      followUps: followUpSteps,
      approvedByUserId: "follow-up-approver",
    }), { updated: false, reason: "CAMPAIGN_NOT_EDITABLE", revisionHash: null });
    const sequenceBeforeReplacement = await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: rotationDraft.id },
      select: { followUps: true, revisionHash: true },
    });
    await prisma.outreachCampaignFollowUp.create({
      data: {
        officeId: office.id,
        campaignId: rotationDraft.id,
        recordId: record.id,
        step: 1,
        recipient: `wens-${suffix}@example.test`,
        status: "QUEUED",
        dueAt: new Date("2026-09-06T00:00:00.000Z"),
      },
    });
    const replacement = await setCampaignFollowUps({
      officeId: office.id,
      campaignId: rotationDraft.id,
      followUps: followUpSteps,
      approvedByUserId: "follow-up-approver",
    });
    assert.deepEqual(replacement, {
      updated: false,
      reason: "FOLLOW_UPS_ALREADY_IN_FLIGHT",
      revisionHash: null,
    });
    assert.deepEqual(await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: rotationDraft.id },
      select: { followUps: true, revisionHash: true },
    }), sequenceBeforeReplacement);

    const contactedCampaign = await prisma.outreachCampaign.create({
      data: {
        officeId: office.id,
        listId: list.id,
        name: `Contacted Wens campaign ${suffix}`,
        status: "ACTIVE",
        subject: "Contacted",
        bodyTemplate: "Reply STOP to opt out.",
        emailField: "primary_email",
        rowStatuses: ["new"],
        filters: Prisma.DbNull,
        senderAccountId: sender.id,
        senderDisplayName: null,
        variants: Prisma.DbNull,
        audienceTotal: 1,
        audienceRecordIds: [list.id],
        audiencePersonalization: Prisma.DbNull,
        revisionHash: "contacted",
      },
      select: { id: true },
    });
    await prisma.outreachCampaignSend.create({
      data: {
        officeId: office.id,
        campaignId: contactedCampaign.id,
        recordId: `contacted-${suffix}`,
        recipient: `wens-${suffix}@example.test`,
        status: "SENT",
      },
    });
    const dedupePlan = await planOutreachCampaign({
      ...baseInput,
      campaignName: `Dedupe Wens campaign ${suffix}`,
    });
    assert.equal(dedupePlan.alreadyContactedElsewhere, 1);
    assert.equal(dedupePlan.eligible, 0);

    const overlappingCampaign = await prisma.outreachCampaign.create({
      data: {
        officeId: office.id,
        listId: list.id,
        name: `Overlapping Wens campaign ${suffix}`,
        status: "ACTIVE",
        subject: "Overlap",
        bodyTemplate: "Reply STOP to opt out.",
        emailField: "primary_email",
        rowStatuses: ["new"],
        filters: Prisma.DbNull,
        senderAccountId: sender.id,
        senderDisplayName: null,
        variants: Prisma.DbNull,
        audienceTotal: 1,
        audienceRecordIds: [record.id],
        audiencePersonalization: {
          [record.id]: { email: ` WENS-${suffix}@EXAMPLE.TEST ` },
        },
        revisionHash: "overlap",
      },
      select: { id: true },
    });
    const overlapCompletion = await completeCampaignIfDone({
      officeId: office.id,
      campaignId: overlappingCampaign.id,
    });
    assert.deepEqual(overlapCompletion, { completed: true });
    assert.equal((await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: overlappingCampaign.id },
      select: { status: true },
    })).status, "COMPLETED");
    const compareAndSetCampaign = await prisma.outreachCampaign.create({
      data: {
        officeId: office.id,
        listId: list.id,
        name: `Compare and set Wens campaign ${suffix}`,
        status: "ACTIVE",
        subject: "Compare and set",
        bodyTemplate: "Reply STOP to opt out.",
        emailField: "primary_email",
        rowStatuses: ["new"],
        filters: Prisma.DbNull,
        senderAccountId: sender.id,
        senderDisplayName: null,
        variants: Prisma.DbNull,
        audienceTotal: 1,
        audienceRecordIds: [record.id],
        audiencePersonalization: {
          [record.id]: { email: `wens-${suffix}@example.test` },
        },
        revisionHash: "compare-and-set-old",
      },
      select: { id: true },
    });
    const originalUpdateMany = prisma.outreachCampaign.updateMany.bind(prisma.outreachCampaign);
    let revisionChanged = false;
    prisma.outreachCampaign.updateMany = async (
      args: Parameters<typeof prisma.outreachCampaign.updateMany>[0],
    ) => {
      if (!revisionChanged && args.data.status === "COMPLETED") {
        revisionChanged = true;
        await originalUpdateMany({
          where: { id: compareAndSetCampaign.id, officeId: office.id },
          data: { revisionHash: "compare-and-set-new" },
        });
      }
      return originalUpdateMany(args);
    };
    let compareAndSetResult: { completed: boolean };
    try {
      compareAndSetResult = await completeCampaignIfDone({
        officeId: office.id,
        campaignId: compareAndSetCampaign.id,
      });
    } finally {
      prisma.outreachCampaign.updateMany = originalUpdateMany;
    }
    assert.deepEqual(compareAndSetResult, { completed: false });
    assert.equal((await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: compareAndSetCampaign.id },
      select: { status: true, revisionHash: true },
    })).status, "ACTIVE");
    assert.equal((await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: compareAndSetCampaign.id },
      select: { revisionHash: true },
    })).revisionHash, "compare-and-set-new");

    const capList = await prisma.researchList.create({
      data: {
        officeId: office.id,
        slug: `cap-${suffix}`,
        name: `Cap ${suffix}`,
        fields: [{ key: "email", label: "Email", type: "email" }],
      },
    });
    const capEmails = [
      `cap-one-${suffix}@example.test`,
      `cap-two-${suffix}@example.test`,
    ];
    const capRecords = await prisma.researchRecord.createManyAndReturn({
      data: [
        ...capEmails.map((email) => ({ officeId: office.id, listId: capList.id, data: { email } })),
      ],
      select: { id: true },
    });
    const capCampaign = await prisma.outreachCampaign.create({
      data: {
        officeId: office.id,
        listId: capList.id,
        name: `Cap Wens campaign ${suffix}`,
        status: "ACTIVE",
        subject: "Cap",
        bodyTemplate: "Reply STOP to opt out.",
        emailField: "email",
        rowStatuses: ["new"],
        filters: Prisma.DbNull,
        senderAccountId: sender.id,
        senderDisplayName: null,
        variants: Prisma.DbNull,
        audienceTotal: 2,
        audienceRecordIds: capRecords.map((item) => item.id),
        audiencePersonalization: Object.fromEntries(capRecords.map((item, index) => [
          item.id,
          { email: capEmails[index] },
        ])),
        revisionHash: "cap",
        dailyCap: 1,
      },
      select: { id: true },
    });
    await prisma.outreachCampaignSend.create({
      data: {
        officeId: office.id,
        campaignId: capCampaign.id,
        recordId: capRecords[0].id,
        recipient: `cap-one-${suffix}@example.test`,
        status: "SENT",
      },
    });
    const capCompletion = await completeCampaignIfDone({
      officeId: office.id,
      campaignId: capCampaign.id,
    });
    assert.deepEqual(capCompletion, { completed: false });
    assert.equal((await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: capCampaign.id },
      select: { status: true },
    })).status, "ACTIVE");

    async function createClaimFixture(label: string) {
      const claimList = await prisma.researchList.create({
        data: {
          officeId: office.id,
          slug: `${label}-${suffix}`,
          name: `${label} ${suffix}`,
          fields: [{ key: "email", label: "Email", type: "email" }],
        },
      });
      const claimRecord = await prisma.researchRecord.create({
        data: {
          officeId: office.id,
          listId: claimList.id,
          data: { email: `${label}-${suffix}@example.test` },
        },
      });
      return { claimList, claimRecord };
    }

    async function createClaimCampaign(input: {
      name: string;
      listId: string;
      recordId: string;
      email: string;
      status: string;
    }) {
      return prisma.outreachCampaign.create({
        data: {
          officeId: office.id,
          listId: input.listId,
          name: input.name,
          status: input.status,
          subject: "Claim",
          bodyTemplate: "Reply STOP to opt out.",
          emailField: "email",
          rowStatuses: ["new"],
          filters: Prisma.DbNull,
          senderAccountId: sender.id,
          senderDisplayName: null,
          variants: Prisma.DbNull,
          audienceTotal: 1,
          audienceRecordIds: [input.recordId],
          audiencePersonalization: { [input.recordId]: { email: input.email } },
          revisionHash: input.name,
        },
        select: { id: true },
      });
    }

    let claimSequence = 0;
    const claimProvider = {
      send: async () => {
        claimSequence += 1;
        return {
          state: "SENT" as const,
          provider: "GMAIL" as const,
          providerMessageId: `claim-message-${suffix}-${claimSequence}`,
          providerThreadId: `claim-thread-${suffix}-${claimSequence}`,
          sourceUrl: "https://mail.google.com",
        };
      },
      reconcile: async () => ({ state: "UNKNOWN" as const, error: "unused" }),
    };
    const liveFixture = await createClaimFixture("live-claim");
    const liveEmail = `live-claim-${suffix}@example.test`;
    const liveOwner = await createClaimCampaign({
      name: `Live owner ${suffix}`,
      listId: liveFixture.claimList.id,
      recordId: liveFixture.claimRecord.id,
      email: liveEmail,
      status: "ACTIVE",
    });
    const liveTarget = await createClaimCampaign({
      name: `Live target ${suffix}`,
      listId: liveFixture.claimList.id,
      recordId: liveFixture.claimRecord.id,
      email: liveEmail,
      status: "ACTIVE",
    });
    await prisma.outreachCampaignSend.create({
      data: {
        officeId: office.id,
        campaignId: liveOwner.id,
        recordId: liveFixture.claimRecord.id,
        recipient: liveEmail,
        status: "QUEUED",
      },
    });
    const livePlan = await planOutreachCampaign({
      officeId: office.id,
      list: liveFixture.claimList.slug,
      senderAccountId: sender.id,
      campaignName: `Live plan ${suffix}`,
      subject: "Claim",
      bodyTemplate: "Reply STOP to opt out.",
    });
    assert.equal(livePlan.alreadyContactedElsewhere, 1);
    const liveDraft = await saveDraftCampaign({
      officeId: office.id,
      list: liveFixture.claimList.slug,
      senderAccountId: sender.id,
      campaignName: `Live draft ${suffix}`,
      subject: "Claim",
      bodyTemplate: "Reply STOP to opt out.",
      emailField: "email",
    });
    assert.equal((await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: liveDraft.id },
      select: { audienceTotal: true },
    })).audienceTotal, 0);
    const liveBlockedTarget = await createClaimCampaign({
      name: `Live blocked target ${suffix}`,
      listId: liveFixture.claimList.id,
      recordId: liveFixture.claimRecord.id,
      email: liveEmail,
      status: "ACTIVE",
    });
    const liveBlockedRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: liveBlockedTarget.id,
      pauseMs: 0,
      provider: claimProvider,
    });
    assert.equal(liveBlockedRun.sent, 0);
    assert.equal(await prisma.outreachCampaignSend.count({
      where: { officeId: office.id, campaignId: liveBlockedTarget.id },
    }), 0);
    const cancelled = await cancelCampaign({
      officeId: office.id,
      campaignId: liveOwner.id,
    });
    assert.deepEqual(cancelled, { count: 1 });
    assert.equal(await prisma.outreachCampaignSend.count({
      where: { officeId: office.id, campaignId: liveOwner.id, status: "QUEUED" },
    }), 0);
    assert.deepEqual(await completeCampaignIfDone({
      officeId: office.id,
      campaignId: liveTarget.id,
    }), { completed: false });
    assert.equal((await prisma.outreachCampaign.findUniqueOrThrow({
      where: { id: liveTarget.id },
      select: { status: true },
    })).status, "ACTIVE");
    const releasedRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: liveTarget.id,
      pauseMs: 0,
      provider: claimProvider,
    });
    assert.equal(releasedRun.sent, 1);

    const reservedFixture = await createClaimFixture("reserved-claim");
    const reservedEmail = `reserved-claim-${suffix}@example.test`;
    const reservedOwner = await createClaimCampaign({
      name: `Reserved owner ${suffix}`,
      listId: reservedFixture.claimList.id,
      recordId: reservedFixture.claimRecord.id,
      email: reservedEmail,
      status: "ACTIVE",
    });
    const reservedTarget = await createClaimCampaign({
      name: `Reserved target ${suffix}`,
      listId: reservedFixture.claimList.id,
      recordId: reservedFixture.claimRecord.id,
      email: reservedEmail,
      status: "ACTIVE",
    });
    await prisma.outreachCampaignSend.create({
      data: {
        officeId: office.id,
        campaignId: reservedOwner.id,
        recordId: reservedFixture.claimRecord.id,
        recipient: reservedEmail,
        status: "QUEUED",
        reservationId: "in-flight-reservation",
      },
    });
    const reservedPlan = await planOutreachCampaign({
      officeId: office.id,
      list: reservedFixture.claimList.slug,
      senderAccountId: sender.id,
      campaignName: `Reserved plan ${suffix}`,
      subject: "Claim",
      bodyTemplate: "Reply STOP to opt out.",
    });
    assert.equal(reservedPlan.alreadyContactedElsewhere, 1);
    assert.deepEqual(await cancelCampaign({
      officeId: office.id,
      campaignId: reservedOwner.id,
    }), { count: 1 });
    assert.equal(await prisma.outreachCampaignSend.count({
      where: {
        officeId: office.id,
        campaignId: reservedOwner.id,
        status: "QUEUED",
        reservationId: { not: null },
      },
    }), 1);
    await prisma.outreachCampaignSend.updateMany({
      where: { officeId: office.id, campaignId: reservedOwner.id },
      data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    const staleReservedRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: reservedTarget.id,
      pauseMs: 0,
      provider: claimProvider,
    });
    assert.equal(staleReservedRun.sent, 1);

    const staleFixture = await createClaimFixture("stale-claim");
    const staleEmail = `stale-claim-${suffix}@example.test`;
    const staleOwner = await createClaimCampaign({
      name: `Stale owner ${suffix}`,
      listId: staleFixture.claimList.id,
      recordId: staleFixture.claimRecord.id,
      email: staleEmail,
      status: "ACTIVE",
    });
    const staleTarget = await createClaimCampaign({
      name: `Stale target ${suffix}`,
      listId: staleFixture.claimList.id,
      recordId: staleFixture.claimRecord.id,
      email: staleEmail,
      status: "ACTIVE",
    });
    await prisma.outreachCampaignSend.create({
      data: {
        officeId: office.id,
        campaignId: staleOwner.id,
        recordId: staleFixture.claimRecord.id,
        recipient: staleEmail,
        status: "QUEUED",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const staleRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: staleTarget.id,
      pauseMs: 0,
      provider: claimProvider,
    });
    assert.equal(staleRun.sent, 1);

    const sentFixture = await createClaimFixture("cancelled-sent");
    const sentEmail = `cancelled-sent-${suffix}@example.test`;
    const cancelledSentOwner = await createClaimCampaign({
      name: `Cancelled sent owner ${suffix}`,
      listId: sentFixture.claimList.id,
      recordId: sentFixture.claimRecord.id,
      email: sentEmail,
      status: "CANCELLED",
    });
    const sentTarget = await createClaimCampaign({
      name: `Cancelled sent target ${suffix}`,
      listId: sentFixture.claimList.id,
      recordId: sentFixture.claimRecord.id,
      email: sentEmail,
      status: "ACTIVE",
    });
    await prisma.outreachCampaignSend.create({
      data: {
        officeId: office.id,
        campaignId: cancelledSentOwner.id,
        recordId: sentFixture.claimRecord.id,
        recipient: sentEmail,
        status: "SENT",
      },
    });
    const cancelledSentRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: sentTarget.id,
      pauseMs: 0,
      provider: claimProvider,
    });
    assert.equal(cancelledSentRun.sent, 0);
    assert.equal(await prisma.outreachCampaignSend.count({
      where: { officeId: office.id, campaignId: sentTarget.id },
    }), 0);

    const failureFixture = await createClaimFixture("rejected-claim");
    const failureCampaign = await createClaimCampaign({
      name: `Rejected claim ${suffix}`,
      listId: failureFixture.claimList.id,
      recordId: failureFixture.claimRecord.id,
      email: `rejected-claim-${suffix}@example.test`,
      status: "ACTIVE",
    });
    const providerFailureRun = await runOutreachCampaignBatch({
      officeId: office.id,
      campaignId: failureCampaign.id,
      pauseMs: 0,
      provider: {
        ...claimProvider,
        send: async () => ({ state: "REJECTED" as const, error: "rejected" }),
      },
    });
    assert.equal(providerFailureRun.rejected, 1);
    const providerFailureSend = await prisma.outreachCampaignSend.findFirstOrThrow({
      where: { officeId: office.id, campaignId: failureCampaign.id },
      select: { status: true, reservationId: true },
    });
    assert.equal(providerFailureSend.status, "REJECTED");
    assert.equal(typeof providerFailureSend.reservationId, "string");
    console.log("Outreach campaign planning database checks passed.");
  } finally {
    await prisma.office.delete({ where: { id: office.id } });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
