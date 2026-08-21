import { prisma } from "@/lib/prisma";
import { hybridSearchMemory } from "./hybrid-search";

export type CustomerDossierInput = {
  officeId: string;
  companyId?: string | null;
  query?: string | null;
  limit?: number;
};

type SourceReference = {
  entityType: string;
  entityId: string;
  knowledgeObjectIds: string[];
  memoryEventIds: string[];
};

function clampLimit(limit: number | null | undefined, fallback = 12) {
  return Math.max(1, Math.min(50, Math.floor(limit ?? fallback)));
}

function money(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null || Number.isNaN(value)) return null;
  return `${currency ?? "USD"} ${Math.round(value).toLocaleString()}`;
}

function daysAgo(date: Date) {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

function compact(text: string | null | undefined, max = 500) {
  return text?.replace(/\s+/g, " ").trim().slice(0, max) ?? null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function entityKey(entityType: string, entityId: string | null | undefined) {
  return entityId ? `${entityType}:${entityId}` : null;
}

function addRef(map: Map<string, { objects: Set<string>; events: Set<string> }>, key: string | null, kind: "object" | "event", id: string) {
  if (!key) return;
  const existing = map.get(key) ?? { objects: new Set<string>(), events: new Set<string>() };
  if (kind === "object") existing.objects.add(id);
  else existing.events.add(id);
  map.set(key, existing);
}

function refsFrom(map: Map<string, { objects: Set<string>; events: Set<string> }>, entityType: string, entityId: string | null | undefined): SourceReference[] {
  const key = entityKey(entityType, entityId);
  if (!key || !entityId) return [];
  const found = map.get(key);
  return [{
    entityType,
    entityId,
    knowledgeObjectIds: found ? [...found.objects].slice(0, 5) : [],
    memoryEventIds: found ? [...found.events].slice(0, 5) : [],
  }];
}

function summarizeMoney(rows: Array<{ revenue: number | null; cost: number | null; currency: string | null }>) {
  const revenue = rows.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
  const cost = rows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const currency = rows.find((row) => row.currency)?.currency ?? "USD";
  return {
    revenue: money(revenue || null, currency),
    cost: money(cost || null, currency),
    grossProfit: money((revenue - cost) || null, currency),
  };
}

export async function getCustomerDossier(input: CustomerDossierInput) {
  const limit = clampLimit(input.limit);
  const company = input.companyId
    ? await prisma.company.findFirst({
        where: { id: input.companyId, officeId: input.officeId },
        select: { id: true, name: true, status: true, class1: true, class2: true, product: true, lane: true, direction: true, updatedAt: true, createdAt: true },
      })
    : input.query?.trim()
      ? await prisma.company.findFirst({
          where: {
            officeId: input.officeId,
            name: { contains: input.query.trim(), mode: "insensitive" },
          },
          select: { id: true, name: true, status: true, class1: true, class2: true, product: true, lane: true, direction: true, updatedAt: true, createdAt: true },
          orderBy: { updatedAt: "desc" },
        })
      : null;

  if (!company) {
    return { found: false as const, message: "No matching customer found." };
  }

  const activeStatuses = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS"];
  const staleDate = new Date(Date.now() - 5 * 86_400_000);

  const [
    contacts,
    activities,
    crmQuotes,
    jobs,
    inquiries,
    carrierQuotes,
    targetPriceHistory,
    emailMessages,
    emailThreads,
    jobDocuments,
    companyDocuments,
    strategies,
    risks,
    tasks,
    marketLinks,
  ] = await Promise.all([
    prisma.contact.findMany({
      where: { companyId: company.id },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, fullName: true, title: true, email: true, phone: true, isApprovedForInbox: true, notes: true, updatedAt: true },
    }),
    prisma.activity.findMany({
      where: { officeId: input.officeId, companyId: company.id },
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: { id: true, type: true, occurredAt: true, subject: true, body: true },
    }),
    prisma.quote.findMany({
      where: { officeId: input.officeId, companyId: company.id },
      orderBy: { quotedAt: "desc" },
      take: limit,
      select: { id: true, result: true, origin: true, destination: true, mode: true, value: true, currency: true, lostReason: true, quotedAt: true },
    }),
    prisma.job.findMany({
      where: { officeId: input.officeId, companyId: company.id },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true, reference: true, title: true, status: true, type: true, origin: true, destination: true,
        mode: true, revenue: true, cost: true, currency: true, eta: true, etd: true, inquiryId: true, updatedAt: true,
      },
    }),
    prisma.inquiry.findMany({
      where: { officeId: input.officeId, companyId: company.id },
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true, subject: true, status: true, type: true, origin: true, destination: true, mode: true,
        targetPrice: true, targetCurrency: true, targetPriceStatus: true, receivedAt: true, updatedAt: true,
      },
    }),
    prisma.carrierQuote.findMany({
      where: { inquiry: { officeId: input.officeId, companyId: company.id } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true, inquiryId: true, carrier: true, quoteType: true, rateName: true, total20: true, total40: true,
        total40HC: true, status: true, transitDays: true, validity: true, updatedAt: true,
        inquiry: { select: { subject: true } },
      },
    }),
    prisma.targetPriceHistory.findMany({
      where: {
        officeId: input.officeId,
        OR: [
          { job: { companyId: company.id } },
          { inquiry: { companyId: company.id } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, inquiryId: true, jobId: true, amount: true, currency: true, status: true, source: true, note: true, createdAt: true },
    }),
    prisma.emailMessage.findMany({
      where: {
        thread: {
          officeId: input.officeId,
          OR: [
            { job: { companyId: company.id } },
            { inquiry: { companyId: company.id } },
          ],
        },
      },
      orderBy: { sentAt: "desc" },
      take: limit,
      select: {
        id: true, direction: true, fromEmail: true, fromName: true, subject: true, bodyText: true,
        classification: true, classificationReason: true, sentAt: true,
        thread: { select: { id: true, subject: true, jobId: true, inquiryId: true } },
      },
    }),
    prisma.emailThread.findMany({
      where: {
        officeId: input.officeId,
        OR: [
          { job: { companyId: company.id } },
          { inquiry: { companyId: company.id } },
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      take: limit,
      select: {
        id: true, subject: true, jobId: true, inquiryId: true, lastMessageAt: true, messageCount: true, supplierOffer: true, supplierOfferAt: true,
        messages: { orderBy: { sentAt: "desc" }, take: 1, select: { id: true, direction: true, fromEmail: true, fromName: true, sentAt: true } },
      },
    }),
    prisma.jobDocument.findMany({
      where: { officeId: input.officeId, job: { companyId: company.id } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, jobId: true, name: true, docType: true, status: true, aiSummary: true, aiFlags: true, updatedAt: true },
    }),
    prisma.companyContext.findMany({
      where: { officeId: input.officeId, companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, itemId: true, name: true, kind: true, description: true, createdAt: true },
    }),
    prisma.strategyAssessment.findMany({
      where: {
        officeId: input.officeId,
        OR: [
          { job: { companyId: company.id } },
          { inquiry: { companyId: company.id } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, inquiryId: true, jobId: true, subject: true, recommendation: true, recommendationLabel: true,
        strategyMemo: true, band: true, confidence: true, status: true, createdAt: true,
        priceRecommendation: { select: { recommendedPrice: true, floorPrice: true, guardrailStatus: true, currency: true, expectedGrossProfit: true } },
        riskAssessments: { orderBy: { score: "desc" }, take: 3, select: { id: true, category: true, level: true, score: true, reason: true, mitigation: true } },
        actions: { orderBy: { createdAt: "asc" }, take: 3, select: { id: true, actionType: true, priority: true, title: true, status: true, requiresApproval: true } },
      },
    }),
    prisma.riskAlert.findMany({
      where: { officeId: input.officeId, companyId: company.id, isOpen: true },
      orderBy: [{ level: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { id: true, level: true, reason: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { officeId: input.officeId, companyId: company.id, status: "OPEN" },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: limit,
      select: { id: true, title: true, details: true, dueAt: true, status: true, createdAt: true },
    }),
    prisma.marketSignalLink.findMany({
      where: { officeId: input.officeId, entityType: "company", entityId: company.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        signal: {
          include: {
            sourceObject: { select: { id: true, title: true, sourceType: true, sourceExternalId: true, occurredAt: true } },
          },
        },
      },
    }).catch(() => []),
  ]);

  const idsByType = new Map<string, Set<string>>();
  const addEntity = (type: string, id: string | null | undefined) => {
    if (!id) return;
    const set = idsByType.get(type) ?? new Set<string>();
    set.add(id);
    idsByType.set(type, set);
  };

  addEntity("company", company.id);
  contacts.forEach((row) => addEntity("contact", row.id));
  activities.forEach((row) => addEntity("activity", row.id));
  jobs.forEach((row) => addEntity("job", row.id));
  inquiries.forEach((row) => addEntity("inquiry", row.id));
  emailMessages.forEach((row) => {
    addEntity("email_message", row.id);
    addEntity("email_thread", row.thread.id);
    addEntity("job", row.thread.jobId);
    addEntity("inquiry", row.thread.inquiryId);
  });
  emailThreads.forEach((row) => addEntity("email_thread", row.id));
  jobDocuments.forEach((row) => addEntity("job_document", row.id));
  strategies.forEach((row) => addEntity("strategy_assessment", row.id));

  const entityOr = [...idsByType.entries()].map(([entityType, ids]) => ({
    entityType,
    entityId: { in: [...ids] },
  }));

  const [memoryObjects, memoryEvents, hybridMemory] = await Promise.all([
    prisma.knowledgeObject.findMany({
      where: {
        officeId: input.officeId,
        OR: [
          { companyId: company.id },
          ...(entityOr.length ? entityOr : []),
        ],
      },
      orderBy: { occurredAt: "desc" },
      take: Math.max(limit * 4, 30),
      select: {
        id: true, canonicalType: true, title: true, sourceType: true, sourceExternalId: true,
        entityType: true, entityId: true, companyId: true, contactId: true, inquiryId: true, jobId: true,
        emailThreadId: true, emailMessageId: true, jobDocumentId: true, strategyAssessmentId: true,
        occurredAt: true, provenance: true,
        chunks: { orderBy: { ordinal: "asc" }, take: 1, select: { id: true, text: true } },
      },
    }).catch(() => []),
    prisma.memoryEvent.findMany({
      where: {
        officeId: input.officeId,
        OR: entityOr.length ? entityOr : [{ entityType: "company", entityId: company.id }],
      },
      orderBy: { occurredAt: "desc" },
      take: Math.max(limit * 4, 30),
      select: { id: true, eventType: true, sourceType: true, entityType: true, entityId: true, occurredAt: true, payload: true, provenance: true },
    }).catch(() => []),
    hybridSearchMemory({
      officeId: input.officeId,
      companyId: company.id,
      limit: Math.max(limit * 2, 20),
      includeEvents: true,
      includeChunks: true,
    }).catch(() => ({
      results: [],
      evidence: [],
      evidence_for_agent: "",
      evidence_for_user: [],
    })),
  ]);

  const refMap = new Map<string, { objects: Set<string>; events: Set<string> }>();
  for (const object of memoryObjects) {
    addRef(refMap, entityKey(object.entityType ?? "", object.entityId), "object", object.id);
    addRef(refMap, entityKey("company", object.companyId), "object", object.id);
    addRef(refMap, entityKey("contact", object.contactId), "object", object.id);
    addRef(refMap, entityKey("inquiry", object.inquiryId), "object", object.id);
    addRef(refMap, entityKey("job", object.jobId), "object", object.id);
    addRef(refMap, entityKey("email_thread", object.emailThreadId), "object", object.id);
    addRef(refMap, entityKey("email_message", object.emailMessageId), "object", object.id);
    addRef(refMap, entityKey("job_document", object.jobDocumentId), "object", object.id);
    addRef(refMap, entityKey("strategy_assessment", object.strategyAssessmentId), "object", object.id);
  }
  for (const event of memoryEvents) {
    addRef(refMap, entityKey(event.entityType, event.entityId), "event", event.id);
  }

  const wonQuotes = crmQuotes.filter((quote) => quote.result === "WON");
  const lostQuotes = crmQuotes.filter((quote) => quote.result === "LOST");
  const activeJobs = jobs.filter((job) => activeStatuses.includes(job.status));
  const staleJobs = activeJobs.filter((job) => job.updatedAt < staleDate);
  const moneySummary = summarizeMoney(jobs);
  const unansweredThreads = emailThreads.filter((thread) => thread.messages[0]?.direction === "INBOUND");
  const pendingDocs = jobDocuments.filter((doc) => doc.status === "PENDING");
  const highRiskStrategies = strategies.filter((strategy) => strategy.riskAssessments.some((risk) => risk.score >= 70 || risk.level === "HIGH" || risk.level === "CRITICAL"));
  const latestStrategy = strategies.find((strategy) => strategy.status === "ACTIVE") ?? strategies[0] ?? null;

  const source = (entityType: string, entityId: string | null | undefined) => refsFrom(refMap, entityType, entityId);
  const recommendedActions = [
    unansweredThreads[0] ? {
      action: `Reply to latest inbound thread: ${unansweredThreads[0].subject}`,
      reason: "Last message is inbound, so the customer or supplier is waiting on the office.",
      sources: source("email_thread", unansweredThreads[0].id),
    } : null,
    risks[0] ? {
      action: `Resolve open ${risks[0].level.toLowerCase()} customer risk`,
      reason: risks[0].reason,
      sources: source("company", company.id),
    } : null,
    pendingDocs[0] ? {
      action: `Clear pending document: ${pendingDocs[0].name}`,
      reason: `${pendingDocs.length} recent job document${pendingDocs.length === 1 ? "" : "s"} are still pending.`,
      sources: source("job_document", pendingDocs[0].id),
    } : null,
    staleJobs[0] ? {
      action: `Move or update stale job ${staleJobs[0].reference}`,
      reason: `No job update for ${daysAgo(staleJobs[0].updatedAt)} days.`,
      sources: source("job", staleJobs[0].id),
    } : null,
    latestStrategy?.actions[0] ? {
      action: latestStrategy.actions[0].title,
      reason: `Latest strategy action is ${latestStrategy.actions[0].priority} priority.`,
      sources: source("strategy_assessment", latestStrategy.id),
    } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 8);

  return {
    found: true as const,
    generatedAt: new Date(),
    company_profile: {
      ...company,
      sources: source("company", company.id),
    },
    contacts: contacts.map((contact) => ({ ...contact, sources: source("contact", contact.id) })),
    recent_emails: emailMessages.map((message) => ({
      id: message.id,
      direction: message.direction,
      from: message.fromName ?? message.fromEmail,
      subject: message.subject ?? message.thread.subject,
      excerpt: compact(message.bodyText),
      classification: message.classification,
      classificationReason: message.classificationReason,
      sentAt: message.sentAt,
      threadId: message.thread.id,
      jobId: message.thread.jobId,
      inquiryId: message.thread.inquiryId,
      sources: [...source("email_message", message.id), ...source("email_thread", message.thread.id)],
    })),
    recent_activities: activities.map((activity) => ({ ...activity, sources: source("activity", activity.id) })),
    active_jobs: activeJobs.map((job) => ({
      ...job,
      grossProfit: job.revenue != null || job.cost != null ? (job.revenue ?? 0) - (job.cost ?? 0) : null,
      daysSinceUpdate: daysAgo(job.updatedAt),
      sources: source("job", job.id),
    })),
    recent_inquiries: inquiries.map((inquiry) => ({ ...inquiry, sources: source("inquiry", inquiry.id) })),
    recent_quotes: {
      crm_quotes: crmQuotes.map((quote) => ({ ...quote, sources: source("company", company.id) })),
      carrier_quotes: carrierQuotes.map((quote) => ({ ...quote, sources: source("inquiry", quote.inquiryId) })),
    },
    target_price_history: targetPriceHistory.map((target) => ({
      ...target,
      sources: [...source("job", target.jobId), ...source("inquiry", target.inquiryId)],
    })),
    recent_documents: {
      job_documents: jobDocuments.map((doc) => ({ ...doc, sources: source("job_document", doc.id) })),
      company_documents: companyDocuments.map((doc) => ({ ...doc, sources: source("company", company.id) })),
    },
    recent_strategy_assessments: strategies.map((strategy) => ({
      ...strategy,
      sources: source("strategy_assessment", strategy.id),
    })),
    market_intelligence: marketLinks.map((link) => ({
      id: link.signal.id,
      category: link.signal.category,
      severity: link.signal.severity,
      confidence: link.signal.confidence,
      matchConfidence: link.confidence,
      matchType: link.matchType,
      summary: link.signal.summary,
      affectedModes: stringList(link.signal.affectedModes),
      affectedLanes: stringList(link.signal.affectedLanes),
      operatorImplication: link.signal.operatorImplication,
      pricingImplication: link.signal.pricingImplication,
      customerImpact: link.signal.customerImpact,
      recommendedActions: stringList(link.signal.recommendedActions),
      sources: [
        { entityType: "market_signal", entityId: link.signal.id, knowledgeObjectIds: link.signal.sourceObjectId ? [link.signal.sourceObjectId] : [], memoryEventIds: [] },
      ],
    })),
    open_risks: risks.map((risk) => ({ ...risk, sources: source("company", company.id) })),
    open_tasks: tasks.map((task) => ({ ...task, sources: source("company", company.id) })),
    unresolved_loops: unansweredThreads.map((thread) => ({
      threadId: thread.id,
      subject: thread.subject,
      lastMessageAt: thread.lastMessageAt,
      lastFrom: thread.messages[0]?.fromName ?? thread.messages[0]?.fromEmail ?? null,
      jobId: thread.jobId,
      inquiryId: thread.inquiryId,
      sources: source("email_thread", thread.id),
    })),
    relationship_preferences: {
      approved_inbox_contacts: contacts.filter((contact) => contact.isApprovedForInbox).map((contact) => ({
        id: contact.id,
        name: contact.fullName,
        email: contact.email,
        sources: source("contact", contact.id),
      })),
      contact_notes: contacts.filter((contact) => contact.notes).map((contact) => ({
        contactId: contact.id,
        note: contact.notes,
        sources: source("contact", contact.id),
      })),
      account_tags: {
        class1: company.class1,
        class2: company.class2,
        product: company.product,
        lane: company.lane,
        direction: company.direction,
        sources: source("company", company.id),
      },
    },
    commercial_summary: {
      activeJobs: activeJobs.length,
      recentRevenue: moneySummary.revenue,
      recentCost: moneySummary.cost,
      recentGrossProfit: moneySummary.grossProfit,
      wonQuotes: wonQuotes.length,
      lostQuotes: lostQuotes.length,
      latestStrategy: latestStrategy ? {
        id: latestStrategy.id,
        recommendation: latestStrategy.recommendationLabel,
        band: latestStrategy.band,
        confidence: latestStrategy.confidence,
        guardrail: latestStrategy.priceRecommendation?.guardrailStatus ?? null,
        recommendedPrice: money(latestStrategy.priceRecommendation?.recommendedPrice ?? null, latestStrategy.priceRecommendation?.currency ?? null),
        sources: source("strategy_assessment", latestStrategy.id),
      } : null,
      sources: [
        ...jobs.flatMap((job) => source("job", job.id)).slice(0, 5),
        ...crmQuotes.flatMap(() => source("company", company.id)).slice(0, 1),
      ],
    },
    operational_summary: {
      openJobs: activeJobs.length,
      staleJobs: staleJobs.length,
      pendingDocuments: pendingDocs.length,
      unansweredThreads: unansweredThreads.length,
      openRisks: risks.length,
      openTasks: tasks.length,
      highRiskStrategyAssessments: highRiskStrategies.length,
      marketSignals: marketLinks.length,
      sources: [
        ...activeJobs.flatMap((job) => source("job", job.id)).slice(0, 5),
        ...pendingDocs.flatMap((doc) => source("job_document", doc.id)).slice(0, 5),
        ...unansweredThreads.flatMap((thread) => source("email_thread", thread.id)).slice(0, 5),
      ],
    },
    recommended_next_actions: recommendedActions,
    memory: {
      hybrid_results: hybridMemory.results.slice(0, limit),
      evidence_refs: hybridMemory.evidence.slice(0, 30),
      evidence_for_agent: hybridMemory.evidence_for_agent,
      evidence_for_user: hybridMemory.evidence_for_user,
      recent_events: memoryEvents,
      recent_objects: memoryObjects.map((object) => ({
        id: object.id,
        canonicalType: object.canonicalType,
        title: object.title,
        sourceType: object.sourceType,
        sourceExternalId: object.sourceExternalId,
        occurredAt: object.occurredAt,
        excerpt: compact(object.chunks[0]?.text),
      })),
    },
  };
}

export function formatCompactCustomerDossier(dossier: Awaited<ReturnType<typeof getCustomerDossier>>) {
  if (!dossier.found) return "";
  const evidenceIds = [
    ...dossier.company_profile.sources.flatMap((source) => source.knowledgeObjectIds),
    ...dossier.company_profile.sources.flatMap((source) => source.memoryEventIds),
    ...dossier.recent_strategy_assessments.flatMap((strategy) => strategy.sources.flatMap((source) => [...source.knowledgeObjectIds, ...source.memoryEventIds])),
    ...dossier.memory.evidence_refs.flatMap((ref) => [ref.knowledgeObjectId, ref.knowledgeChunkId, ref.memoryEventId].filter((id): id is string => Boolean(id))),
  ].slice(0, 8);
  return [
    `Customer: ${dossier.company_profile.name} (${dossier.company_profile.status})`,
    `Commercial: ${dossier.commercial_summary.activeJobs} active jobs; recent GP ${dossier.commercial_summary.recentGrossProfit ?? "unknown"}; won/lost CRM quotes ${dossier.commercial_summary.wonQuotes}/${dossier.commercial_summary.lostQuotes}.`,
    dossier.commercial_summary.latestStrategy
      ? `Latest strategy: ${dossier.commercial_summary.latestStrategy.recommendation} · ${dossier.commercial_summary.latestStrategy.band}/${dossier.commercial_summary.latestStrategy.confidence} · guardrail ${dossier.commercial_summary.latestStrategy.guardrail ?? "unknown"}.`
      : "Latest strategy: none.",
    `Operations: ${dossier.operational_summary.staleJobs} stale jobs; ${dossier.operational_summary.pendingDocuments} pending docs; ${dossier.operational_summary.unansweredThreads} unresolved inbound loops; ${dossier.operational_summary.openRisks} open risks.`,
    dossier.market_intelligence.length
      ? `Market exposure: ${dossier.market_intelligence.length} active signal${dossier.market_intelligence.length === 1 ? "" : "s"}; latest ${dossier.market_intelligence[0].summary}.`
      : "Market exposure: no linked active signals.",
    dossier.relationship_preferences.approved_inbox_contacts.length
      ? `Approved contacts: ${dossier.relationship_preferences.approved_inbox_contacts.map((contact) => contact.email ?? contact.name).join(", ")}.`
      : "Approved contacts: none recorded.",
    dossier.recommended_next_actions.length
      ? `Recommended next actions: ${dossier.recommended_next_actions.slice(0, 3).map((action) => action.action).join(" | ")}.`
      : "Recommended next actions: none from deterministic checks.",
    evidenceIds.length ? `Evidence ids: ${evidenceIds.join(", ")}.` : "Evidence ids: no memory rows linked yet.",
  ].join("\n");
}

export async function buildCompactCustomerMemoryContext(input: CustomerDossierInput & { jobId?: string | null }) {
  let companyId = input.companyId ?? null;
  if (!companyId && input.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: input.jobId, officeId: input.officeId },
      select: { companyId: true },
    });
    companyId = job?.companyId ?? null;
  }
  if (!companyId && !input.query) return "";
  const dossier = await getCustomerDossier({ officeId: input.officeId, companyId, query: input.query, limit: input.limit ?? 8 });
  const compactDossier = formatCompactCustomerDossier(dossier);
  return compactDossier ? `\n\nCOMPACT CUSTOMER MEMORY (source-linked; use for customer/job context, but call memory tools for details):\n${compactDossier}\n` : "";
}
