import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Icon } from "@/components/icon";
import { IntelligenceIcon } from "@/components/intelligence/intelligence-visual-icons";
import { ManualMarketIngestionControls } from "@/components/intelligence/manual-market-ingestion-controls";
import { WorldIntelligenceMap } from "@/components/intelligence/world-intelligence-map";
import {
  acknowledgeMarketImpactReview,
  dismissMarketImpactReview,
  markMarketImpactActioned,
  recordMarketSignalFeedback,
} from "@/lib/market-intelligence/market-impact-review";
import { getManualMarketIngestionRuntimeStatus, SAFE_MANUAL_MARKET_SOURCE_IDS } from "@/lib/market-intelligence/manual-ingestion";
import { getScheduledMarketAutomationStatus, SAFE_SCHEDULED_MARKET_SOURCE_IDS } from "@/lib/market-intelligence/scheduled-ingestion";
import { getMarketIntelligenceSourceRegistry } from "@/lib/market-intelligence/source-registry";
import { getIntelligenceMapData } from "@/lib/market-intelligence/intelligence-map";
import { normalizeMarketLane } from "@/lib/market-intelligence/lane-validation";
import { shouldShowMarketBrainEmptyState } from "@/lib/market-intelligence/intelligence-page-state";
import {
  buildSourceQualityLookup,
  listSourceQualitySummaries,
  rankMarketImpactReviews,
  rankMarketSignals,
  rankResearchFeedItems,
} from "@/lib/market-intelligence/source-quality";
import { getMarketSignalSuppressionReason } from "@/lib/market-intelligence/signal-suppression";

type SearchParams = Promise<{
  status?: string;
  category?: string;
  severity?: string;
  source?: string;
  sourceCategory?: string;
  q?: string;
}>;

const REVIEW_STATUSES = ["all", "pending", "acknowledged", "dismissed", "actioned", "expired"];
const SIGNAL_CATEGORIES = ["rate", "port_disruption", "customs", "carrier_advisory", "weather", "labor", "geopolitical", "capacity", "compliance"];
const SIGNAL_SEVERITIES = ["all", "low", "medium", "high", "critical"];

function strings(value: Prisma.JsonValue | unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function normalizedLanes(value: Prisma.JsonValue | unknown) {
  return strings(value)
    .map(normalizeMarketLane)
    .filter((lane): lane is string => Boolean(lane))
    .filter((lane, index, array) => array.indexOf(lane) === index);
}

function record(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function timeLabel(value: Date | string | null | undefined) {
  if (!value) return "No timestamp";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function short(value: string | null | undefined, max = 280) {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trim()}...`;
}

function severityClass(value: string) {
  if (value === "critical" || value === "high") return "status-needs-info";
  if (value === "medium") return "status-priced";
  return "status-ingested";
}

function sourceIdFromExternalId(value: string | null | undefined) {
  return value?.match(/^market:([^:]+)/)?.[1] ?? null;
}

function sourceIdForObject(object: {
  sourceExternalId?: string | null;
  payload?: Prisma.JsonValue | null;
  source?: { externalId: string | null; metadata: Prisma.JsonValue | null } | null;
} | null | undefined) {
  const payload = record(object?.payload);
  const metadata = record(object?.source?.metadata);
  return (typeof metadata.sourceId === "string" ? metadata.sourceId : null)
    ?? (typeof payload.sourceId === "string" ? payload.sourceId : null)
    ?? sourceIdFromExternalId(object?.sourceExternalId)
    ?? sourceIdFromExternalId(object?.source?.externalId);
}

function extractionInfo(object: { payload?: Prisma.JsonValue | null } | null | undefined) {
  const payload = record(object?.payload);
  const hygiene = record(payload.contentHygiene);
  return {
    pageType: typeof hygiene.pageType === "string" ? hygiene.pageType : typeof payload.pageType === "string" ? payload.pageType : null,
    status: typeof hygiene.extractionStatus === "string" ? hygiene.extractionStatus : typeof payload.extractionStatus === "string" ? payload.extractionStatus : null,
    score: typeof hygiene.contentQualityScore === "number" ? hygiene.contentQualityScore : typeof payload.contentQualityScore === "number" ? payload.contentQualityScore : null,
    reason: typeof hygiene.rejectionReason === "string" ? hygiene.rejectionReason : typeof payload.extractionRejectionReason === "string" ? payload.extractionRejectionReason : null,
  };
}

function filterHref(overrides: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(overrides)) {
    if (value && value !== "all") params.set(key, value);
  }
  const qs = params.toString();
  return `/dashboard/intelligence${qs ? `?${qs}` : ""}`;
}

async function reviewAction(formData: FormData) {
  "use server";
  const session = await requireSession();
  const reviewId = String(formData.get("review_id") ?? "").trim();
  const action = String(formData.get("action") ?? "").trim();
  if (!reviewId) return;
  if (action === "acknowledge") {
    await acknowledgeMarketImpactReview({ officeId: session.officeId, reviewId, userId: session.userId });
  } else if (action === "actioned") {
    await markMarketImpactActioned({
      officeId: session.officeId,
      reviewId,
      userId: session.userId,
      feedbackNote: String(formData.get("note") ?? "").trim() || undefined,
    });
  } else if (action === "dismiss") {
    await dismissMarketImpactReview({
      officeId: session.officeId,
      reviewId,
      userId: session.userId,
      feedbackKind: String(formData.get("feedback_kind") ?? "irrelevant").trim(),
      feedbackNote: String(formData.get("note") ?? "").trim() || undefined,
    });
  }
  revalidatePath("/dashboard/intelligence");
}

async function feedbackAction(formData: FormData) {
  "use server";
  const session = await requireSession();
  const marketSignalId = String(formData.get("market_signal_id") ?? "").trim();
  const reviewId = String(formData.get("review_id") ?? "").trim();
  const feedbackKind = String(formData.get("feedback_kind") ?? "").trim();
  if (!marketSignalId || !feedbackKind) return;
  await recordMarketSignalFeedback({
    officeId: session.officeId,
    marketSignalId,
    marketImpactReviewId: reviewId || undefined,
    userId: session.userId,
    feedbackKind,
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  revalidatePath("/dashboard/intelligence");
}

export default async function IntelligencePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const sp = await searchParams;
  const status = REVIEW_STATUSES.includes(sp.status ?? "") ? sp.status! : "pending";
  const category = SIGNAL_CATEGORIES.includes(sp.category ?? "") ? sp.category! : "";
  const severity = SIGNAL_SEVERITIES.includes(sp.severity ?? "") ? sp.severity! : "all";
  const sourceFilter = (sp.source ?? "").trim();
  const sourceCategoryFilter = (sp.sourceCategory ?? "").trim();
  const query = (sp.q ?? "").trim();
  const queryTokens = query.toLowerCase().split(/[^a-z0-9]+/i).filter((token) => token.length >= 3).slice(0, 5);
  const registry = getMarketIntelligenceSourceRegistry();
  const sourceCategories = [...new Set(registry.map((source) => source.sourceCategory))].sort();

  const [reviewsRaw, signalsRaw, researchObjectsRaw, runs, sourceQuality, mapData, scheduledStatus] = await Promise.all([
    prisma.marketImpactReview.findMany({
      where: {
        officeId: session.officeId,
        ...(status !== "all" ? { status } : {}),
        ...(category ? { marketSignal: { category } } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        marketSignal: { include: { feedback: true, sourceObject: { include: { source: true } } } },
        marketSignalLink: true,
        feedback: { orderBy: { createdAt: "desc" }, take: 3 },
      },
    }),
    prisma.marketSignal.findMany({
      where: {
        officeId: session.officeId,
        ...(category ? { category } : {}),
        ...(severity !== "all" ? { severity } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        sourceObject: { include: { source: true } },
        links: { take: 30 },
        impactReviews: { take: 30 },
        feedback: { take: 30 },
      },
    }),
    prisma.knowledgeObject.findMany({
      where: {
        officeId: session.officeId,
        sourceType: "MARKET",
        canonicalType: "market_update",
        ...(queryTokens.length ? {
          OR: queryTokens.flatMap((token) => [
            { title: { contains: token, mode: "insensitive" as const } },
            { sourceExternalId: { contains: token, mode: "insensitive" as const } },
            { rawRef: { contains: token, mode: "insensitive" as const } },
          ]),
        } : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: {
        source: true,
        chunks: { orderBy: { ordinal: "asc" }, take: 1 },
        marketSignals: {
          include: {
            links: { take: 30 },
            impactReviews: { take: 30 },
          },
        },
      },
    }),
    prisma.marketIngestionRun.findMany({
      where: { officeId: session.officeId },
      orderBy: [{ createdAt: "desc" }],
      take: 12,
    }).catch(() => []),
    listSourceQualitySummaries({ officeId: session.officeId }),
    getIntelligenceMapData(session.officeId),
    getScheduledMarketAutomationStatus(session.officeId),
  ]);

  const qualityLookup = buildSourceQualityLookup(sourceQuality);
  const sourceMetaById = new Map(registry.map((source) => [source.id, source]));
  const sourceQualityById = new Map(sourceQuality.map((quality) => [quality.sourceId, quality]));
  const sourceFilterMatches = (sourceId: string | null | undefined) => {
    if (sourceFilter && sourceId !== sourceFilter) return false;
    const source = sourceId ? sourceMetaById.get(sourceId) : null;
    if (sourceCategoryFilter && source?.sourceCategory !== sourceCategoryFilter) return false;
    return true;
  };
  const reviews = rankMarketImpactReviews(
    reviewsRaw.filter((review) => sourceFilterMatches(sourceIdForObject(review.marketSignal.sourceObject))),
    qualityLookup,
  ).slice(0, 40);
  const signals = rankMarketSignals(
    signalsRaw.filter((signal) => sourceFilterMatches(sourceIdForObject(signal.sourceObject))),
    qualityLookup,
  ).slice(0, 30);
  const researchObjects = rankResearchFeedItems(
    researchObjectsRaw.filter((object) => sourceFilterMatches(sourceIdForObject(object))),
    qualityLookup,
  ).slice(0, 30);
  const enabledSourceCount = registry.filter((source) => source.enabled).length;
  const disabledSourceCount = registry.length - enabledSourceCount;
  const runtimeStatus = getManualMarketIngestionRuntimeStatus();
  const totalSignals = Object.values(mapData.metrics.signalsBySeverity).reduce((sum, count) => sum + count, 0);
  const affectedWork = mapData.metrics.affectedCustomers + mapData.metrics.affectedJobs + mapData.metrics.affectedRfqs;
  const hasNoMarketData = shouldShowMarketBrainEmptyState({
    researchItems: researchObjectsRaw.length,
    marketSignals: signalsRaw.length,
    impactReviews: reviewsRaw.length,
  });
  const safeManualSources = registry
    .filter((source) => SAFE_MANUAL_MARKET_SOURCE_IDS.includes(source.id as typeof SAFE_MANUAL_MARKET_SOURCE_IDS[number]))
    .filter((source) => source.fetchType === "firecrawl_search" || source.fetchType === "firecrawl_scrape")
    .map((source) => ({
      id: source.id,
      name: source.name,
      sourceCategory: source.sourceCategory,
      trustLevel: source.trustLevel,
      allowedDomains: source.allowedDomains,
    }));

  return (
    <div className="intelligence-page">
      <div className="page-header">
        <div>
          <div className="page-title-row">
            <Icon name="activity" size={20} />
            <h1 className="page-title">Intelligence</h1>
          </div>
          <p className="page-subtitle">
            Source-backed freight research, ranked market signals, and human impact review. Advisory only.
          </p>
        </div>
        <div className="page-actions">
          <a className="btn btn-secondary" href="/dashboard/intelligence">Reset</a>
        </div>
      </div>

      <div className="stat-grid intelligence-stats">
        <div className="stat-card">
          <div className="stat-label">24h Research</div>
          <div className="stat-value">{mapData.metrics.researchItems24h}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">7d Research</div>
          <div className="stat-value">{mapData.metrics.researchItems7d}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">MarketSignals</div>
          <div className="stat-value">{totalSignals}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pending Reviews</div>
          <div className="stat-value">{mapData.metrics.pendingImpactReviews}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Affected Work</div>
          <div className="stat-value">{affectedWork}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Source Quality Avg</div>
          <div className="stat-value">{mapData.metrics.sourceQualityAverage ?? "n/a"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Suppressed Signals</div>
          <div className="stat-value">{mapData.metrics.suppressedSignals}</div>
        </div>
      </div>

      <WorldIntelligenceMap data={mapData} />

      <section className="workbench-section intelligence-section">
        <div className="workbench-card-header">
          <div>
            <h2>Daily Market Automation</h2>
            <p>Hobby-compatible daily cron at 11:00 UTC. Advisory-only; it never mutates jobs, RFQs, quotes, prices, customers, milestones, or messages.</p>
          </div>
          <span className={["pricing-status", scheduledStatus.config.cronEnabled ? "status-priced" : "status-needs-info"].join(" ")}>
            {scheduledStatus.config.cronEnabled ? "enabled" : "disabled"}
          </span>
        </div>
        <div className="intelligence-run-grid">
          <div className="intelligence-run">
            <strong>Schedule</strong>
            <span>0 11 * * * / daily 11:00 UTC</span>
            <span className="muted">Vercel Hobby-safe: at most once per day.</span>
          </div>
          <div className="intelligence-run">
            <strong>Runtime limits</strong>
            <span>{scheduledStatus.config.maxSources} source/day · {scheduledStatus.config.maxPagesPerRun} pages/source</span>
            <span className="muted">Daily credit budget {scheduledStatus.config.dailyCreditBudget}; provider {scheduledStatus.config.providerConfigured ? "configured" : "missing"}; live ingestion {scheduledStatus.config.liveIngestionEnabled ? "enabled" : "disabled"}.</span>
          </div>
          <div className="intelligence-run">
            <strong>Safe rotation</strong>
            <span>{scheduledStatus.safeSources.map((source) => source.name).join(" → ")}</span>
            <span className="muted">Media/broad sources are excluded from cron.</span>
          </div>
          <div className="intelligence-run">
            <strong>Next / last</strong>
            <span>Next: {scheduledStatus.nextRecommendedSource?.name ?? "No safe source currently eligible"}</span>
            <span className="muted">
              Last: {scheduledStatus.lastRun ? `${scheduledStatus.lastRun.sourceId} · ${scheduledStatus.lastRun.status} · ${timeLabel(scheduledStatus.lastRun.createdAt)}` : "No scheduled run yet"}
            </span>
          </div>
        </div>
        <p className="muted">
          MARKET_INTELLIGENCE_CRON_ENABLED must be true before cron runs live. Current page only exposes status and safe rotation.
          Safe source ids: {SAFE_SCHEDULED_MARKET_SOURCE_IDS.join(", ")}.
        </p>
      </section>

      <form className="filter-bar" action="/dashboard/intelligence">
        <input name="q" defaultValue={query} placeholder="Search research feed" />
        <select name="status" defaultValue={status}>
          {REVIEW_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select name="category" defaultValue={category}>
          <option value="">All signal categories</option>
          {SIGNAL_CATEGORIES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select name="severity" defaultValue={severity}>
          {SIGNAL_SEVERITIES.map((value) => <option key={value} value={value}>{value === "all" ? "All severities" : value}</option>)}
        </select>
        <select name="sourceCategory" defaultValue={sourceCategoryFilter}>
          <option value="">All source categories</option>
          {sourceCategories.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select name="source" defaultValue={sourceFilter}>
          <option value="">All sources</option>
          {registry.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
        <button className="btn btn-secondary" type="submit">Filter</button>
      </form>

      <section className="workbench-section intelligence-section">
        <div className="workbench-card-header">
          <div>
            <h2>Source Health</h2>
            <p>Registry policy, deterministic quality score, and safe manual Firecrawl controls. Disabled means not scheduled.</p>
          </div>
          <span className="muted">{enabledSourceCount} enabled / {disabledSourceCount} disabled</span>
        </div>
        <ManualMarketIngestionControls
          sources={safeManualSources}
          isAdmin={session.role === "ADMIN"}
          isEmpty={hasNoMarketData}
          runtimeStatus={runtimeStatus}
        />
        <div className="intelligence-run-grid">
          {sourceQuality.map((quality) => {
            return (
              <div key={quality.sourceId} className="intelligence-run">
                <div className="intelligence-row-top">
                  <span className={["pricing-status", quality.scoreBand === "poor" ? "status-needs-info" : quality.scoreBand === "watch" ? "status-priced" : "status-ingested"].join(" ")}>
                    {quality.score} {quality.scoreBand}
                  </span>
                  <span className="muted">{quality.enabled ? "enabled" : "disabled"}</span>
                  <span className="muted">{quality.trustLevel}</span>
                </div>
                <strong>{quality.name}</strong>
                <span className="muted">{quality.sourceCategory} / {quality.fetchType}</span>
                <span>{quality.objectCount} objects / {quality.signalCount} signals / {quality.actionedReviewCount} actioned</span>
                <span className="muted">{quality.failedRunCount} failed runs / {quality.wrongLinkFeedbackCount} wrong links / {quality.irrelevantFeedbackCount} irrelevant</span>
                <div className="intelligence-actions">
                  <a className="btn btn-secondary btn-sm" href={filterHref({ status, category, severity, sourceCategory: sourceCategoryFilter, q: query, source: quality.sourceId })}>Filter</a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="workbench-section intelligence-section">
        <div className="workbench-card-header">
          <div>
            <h2>Impact Reviews</h2>
            <p>Ranked by pending status, impact, signal severity, source quality, business linkage, and recency.</p>
          </div>
          <a className="btn btn-secondary btn-sm" href={filterHref({ status: "pending", category, severity, sourceCategory: sourceCategoryFilter, source: sourceFilter, q: query })}>Pending</a>
        </div>
        <div className="intelligence-list">
          {reviews.length === 0 ? (
            <div className="empty-state-inline">No reviews match this filter.</div>
          ) : reviews.map((review) => {
            const sourceId = sourceIdForObject(review.marketSignal.sourceObject);
            const quality = sourceId ? sourceQualityById.get(sourceId) : null;
            const suppressionReason = getMarketSignalSuppressionReason({
              signal: {
                ...review.marketSignal,
                impactReviews: [review],
                links: review.marketSignalLink ? [review.marketSignalLink] : [],
              },
              sourceQuality: quality,
              requirePendingReview: true,
            });
            return (
              <article key={review.id} className="intelligence-row">
                <div className="intelligence-row-main">
                  <div className="intelligence-row-top">
                    <span className={["pricing-status", severityClass(review.impactLevel)].join(" ")}>
                      {review.impactLevel}
                    </span>
                    <span className="muted">{review.status}</span>
                    {suppressionReason && <span className="muted">suppressed: {suppressionReason}</span>}
                    <span className="muted">{review.linkedEntityType}:{review.linkedEntityId}</span>
                    {quality && <span className="muted">{quality.name} score {quality.score}</span>}
                    <span className="muted">{timeLabel(review.createdAt)}</span>
                  </div>
                  <h3 className="intelligence-title-with-icon"><IntelligenceIcon type={review.marketSignal.category} /> {review.marketSignal.summary}</h3>
                  <p>{short(review.impactReason, 360)}</p>
                  {review.recommendedAction && <p><strong>Action:</strong> {review.recommendedAction}</p>}
                  <div className="intelligence-evidence">
                    <span>Signal {review.marketSignal.id}</span>
                    {review.marketSignal.sourceObject && <span>Source {review.marketSignal.sourceObject.id}</span>}
                    {sourceId && <span>{sourceId}</span>}
                    {review.marketSignalLink && <span>{review.marketSignalLink.matchType} {Math.round(review.marketSignalLink.confidence * 100)}%</span>}
                  </div>
                </div>
                <div className="intelligence-actions">
                  <form action={reviewAction}>
                    <input type="hidden" name="review_id" value={review.id} />
                    <input type="hidden" name="action" value="acknowledge" />
                    <button className="btn btn-secondary btn-sm" type="submit">Ack</button>
                  </form>
                  <form action={reviewAction}>
                    <input type="hidden" name="review_id" value={review.id} />
                    <input type="hidden" name="action" value="actioned" />
                    <button className="btn btn-sm" type="submit">Actioned</button>
                  </form>
                  <form action={reviewAction}>
                    <input type="hidden" name="review_id" value={review.id} />
                    <input type="hidden" name="action" value="dismiss" />
                    <input type="hidden" name="feedback_kind" value="irrelevant" />
                    <button className="btn btn-secondary btn-sm" type="submit">Dismiss</button>
                  </form>
                  <form action={feedbackAction}>
                    <input type="hidden" name="review_id" value={review.id} />
                    <input type="hidden" name="market_signal_id" value={review.marketSignalId} />
                    <input type="hidden" name="feedback_kind" value="wrong_link" />
                    <button className="btn btn-secondary btn-sm" type="submit">Wrong link</button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="workbench-section intelligence-section">
        <div className="workbench-card-header">
          <div>
            <h2>Research Feed</h2>
            <p>Ranked raw source objects before they become operational claims.</p>
          </div>
        </div>
        <div className="intelligence-list">
          {researchObjects.length === 0 ? (
            <div className="empty-state-inline">No market research objects yet.</div>
          ) : researchObjects.map((object) => {
            const sourceMetadata = record(object.source?.metadata);
            const sourceId = sourceIdForObject(object);
            const sourceMeta = sourceMetaById.get(sourceId ?? "");
            const quality = qualityLookup.bySourceObjectId.get(object.id);
            const extraction = extractionInfo(object);
            return (
              <article key={object.id} className="intelligence-row">
                <div className="intelligence-row-main">
                  <div className="intelligence-row-top">
                    <span className="pricing-status status-ingested">{object.canonicalType}</span>
                    <span className="muted">{object.source?.label ?? object.source?.type ?? "Market source"}</span>
                    {sourceId && <span className="muted">{sourceId}</span>}
                    {sourceMeta && <span className="muted">{sourceMeta.sourceCategory}</span>}
                    {typeof sourceMetadata.trustLevel === "string" && <span className="muted">Trust {sourceMetadata.trustLevel}</span>}
                    {quality && <span className="muted">Quality {quality.score}</span>}
                    {extraction.status && <span className="muted">{extraction.status}</span>}
                    {extraction.pageType && <span className="muted">{extraction.pageType}</span>}
                    {typeof extraction.score === "number" && <span className="muted">Content {extraction.score}</span>}
                    <span className="muted">{timeLabel(object.occurredAt)}</span>
                  </div>
                  <h3 className="intelligence-title-with-icon"><IntelligenceIcon type={sourceMeta?.sourceCategory ?? "market"} /> {object.title ?? object.sourceExternalId}</h3>
                  <p>{short(object.chunks[0]?.text ?? object.sourceExternalId, 420)}</p>
                  {extraction.reason && <p><strong>Extraction skipped:</strong> {extraction.reason}</p>}
                  {sourceMeta?.sourceCategory === "regulatory" && (
                    <p><strong>Modeling:</strong> CBP/regulatory items are treated as customs/compliance context unless the clean body contains a validated freight lane.</p>
                  )}
                  <div className="intelligence-evidence">
                    <span>KnowledgeObject {object.id}</span>
                    <span>{object.marketSignals.length} signals</span>
                    <span>{object.marketSignals.reduce((sum, signal) => sum + signal.impactReviews.filter((review) => review.status === "pending").length, 0)} pending reviews</span>
                    {quality && <span>{quality.actionedReviewCount} actioned / {quality.dismissedCount} dismissed</span>}
                  </div>
                </div>
                <div className="intelligence-actions">
                  {object.rawRef && (
                    <a className="btn btn-secondary btn-sm" href={object.rawRef} target="_blank" rel="noreferrer">
                      Source <Icon name="external" />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="workbench-section intelligence-section">
        <div className="workbench-card-header">
          <div>
            <h2>Market Signals</h2>
            <p>Ranked operational interpretations. Still advisory until reviewed.</p>
          </div>
        </div>
        <div className="intelligence-list">
          {signals.length === 0 ? (
            <div className="empty-state-inline">No market signals yet.</div>
          ) : signals.map((signal) => {
            const sourceId = sourceIdForObject(signal.sourceObject);
            const quality = signal.sourceObjectId ? qualityLookup.bySourceObjectId.get(signal.sourceObjectId) : null;
            const validLanes = normalizedLanes(signal.affectedLanes);
            const suppressionReason = getMarketSignalSuppressionReason({
              signal,
              sourceQuality: quality,
              requirePendingReview: true,
            });
            return (
              <article key={signal.id} className="intelligence-row">
                <div className="intelligence-row-main">
                  <div className="intelligence-row-top">
                    <span className={["pricing-status", severityClass(signal.severity)].join(" ")}>
                      {signal.category} / {signal.severity}
                    </span>
                    {suppressionReason && <span className="pricing-status status-needs-info">suppressed</span>}
                    <span className="muted">{Math.round(signal.confidence * 100)}% confidence</span>
                    {quality && <span className="muted">{quality.name} score {quality.score}</span>}
                    {suppressionReason && <span className="muted">{suppressionReason}</span>}
                    <span className="muted">{timeLabel(signal.createdAt)}</span>
                  </div>
                  <h3 className="intelligence-title-with-icon"><IntelligenceIcon type={signal.category} /> {signal.summary}</h3>
                  {signal.operatorImplication && <p><strong>Ops:</strong> {signal.operatorImplication}</p>}
                  {signal.pricingImplication && <p><strong>Pricing:</strong> {signal.pricingImplication}</p>}
                  <div className="intelligence-evidence">
                    {strings(signal.affectedModes).slice(0, 4).map((mode) => <span key={mode}>{mode}</span>)}
                    {validLanes.slice(0, 4).map((lane) => <span key={lane}>{lane}</span>)}
                    {(signal.category === "customs" || signal.category === "compliance") && validLanes.length === 0 && (
                      <span>No valid freight lane detected; treated as U.S. customs/compliance context.</span>
                    )}
                    <span>{signal.links.length} links</span>
                    <span>{signal.impactReviews.filter((review) => review.status === "pending").length} pending reviews</span>
                    {sourceId && <span>{sourceId}</span>}
                    {signal.sourceObject && <span>Source {signal.sourceObject.id}</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="workbench-section intelligence-section">
        <div className="workbench-card-header">
          <div>
            <h2>Ingestion Runs</h2>
            <p>Connector observability. Errors live here instead of disappearing into logs.</p>
          </div>
        </div>
        <div className="intelligence-run-grid">
          {runs.length === 0 ? (
            <div className="empty-state-inline">No ingestion runs recorded.</div>
          ) : runs.map((run) => (
            <div key={run.id} className="intelligence-run">
              <div className="intelligence-row-top">
                <span className="pricing-status status-parsed">{run.provider}</span>
                <span className="muted">{run.status}</span>
              </div>
              <strong>{run.sourceId ?? "unknown source"}</strong>
              <span className="muted">{run.query ?? "direct source"}</span>
              <span className="muted">{timeLabel(run.createdAt)}</span>
              <span>{run.objectCount} objects / {run.signalCount} signals / {run.reviewCount} reviews</span>
              {run.error && <span className="muted">{short(run.error, 160)}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
