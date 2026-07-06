import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { openInquiryStatusFilter } from "../src/lib/inquiry-status";
import { getMarketIntelligenceSourceRegistry } from "../src/lib/market-intelligence/source-registry";
import { scheduledMarketIngestionConfig } from "../src/lib/market-intelligence/scheduled-ingestion";
import { sourceAllowedDomains, sourceRunLimits, validateMarketSourceDefinition } from "../src/lib/market-intelligence/source-policy";
import { listSourceQualitySummaries } from "../src/lib/market-intelligence/source-quality";
import { getMarketSignalSuppressionReason } from "../src/lib/market-intelligence/signal-suppression";
import { generateMorningBrief } from "../src/lib/memory/morning-brief";
import { isValidMarketLane, rejectBoilerplateLaneCandidate } from "../src/lib/market-intelligence/lane-validation";

function argValue(name: string) {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

function table(title: string, rows: Record<string, unknown>[]) {
  console.log(`\n## ${title}`);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  console.table(rows);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractionInfo(payloadValue: unknown) {
  const payload = record(payloadValue);
  const hygiene = record(payload.contentHygiene);
  return {
    pageType: typeof hygiene.pageType === "string" ? hygiene.pageType : typeof payload.pageType === "string" ? payload.pageType : null,
    extractionStatus: typeof hygiene.extractionStatus === "string" ? hygiene.extractionStatus : typeof payload.extractionStatus === "string" ? payload.extractionStatus : null,
    score: typeof hygiene.contentQualityScore === "number" ? hygiene.contentQualityScore : typeof payload.contentQualityScore === "number" ? payload.contentQualityScore : null,
    reason: typeof hygiene.rejectionReason === "string" ? hygiene.rejectionReason : typeof payload.extractionRejectionReason === "string" ? payload.extractionRejectionReason : null,
  };
}

async function main() {
  const officeId = argValue("office");
  const whereOffice = officeId ? { officeId } : {};
  const now = new Date();
  const registry = getMarketIntelligenceSourceRegistry();
  const scheduleConfig = scheduledMarketIngestionConfig();
  const sourceScopes = officeId
    ? [{ id: officeId, name: officeId }]
    : await prisma.office.findMany({ orderBy: { createdAt: "asc" }, take: 20, select: { id: true, name: true } });
  const sourceQualityRows = (await Promise.all(sourceScopes.map(async (office) => {
    const summaries = await listSourceQualitySummaries({ officeId: office.id, now }).catch(() => []);
    return summaries.map((summary) => ({ office, summary }));
  }))).flat();
  const sourceQualityByOfficeObject = new Map<string, { score: number; scoreBand: string; sourceId: string }>();
  for (const { office, summary } of sourceQualityRows) {
    for (const sourceObjectId of summary.sourceObjectIds) {
      sourceQualityByOfficeObject.set(`${office.id}:${sourceObjectId}`, {
        score: summary.score,
        scoreBand: summary.scoreBand,
        sourceId: summary.sourceId,
      });
    }
  }
  const enabledFetchable = registry
    .filter((source) => source.enabled)
    .filter((source) => source.fetchType === "firecrawl_search" || source.fetchType === "firecrawl_scrape")
    .filter((source) => validateMarketSourceDefinition(source).ok)
    .slice(0, scheduleConfig.maxSources);
  const estimatedPages = enabledFetchable.reduce((sum, source) => {
    const limits = sourceRunLimits(source);
    return sum + Math.max(1, Math.min(source.maxPagesPerRun, limits.maxPages, scheduleConfig.maxPagesPerRun));
  }, 0);

  const [
    signals,
    reviewCounts,
    pendingReviews,
    staleSignals,
    links,
    feedbackRows,
    ingestionRunCounts,
    failedIngestionRuns,
    researchObjectCounts,
  ] = await Promise.all([
    prisma.marketSignal.findMany({
      where: whereOffice,
      include: {
        sourceObject: { select: { id: true, title: true, sourceType: true, sourceExternalId: true, payload: true } },
        links: { select: { id: true, entityType: true, entityId: true, matchType: true, confidence: true } },
        impactReviews: { select: { status: true, feedbackKind: true } },
        feedback: { select: { feedbackKind: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.marketImpactReview.groupBy({
      by: ["status"],
      where: whereOffice,
      _count: { _all: true },
    }),
    prisma.marketImpactReview.count({ where: { ...whereOffice, status: "pending" } }),
    prisma.marketSignal.findMany({
      where: {
        ...whereOffice,
        effectiveTo: { lt: now },
        impactReviews: { some: { status: { in: ["pending", "acknowledged"] } } },
      },
      select: { id: true, category: true, severity: true, summary: true, effectiveTo: true },
      take: 50,
    }),
    prisma.marketSignalLink.findMany({
      where: whereOffice,
      select: { id: true, officeId: true, entityType: true, entityId: true, signalId: true },
      take: 5000,
    }),
    prisma.marketSignalFeedback.findMany({
      where: {
        ...whereOffice,
        feedbackKind: { in: ["useful", "irrelevant", "wrong_link"] },
      },
      include: {
        marketSignal: {
          select: {
            id: true,
            sourceObject: { select: { id: true, title: true, sourceExternalId: true } },
          },
        },
      },
      take: 5000,
    }),
    prisma.marketIngestionRun.groupBy({
      by: ["provider", "status"],
      where: whereOffice,
      _count: { _all: true },
      _max: { createdAt: true },
    }).catch(() => []),
    prisma.marketIngestionRun.findMany({
      where: { ...whereOffice, status: "failed" },
      select: { id: true, provider: true, sourceId: true, query: true, error: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }).catch(() => []),
    prisma.knowledgeObject.groupBy({
      by: ["sourceType", "canonicalType"],
      where: { ...whereOffice, sourceType: "MARKET" },
      _count: { _all: true },
    }).catch(() => []),
  ]);
  const marketUpdates = await prisma.knowledgeObject.findMany({
    where: { ...whereOffice, sourceType: "MARKET", canonicalType: "market_update" },
    select: { id: true, officeId: true, title: true, sourceExternalId: true, payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  }).catch(() => []);

  const byCategorySeverity = new Map<string, number>();
  const duplicates = new Map<string, { sourceObjectId: string | null; category: string; summaryHash: string; count: number; ids: string[] }>();
  for (const signal of signals) {
    const key = `${signal.category}/${signal.severity}`;
    byCategorySeverity.set(key, (byCategorySeverity.get(key) ?? 0) + 1);
    const dupKey = `${signal.sourceObjectId ?? "none"}:${signal.category}:${hash(signal.summary)}`;
    const existing = duplicates.get(dupKey) ?? {
      sourceObjectId: signal.sourceObjectId,
      category: signal.category,
      summaryHash: hash(signal.summary),
      count: 0,
      ids: [],
    };
    existing.count += 1;
    existing.ids.push(signal.id);
    duplicates.set(dupKey, existing);
  }

  const jobIds = links.filter((link) => link.entityType === "job").map((link) => link.entityId);
  const inquiryIds = links.filter((link) => link.entityType === "inquiry").map((link) => link.entityId);
  const [activeJobs, activeInquiries] = await Promise.all([
    jobIds.length
      ? prisma.job.findMany({
          where: { id: { in: jobIds }, status: { notIn: ["DELIVERED", "CANCELLED"] } },
          select: { id: true },
        })
      : Promise.resolve([]),
    inquiryIds.length
      ? prisma.inquiry.findMany({
          where: { id: { in: inquiryIds }, status: openInquiryStatusFilter() },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const activeJobIds = new Set(activeJobs.map((job) => job.id));
  const activeInquiryIds = new Set(activeInquiries.map((inquiry) => inquiry.id));
  const inactiveLinks = links.filter((link) => (
    (link.entityType === "job" && !activeJobIds.has(link.entityId)) ||
    (link.entityType === "inquiry" && !activeInquiryIds.has(link.entityId))
  ));
  const suppressedSignals = signals.flatMap((signal) => {
    const sourceQuality = signal.sourceObjectId ? sourceQualityByOfficeObject.get(`${signal.officeId}:${signal.sourceObjectId}`) : null;
    const reason = getMarketSignalSuppressionReason({ signal, sourceQuality, requirePendingReview: true });
    return reason ? [{ signal, reason, sourceQuality }] : [];
  });
  const socialLaneLinks = links.filter((link) =>
    link.entityType === "lane" && /\b(facebook|flickr|instagram|twitter|linkedin|youtube|tiktok|threads|links?)\b/i.test(link.entityId)
  );
  const invalidLaneLinks = links.filter((link) => link.entityType === "lane" && !isValidMarketLane(link.entityId));
  const boilerplateLaneLinks = links.filter((link) => link.entityType === "lane" && rejectBoilerplateLaneCandidate(link.entityId));
  const skippedMarketUpdates = marketUpdates
    .map((object) => ({ object, extraction: extractionInfo(object.payload) }))
    .filter(({ extraction }) => extraction.extractionStatus && extraction.extractionStatus !== "signal_eligible");
  const indexOrNavigationUpdates = marketUpdates
    .map((object) => ({ object, extraction: extractionInfo(object.payload) }))
    .filter(({ extraction }) => extraction.pageType === "index_page" || extraction.pageType === "navigation_page");

  const morningBriefLeaks = (await Promise.all(sourceScopes.map(async (office) => {
    const brief = await generateMorningBrief({ officeId: office.id, limit: 20 }).catch(() => null);
    if (!brief) return [];
    return brief.market_intelligence.flatMap((signal) => {
      const dbSignal = signals.find((row) => row.id === signal.id && row.officeId === office.id);
      if (!dbSignal) return [];
      const sourceQuality = dbSignal.sourceObjectId ? sourceQualityByOfficeObject.get(`${office.id}:${dbSignal.sourceObjectId}`) : null;
      const reason = getMarketSignalSuppressionReason({ signal: dbSignal, sourceQuality, requirePendingReview: true });
      return reason ? [{ office: office.name, signalId: dbSignal.id, reason, summary: dbSignal.summary.slice(0, 100) }] : [];
    });
  }))).flat();

  const sourceFeedback = new Map<string, { source: string; useful: number; irrelevant: number; wrong_link: number }>();
  for (const feedback of feedbackRows) {
    const source = feedback.marketSignal.sourceObject?.title
      ?? feedback.marketSignal.sourceObject?.sourceExternalId
      ?? feedback.marketSignal.id;
    const row = sourceFeedback.get(source) ?? { source, useful: 0, irrelevant: 0, wrong_link: 0 };
    if (feedback.feedbackKind === "useful") row.useful += 1;
    if (feedback.feedbackKind === "irrelevant") row.irrelevant += 1;
    if (feedback.feedbackKind === "wrong_link") row.wrong_link += 1;
    sourceFeedback.set(source, row);
  }

  console.log("Market Intelligence Doctor");
  console.log(`Scope: ${officeId ?? "all offices"}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Schedule: cronEnabled=${scheduleConfig.cronEnabled} liveIngestionEnabled=${scheduleConfig.liveIngestionEnabled} provider=${scheduleConfig.provider} providerConfigured=${scheduleConfig.providerConfigured} maxSources=${scheduleConfig.maxSources} maxPagesPerRun=${scheduleConfig.maxPagesPerRun} dailyCreditBudget=${scheduleConfig.dailyCreditBudget}`);
  console.log(`Budget estimate: ${enabledFetchable.length} enabled Firecrawl sources, ${Math.min(estimatedPages, scheduleConfig.dailyCreditBudget)} estimated pages/credits this run`);

  table("Hardening controls", [
    { control: "FIRECRAWL_API_KEY configured", value: scheduleConfig.providerConfigured ? "yes" : "no" },
    { control: "MARKET_INTELLIGENCE_CRON_ENABLED", value: scheduleConfig.cronEnabled ? "true" : "false" },
    { control: "MARKET_INTELLIGENCE_LIVE_INGESTION_ENABLED", value: scheduleConfig.liveIngestionEnabled ? "true" : "false" },
    { control: "enabled fetchable source count", value: enabledFetchable.length },
    { control: "estimated pages within daily budget", value: estimatedPages <= scheduleConfig.dailyCreditBudget ? "yes" : "no" },
  ]);
  table("Sources missing allowed domains", registry
    .filter((source) => source.fetchType === "firecrawl_search" || source.fetchType === "firecrawl_scrape")
    .filter((source) => sourceAllowedDomains(source).length === 0)
    .map((source) => ({ id: source.id, name: source.name, fetch: source.fetchType })));
  table("Risky broad fetch configuration", registry
    .filter((source) => source.fetchType === "firecrawl_search")
    .filter((source) => sourceAllowedDomains(source).length === 0 || source.maxResultsPerRun > 25 || source.maxPagesPerRun > 25)
    .map((source) => ({
      id: source.id,
      enabled: source.enabled,
      allowedDomains: sourceAllowedDomains(source).join(", "),
      maxResults: source.maxResultsPerRun,
      maxPages: source.maxPagesPerRun,
    })));
  table("Sources exceeding hardening limits", registry
    .filter((source) => source.maxResultsPerRun > 25 || source.maxPagesPerRun > 25)
    .map((source) => ({ id: source.id, enabled: source.enabled, maxResults: source.maxResultsPerRun, maxPages: source.maxPagesPerRun })));

  table("Source registry summary", registry.map((source) => {
    const policy = validateMarketSourceDefinition(source);
    return {
      id: source.id,
      enabled: source.enabled,
      category: source.sourceCategory,
      trust: source.trustLevel,
      fetch: source.fetchType,
      maxResults: source.maxResultsPerRun,
      maxPages: source.maxPagesPerRun,
      policyOk: policy.ok,
      allowedDomains: sourceAllowedDomains(source).join(", "),
      issues: policy.issues.join("; "),
    };
  }));
  table("Source enabled/disabled counts", [
    { state: "enabled", count: registry.filter((source) => source.enabled).length },
    { state: "disabled", count: registry.filter((source) => !source.enabled).length },
  ]);
  table("Source quality scores", sourceQualityRows.map(({ office, summary }) => ({
    office: office.name,
    sourceId: summary.sourceId,
    score: summary.score,
    band: summary.scoreBand,
    trust: summary.trustLevel,
    enabled: summary.enabled,
    objects: summary.objectCount,
    signals: summary.signalCount,
    useful: summary.usefulFeedbackCount,
    actioned: summary.actionedReviewCount,
    wrongLink: summary.wrongLinkFeedbackCount,
    irrelevant: summary.irrelevantFeedbackCount,
    dismissed: summary.dismissedCount,
    failedRuns: summary.failedRunCount,
    zeroLinkSignals: summary.zeroLinkSignalCount,
  })));
  table("Sources with repeated failures", sourceQualityRows
    .filter(({ summary }) => summary.failedRunCount >= 2)
    .map(({ office, summary }) => ({ office: office.name, sourceId: summary.sourceId, failedRuns: summary.failedRunCount, lastRunAt: summary.lastRunAt?.toISOString() ?? null })));
  table("Sources with high duplicate/wrong/irrelevant feedback", sourceQualityRows
    .filter(({ summary }) => summary.duplicateCount > 0 || summary.wrongLinkFeedbackCount > 0 || summary.irrelevantFeedbackCount > 0)
    .map(({ office, summary }) => ({
      office: office.name,
      sourceId: summary.sourceId,
      duplicate: summary.duplicateCount,
      wrongLink: summary.wrongLinkFeedbackCount,
      irrelevant: summary.irrelevantFeedbackCount,
      score: summary.score,
    })));
  table("Sources producing actioned reviews", sourceQualityRows
    .filter(({ summary }) => summary.actionedReviewCount > 0)
    .map(({ office, summary }) => ({ office: office.name, sourceId: summary.sourceId, actioned: summary.actionedReviewCount, useful: summary.usefulFeedbackCount, score: summary.score })));

  table("MarketSignals by category/severity", [...byCategorySeverity.entries()].sort().map(([categorySeverity, count]) => ({ categorySeverity, count })));
  table("Market research KnowledgeObjects", researchObjectCounts.map((row) => ({
    sourceType: row.sourceType,
    canonicalType: row.canonicalType,
    count: row._count._all,
  })));
  table("MarketIngestionRun counts", ingestionRunCounts.map((row) => ({
    provider: row.provider,
    status: row.status,
    count: row._count._all,
    newest: row._max.createdAt?.toISOString() ?? null,
  })));
  table("Recent failed ingestion runs", failedIngestionRuns.map((run) => ({
    id: run.id,
    provider: run.provider,
    sourceId: run.sourceId,
    query: run.query,
    createdAt: run.createdAt.toISOString(),
    error: run.error?.slice(0, 160) ?? null,
  })));
  table("Signals with zero links", signals.filter((signal) => signal.links.length === 0).slice(0, 50).map((signal) => ({
    id: signal.id,
    category: signal.category,
    severity: signal.severity,
    title: signal.sourceObject?.title ?? signal.summary.slice(0, 80),
  })));
  table("High/critical signals with zero links", signals.filter((signal) => signal.links.length === 0 && ["high", "critical"].includes(signal.severity)).slice(0, 50).map((signal) => ({
    id: signal.id,
    category: signal.category,
    severity: signal.severity,
    title: signal.sourceObject?.title ?? signal.summary.slice(0, 80),
  })));
  table("Market updates skipped for low quality", skippedMarketUpdates.slice(0, 50).map(({ object, extraction }) => ({
    id: object.id,
    title: object.title,
    pageType: extraction.pageType,
    score: extraction.score,
    status: extraction.extractionStatus,
    reason: extraction.reason,
  })));
  table("Market updates classified as index/navigation", indexOrNavigationUpdates.slice(0, 50).map(({ object, extraction }) => ({
    id: object.id,
    title: object.title,
    pageType: extraction.pageType,
    score: extraction.score,
    status: extraction.extractionStatus,
  })));
  table("Suppressed market signals", suppressedSignals.slice(0, 50).map(({ signal, reason, sourceQuality }) => ({
    id: signal.id,
    reason,
    sourceId: sourceQuality?.sourceId ?? null,
    sourceScore: sourceQuality?.score ?? null,
    category: signal.category,
    severity: signal.severity,
    summary: signal.summary.slice(0, 120),
  })));
  table("Signals with majority wrong_link/irrelevant feedback", suppressedSignals
    .filter(({ reason }) => reason === "wrong_link_feedback_majority" || reason === "irrelevant_feedback_majority")
    .slice(0, 50)
    .map(({ signal, reason }) => ({ id: signal.id, reason, summary: signal.summary.slice(0, 120) })));
  table("Social-link lane/entity candidates", socialLaneLinks.slice(0, 50).map((link) => ({
    linkId: link.id,
    signalId: link.signalId,
    entityId: link.entityId,
    matchType: link.matchType,
  })));
  table("Invalid or unknown lane links", invalidLaneLinks.slice(0, 50).map((link) => ({
    linkId: link.id,
    signalId: link.signalId,
    entityId: link.entityId,
    matchType: link.matchType,
    boilerplate: rejectBoilerplateLaneCandidate(link.entityId),
  })));
  table("Boilerplate lane links (audit)", boilerplateLaneLinks.slice(0, 50).map((link) => ({
    linkId: link.id,
    signalId: link.signalId,
    entityId: link.entityId,
    matchType: link.matchType,
  })));
  table("Suppressed signals still appearing in Morning Brief", morningBriefLeaks);
  table("MarketImpactReview counts", [
    { status: "pending", count: pendingReviews },
    ...reviewCounts.filter((row) => row.status !== "pending").map((row) => ({ status: row.status, count: row._count._all })),
  ]);
  table("Links with inactive jobs/RFQs", inactiveLinks.slice(0, 50).map((link) => ({
    linkId: link.id,
    entityType: link.entityType,
    entityId: link.entityId,
    signalId: link.signalId,
  })));
  table("Stale active signals past effectiveTo", staleSignals.map((signal) => ({
    id: signal.id,
    category: signal.category,
    severity: signal.severity,
    effectiveTo: signal.effectiveTo?.toISOString() ?? null,
    summary: signal.summary.slice(0, 100),
  })));
  table("Duplicate signals by source/category/summary", [...duplicates.values()].filter((row) => row.count > 1).map((row) => ({
    sourceObjectId: row.sourceObjectId,
    category: row.category,
    summaryHash: row.summaryHash,
    count: row.count,
    ids: row.ids.join(", "),
  })));
  table("Top sources by useful feedback", [...sourceFeedback.values()].sort((a, b) => b.useful - a.useful).filter((row) => row.useful > 0).slice(0, 20));
  table("Top sources by irrelevant feedback", [...sourceFeedback.values()].sort((a, b) => b.irrelevant - a.irrelevant).filter((row) => row.irrelevant > 0).slice(0, 20));
  table("Top sources by wrong_link feedback", [...sourceFeedback.values()].sort((a, b) => b.wrong_link - a.wrong_link).filter((row) => row.wrong_link > 0).slice(0, 20));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
