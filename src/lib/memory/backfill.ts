import { prisma } from "@/lib/prisma";
import { DEMO_EMAIL_THREAD_MARKER } from "@/lib/email-demo-markers";
import { ingestKnowledgeObject, type EntityReference } from "./ingest-object";
import { recordMemoryEvent } from "./record-event";
import { assertCanonicalType } from "./canonical-types";

export type BackfillCompanyBrainInput = {
  officeId?: string | null;
  limit?: number | null;
  strict?: boolean;
};

type BackfillCountKey =
  | "companies"
  | "contacts"
  | "activities"
  | "inquiries"
  | "jobs"
  | "emailThreads"
  | "emailMessages"
  | "jobDocuments"
  | "strategyAssessments"
  | "agentProposals";

type BackfillCounts = Record<BackfillCountKey, number>;

function emptyCounts(): BackfillCounts {
  return {
    companies: 0,
    contacts: 0,
    activities: 0,
    inquiries: 0,
    jobs: 0,
    emailThreads: 0,
    emailMessages: 0,
    jobDocuments: 0,
    strategyAssessments: 0,
    agentProposals: 0,
  };
}

function take(limit: number | null | undefined) {
  return limit && limit > 0 ? Math.min(5000, Math.floor(limit)) : undefined;
}

function compact(value: string | null | undefined, max = 2000) {
  return value?.replace(/\s+/g, " ").trim().slice(0, max) ?? "";
}

function date(value: Date | null | undefined) {
  return value ?? new Date();
}

function canonicalType(value: string) {
  return assertCanonicalType(value);
}

async function eventForSnapshot(args: {
  officeId: string;
  objectId?: string | null;
  sourceType: string;
  sourceExternalId: string;
  entityType: string;
  entityId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  strict?: boolean;
}) {
  await recordMemoryEvent({
    officeId: args.officeId,
    sourceType: args.sourceType,
    sourceExternalId: args.sourceExternalId,
    objectId: args.objectId,
    eventType: `backfill.${args.entityType}.snapshot`,
    entityType: args.entityType,
    entityId: args.entityId,
    occurredAt: args.occurredAt,
    payloadVersion: 1,
    payload: args.payload,
    provenance: {
      source: "company_brain_backfill",
      operation: "snapshot",
      path: "src/lib/memory/backfill.ts",
      function: "backfillCompanyBrainMemory",
      sourceRecordId: args.entityId,
      sourceExternalId: args.sourceExternalId,
    },
    idempotencyKey: args.idempotencyKey,
    strict: args.strict,
  });
}

export async function backfillCompanyBrainMemory(input: BackfillCompanyBrainInput = {}) {
  const counts = emptyCounts();
  const officeWhere = input.officeId ? { officeId: input.officeId } : {};
  const rowTake = take(input.limit);
  const strict = input.strict === true;

  const companies = await prisma.company.findMany({
    where: officeWhere,
    orderBy: { updatedAt: "desc" },
    take: rowTake,
    select: {
      id: true, officeId: true, name: true, status: true, class1: true, class2: true,
      product: true, lane: true, direction: true, createdAt: true, updatedAt: true,
    },
  });
  for (const company of companies) {
    const sourceExternalId = `crm:company:${company.id}`;
    const object = await ingestKnowledgeObject({
      officeId: company.officeId,
      sourceType: "CRM",
      sourceExternalId,
      canonicalType: canonicalType("company"),
      title: company.name,
      text: [company.name, company.status, company.class1, company.class2, company.product, company.lane, company.direction].filter(Boolean).join(" | "),
      entityType: "company",
      entityId: company.id,
      companyId: company.id,
      occurredAt: company.updatedAt,
      payload: company,
      provenance: {
        source: "crm",
        operation: "backfill_company",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: company.id,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: company.officeId,
      objectId: object?.id ?? null,
      sourceType: "CRM",
      sourceExternalId,
      entityType: "company",
      entityId: company.id,
      occurredAt: company.updatedAt,
      payload: company,
      idempotencyKey: `backfill:company:${company.id}`,
      strict,
    });
    counts.companies++;
  }

  const contacts = await prisma.contact.findMany({
    where: input.officeId ? { company: { officeId: input.officeId } } : {},
    orderBy: { updatedAt: "desc" },
    take: rowTake,
    include: { company: { select: { id: true, officeId: true, name: true } } },
  });
  for (const contact of contacts) {
    const sourceExternalId = `crm:contact:${contact.id}`;
    const payload = {
      id: contact.id,
      companyId: contact.companyId,
      fullName: contact.fullName,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      notes: contact.notes,
      isApprovedForInbox: contact.isApprovedForInbox,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt,
    };
    const object = await ingestKnowledgeObject({
      officeId: contact.company.officeId,
      sourceType: "CRM",
      sourceExternalId,
      canonicalType: canonicalType("contact"),
      title: contact.fullName,
      text: [contact.fullName, contact.title, contact.email, contact.phone, contact.notes].filter(Boolean).join(" | "),
      entityType: "contact",
      entityId: contact.id,
      companyId: contact.companyId,
      contactId: contact.id,
      occurredAt: contact.updatedAt,
      payload,
      provenance: {
        source: "crm",
        operation: "backfill_contact",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: contact.id,
      },
      mentions: [{ entityType: "company", entityId: contact.companyId, label: contact.company.name }],
      strict,
    });
    await eventForSnapshot({
      officeId: contact.company.officeId,
      objectId: object?.id ?? null,
      sourceType: "CRM",
      sourceExternalId,
      entityType: "contact",
      entityId: contact.id,
      occurredAt: contact.updatedAt,
      payload,
      idempotencyKey: `backfill:contact:${contact.id}`,
      strict,
    });
    counts.contacts++;
  }

  const activities = await prisma.activity.findMany({
    where: officeWhere,
    orderBy: { occurredAt: "desc" },
    take: rowTake,
    include: { company: { select: { name: true } } },
  });
  for (const activity of activities) {
    const sourceExternalId = `crm:activity:${activity.id}`;
    const payload = {
      id: activity.id,
      companyId: activity.companyId,
      type: activity.type,
      occurredAt: activity.occurredAt,
      subject: activity.subject,
      body: activity.body,
      audioUrl: activity.audioUrl,
      createdByUserId: activity.createdByUserId,
    };
    const object = await ingestKnowledgeObject({
      officeId: activity.officeId,
      sourceType: "CRM",
      sourceExternalId,
      canonicalType: canonicalType("activity"),
      title: activity.subject ?? `${activity.type} with ${activity.company.name}`,
      text: [activity.type, activity.subject, activity.body].filter(Boolean).join("\n"),
      entityType: "activity",
      entityId: activity.id,
      companyId: activity.companyId,
      occurredAt: activity.occurredAt,
      payload,
      provenance: {
        source: "crm",
        operation: "backfill_activity",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: activity.id,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: activity.officeId,
      objectId: object?.id ?? null,
      sourceType: "CRM",
      sourceExternalId,
      entityType: "activity",
      entityId: activity.id,
      occurredAt: activity.occurredAt,
      payload,
      idempotencyKey: `backfill:activity:${activity.id}`,
      strict,
    });
    counts.activities++;
  }

  const inquiries = await prisma.inquiry.findMany({
    where: officeWhere,
    orderBy: { updatedAt: "desc" },
    take: rowTake,
  });
  for (const inquiry of inquiries) {
    const sourceExternalId = `inquiry:${inquiry.id}`;
    const payload = {
      id: inquiry.id,
      companyId: inquiry.companyId,
      subject: inquiry.subject,
      fromEmail: inquiry.fromEmail,
      fromCompany: inquiry.fromCompany,
      status: inquiry.status,
      type: inquiry.type,
      origin: inquiry.origin,
      destination: inquiry.destination,
      mode: inquiry.mode,
      commodity: inquiry.commodity,
      targetPrice: inquiry.targetPrice,
      targetCurrency: inquiry.targetCurrency,
      targetPriceStatus: inquiry.targetPriceStatus,
      notes: inquiry.notes,
      parsedData: inquiry.parsedData,
      receivedAt: inquiry.receivedAt,
      updatedAt: inquiry.updatedAt,
    };
    const object = await ingestKnowledgeObject({
      officeId: inquiry.officeId,
      sourceType: "INQUIRY",
      sourceExternalId,
      canonicalType: canonicalType("rfq"),
      title: inquiry.subject,
      text: [inquiry.subject, inquiry.fromEmail, inquiry.fromCompany, inquiry.origin, inquiry.destination, inquiry.mode, inquiry.commodity, inquiry.notes, compact(inquiry.rawEmailBody)].filter(Boolean).join("\n"),
      entityType: "inquiry",
      entityId: inquiry.id,
      companyId: inquiry.companyId,
      inquiryId: inquiry.id,
      occurredAt: inquiry.updatedAt,
      payload,
      provenance: {
        source: "inquiry",
        operation: "backfill_inquiry",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: inquiry.id,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: inquiry.officeId,
      objectId: object?.id ?? null,
      sourceType: "INQUIRY",
      sourceExternalId,
      entityType: "inquiry",
      entityId: inquiry.id,
      occurredAt: inquiry.updatedAt,
      payload,
      idempotencyKey: `backfill:inquiry:${inquiry.id}`,
      strict,
    });
    counts.inquiries++;
  }

  const jobs = await prisma.job.findMany({
    where: officeWhere,
    orderBy: { updatedAt: "desc" },
    take: rowTake,
  });
  for (const job of jobs) {
    const sourceExternalId = `job:${job.id}`;
    const payload = {
      id: job.id,
      reference: job.reference,
      title: job.title,
      companyId: job.companyId,
      inquiryId: job.inquiryId,
      status: job.status,
      type: job.type,
      origin: job.origin,
      destination: job.destination,
      mode: job.mode,
      commodity: job.commodity,
      targetPrice: job.targetPrice,
      targetCurrency: job.targetCurrency,
      revenue: job.revenue,
      cost: job.cost,
      currency: job.currency,
      notes: job.notes,
      updatedAt: job.updatedAt,
    };
    const object = await ingestKnowledgeObject({
      officeId: job.officeId,
      sourceType: "JOB",
      sourceExternalId,
      canonicalType: canonicalType("job"),
      title: job.title ?? job.reference,
      text: [job.reference, job.title, job.status, job.origin, job.destination, job.mode, job.commodity, job.notes].filter(Boolean).join("\n"),
      entityType: "job",
      entityId: job.id,
      companyId: job.companyId,
      inquiryId: job.inquiryId,
      jobId: job.id,
      occurredAt: job.updatedAt,
      payload,
      provenance: {
        source: "job",
        operation: "backfill_job",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: job.id,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: job.officeId,
      objectId: object?.id ?? null,
      sourceType: "JOB",
      sourceExternalId,
      entityType: "job",
      entityId: job.id,
      occurredAt: job.updatedAt,
      payload,
      idempotencyKey: `backfill:job:${job.id}`,
      strict,
    });
    counts.jobs++;
  }

  const threads = await prisma.emailThread.findMany({
    where: { ...officeWhere, NOT: { autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER } },
    orderBy: { updatedAt: "desc" },
    take: rowTake,
  });
  for (const thread of threads) {
    const sourceType = thread.externalThreadId?.startsWith("whatsapp:") ? "WHATSAPP" : "GMAIL";
    const sourceExternalId = `${sourceType.toLowerCase()}:thread:${thread.id}`;
    const mentions: EntityReference[] = [
      { entityType: "job", entityId: thread.jobId },
      { entityType: "inquiry", entityId: thread.inquiryId },
    ];
    const payload = {
      id: thread.id,
      jobId: thread.jobId,
      inquiryId: thread.inquiryId,
      subject: thread.subject,
      participants: thread.participants,
      externalThreadId: thread.externalThreadId,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread.messageCount,
      supplierOffer: thread.supplierOffer,
      hiddenAt: thread.hiddenAt,
      snoozedUntil: thread.snoozedUntil,
    };
    const object = await ingestKnowledgeObject({
      officeId: thread.officeId,
      sourceType,
      sourceExternalId,
      canonicalType: canonicalType("email_thread"),
      title: thread.subject,
      text: [thread.subject, thread.participants, thread.supplierOffer].filter(Boolean).join("\n"),
      entityType: "email_thread",
      entityId: thread.id,
      inquiryId: thread.inquiryId,
      jobId: thread.jobId,
      emailThreadId: thread.id,
      occurredAt: thread.lastMessageAt,
      payload,
      provenance: {
        source: sourceType.toLowerCase(),
        operation: "backfill_email_thread",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: thread.id,
        sourceExternalId: thread.externalThreadId,
      },
      mentions,
      strict,
    });
    await eventForSnapshot({
      officeId: thread.officeId,
      objectId: object?.id ?? null,
      sourceType,
      sourceExternalId,
      entityType: "email_thread",
      entityId: thread.id,
      occurredAt: thread.lastMessageAt,
      payload,
      idempotencyKey: `backfill:email_thread:${thread.id}`,
      strict,
    });
    counts.emailThreads++;
  }

  const messages = await prisma.emailMessage.findMany({
    where: {
      thread: {
        ...(input.officeId ? { officeId: input.officeId } : {}),
        NOT: { autoLinkSkipReason: DEMO_EMAIL_THREAD_MARKER },
      },
    },
    orderBy: { sentAt: "desc" },
    take: rowTake,
    include: {
      account: { select: { provider: true, email: true } },
      thread: { select: { officeId: true, jobId: true, inquiryId: true, externalThreadId: true, subject: true } },
    },
  });
  for (const message of messages) {
    const sourceType = message.account?.provider === "WHATSAPP" || message.thread.externalThreadId?.startsWith("whatsapp:") ? "WHATSAPP" : "GMAIL";
    const sourceExternalId = `${sourceType.toLowerCase()}:message:${message.id}`;
    const payload = {
      id: message.id,
      threadId: message.threadId,
      accountProvider: message.account?.provider ?? null,
      accountEmail: message.account?.email ?? null,
      externalId: message.externalId,
      gmailMessageId: message.gmailMessageId,
      direction: message.direction,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: message.toEmails,
      subject: message.subject,
      attachments: message.attachments,
      sentAt: message.sentAt,
      classification: message.classification,
      classificationReason: message.classificationReason,
    };
    const object = await ingestKnowledgeObject({
      officeId: message.thread.officeId,
      sourceType,
      sourceExternalId,
      canonicalType: canonicalType("email_message"),
      title: message.subject ?? message.thread.subject,
      text: [message.subject, message.fromEmail, message.fromName, compact(message.bodyText, 8000)].filter(Boolean).join("\n"),
      entityType: "email_message",
      entityId: message.id,
      inquiryId: message.thread.inquiryId,
      jobId: message.thread.jobId,
      emailThreadId: message.threadId,
      emailMessageId: message.id,
      occurredAt: message.sentAt,
      payload,
      provenance: {
        source: sourceType.toLowerCase(),
        operation: "backfill_email_message",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: message.id,
        sourceExternalId: message.externalId,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: message.thread.officeId,
      objectId: object?.id ?? null,
      sourceType,
      sourceExternalId,
      entityType: "email_message",
      entityId: message.id,
      occurredAt: message.sentAt,
      payload,
      idempotencyKey: `backfill:email_message:${message.id}`,
      strict,
    });
    counts.emailMessages++;
  }

  const documents = await prisma.jobDocument.findMany({
    where: officeWhere,
    orderBy: { updatedAt: "desc" },
    take: rowTake,
    include: { job: { select: { companyId: true, inquiryId: true } } },
  });
  for (const doc of documents) {
    const sourceExternalId = `document:job_document:${doc.id}`;
    const payload = {
      id: doc.id,
      jobId: doc.jobId,
      name: doc.name,
      docType: doc.docType,
      status: doc.status,
      url: doc.url,
      aiSummary: doc.aiSummary,
      aiFlags: doc.aiFlags,
      aiKeyFields: doc.aiKeyFields,
      aiAnalyzedAt: doc.aiAnalyzedAt,
      updatedAt: doc.updatedAt,
    };
    const object = await ingestKnowledgeObject({
      officeId: doc.officeId,
      sourceType: "DOCUMENT",
      sourceExternalId,
      canonicalType: canonicalType("job_document"),
      title: doc.name,
      text: [doc.name, doc.docType, doc.status, doc.aiSummary, doc.aiFlags, doc.aiKeyFields].filter(Boolean).join("\n"),
      entityType: "job_document",
      entityId: doc.id,
      companyId: doc.job.companyId,
      inquiryId: doc.job.inquiryId,
      jobId: doc.jobId,
      jobDocumentId: doc.id,
      occurredAt: doc.updatedAt,
      payload,
      provenance: {
        source: "document",
        operation: "backfill_job_document",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: doc.id,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: doc.officeId,
      objectId: object?.id ?? null,
      sourceType: "DOCUMENT",
      sourceExternalId,
      entityType: "job_document",
      entityId: doc.id,
      occurredAt: doc.updatedAt,
      payload,
      idempotencyKey: `backfill:job_document:${doc.id}`,
      strict,
    });
    counts.jobDocuments++;
  }

  const strategies = await prisma.strategyAssessment.findMany({
    where: officeWhere,
    orderBy: { updatedAt: "desc" },
    take: rowTake,
  });
  for (const strategy of strategies) {
    const sourceExternalId = `strategy:assessment:${strategy.id}`;
    const payload = {
      id: strategy.id,
      inquiryId: strategy.inquiryId,
      jobId: strategy.jobId,
      entityType: strategy.entityType,
      subject: strategy.subject,
      recommendation: strategy.recommendation,
      recommendationLabel: strategy.recommendationLabel,
      strategyMemo: strategy.strategyMemo,
      score: strategy.score,
      band: strategy.band,
      confidence: strategy.confidence,
      status: strategy.status,
      decisionBrief: strategy.decisionBrief,
      createdAt: strategy.createdAt,
      updatedAt: strategy.updatedAt,
    };
    const object = await ingestKnowledgeObject({
      officeId: strategy.officeId,
      sourceType: "STRATEGY",
      sourceExternalId,
      canonicalType: canonicalType("strategy_assessment"),
      title: strategy.subject ?? strategy.recommendationLabel,
      text: [strategy.subject, strategy.recommendationLabel, strategy.strategyMemo, strategy.band, strategy.confidence].filter(Boolean).join("\n"),
      entityType: "strategy_assessment",
      entityId: strategy.id,
      inquiryId: strategy.inquiryId,
      jobId: strategy.jobId,
      strategyAssessmentId: strategy.id,
      occurredAt: strategy.updatedAt,
      payload,
      provenance: {
        source: "strategy",
        operation: "backfill_strategy_assessment",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: strategy.id,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: strategy.officeId,
      objectId: object?.id ?? null,
      sourceType: "STRATEGY",
      sourceExternalId,
      entityType: "strategy_assessment",
      entityId: strategy.id,
      occurredAt: strategy.updatedAt,
      payload,
      idempotencyKey: `backfill:strategy_assessment:${strategy.id}`,
      strict,
    });
    counts.strategyAssessments++;
  }

  const proposals = await prisma.agentProposal.findMany({
    where: officeWhere,
    orderBy: { createdAt: "desc" },
    take: rowTake,
  });
  for (const proposal of proposals) {
    const sourceExternalId = `agent_proposal:${proposal.id}`;
    const payload = {
      id: proposal.id,
      userId: proposal.userId,
      jobId: proposal.jobId,
      inquiryId: proposal.inquiryId,
      kind: proposal.kind,
      status: proposal.status,
      sourceType: proposal.sourceType,
      sourcePreview: proposal.sourcePreview,
      reviewDecision: proposal.reviewDecision,
      reviewNote: proposal.reviewNote,
      reviewedByUserId: proposal.reviewedByUserId,
      reviewedAt: proposal.reviewedAt,
      createdAt: proposal.createdAt,
      appliedAt: proposal.appliedAt,
    };
    const object = await ingestKnowledgeObject({
      officeId: proposal.officeId,
      sourceType: "AGENT",
      sourceExternalId,
      canonicalType: canonicalType("agent_proposal"),
      title: `${proposal.kind} ${proposal.status}`,
      text: [proposal.kind, proposal.status, proposal.sourceType, proposal.sourcePreview, proposal.reviewDecision, proposal.reviewNote].filter(Boolean).join("\n"),
      entityType: "agent_proposal",
      entityId: proposal.id,
      inquiryId: proposal.inquiryId,
      jobId: proposal.jobId,
      agentProposalId: proposal.id,
      occurredAt: proposal.reviewedAt ?? proposal.createdAt,
      payload,
      provenance: {
        source: "agent",
        operation: "backfill_agent_proposal",
        path: "src/lib/memory/backfill.ts",
        function: "backfillCompanyBrainMemory",
        sourceRecordId: proposal.id,
      },
      strict,
    });
    await eventForSnapshot({
      officeId: proposal.officeId,
      objectId: object?.id ?? null,
      sourceType: "AGENT",
      sourceExternalId,
      entityType: "agent_proposal",
      entityId: proposal.id,
      occurredAt: proposal.reviewedAt ?? proposal.createdAt,
      payload,
      idempotencyKey: `backfill:agent_proposal:${proposal.id}`,
      strict,
    });
    counts.agentProposals++;
  }

  return {
    ok: true as const,
    officeId: input.officeId ?? null,
    limit: rowTake ?? null,
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}
