import type { Prisma } from "@prisma/client";
import { SIGNAL_ELIGIBLE_PAGE_TYPES, type MarketContentPageType } from "./content-hygiene";

type SourceQualityLike = {
  score?: number | null;
  scoreBand?: string | null;
} | null | undefined;

type ReviewLike = {
  status: string;
  feedbackKind?: string | null;
};

type FeedbackLike = {
  feedbackKind: string;
};

type SourceObjectLike = {
  payload?: Prisma.JsonValue | null;
  title?: string | null;
  sourceExternalId?: string | null;
} | null | undefined;

export type MarketSignalSuppressionInput = {
  id?: string | null;
  sourceObjectId?: string | null;
  sourceObject?: SourceObjectLike;
  impactReviews?: ReviewLike[];
  feedback?: FeedbackLike[];
  links?: unknown[];
};

function asRecord(value: Prisma.JsonValue | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function pageTypeFromPayload(sourceObject: SourceObjectLike): MarketContentPageType | null {
  const payload = asRecord(sourceObject?.payload);
  const hygiene = asRecord(payload.contentHygiene);
  const value = typeof hygiene.pageType === "string" ? hygiene.pageType : typeof payload.pageType === "string" ? payload.pageType : null;
  return value as MarketContentPageType | null;
}

function extractionStatus(sourceObject: SourceObjectLike) {
  const payload = asRecord(sourceObject?.payload);
  const hygiene = asRecord(payload.contentHygiene);
  return typeof hygiene.extractionStatus === "string"
    ? hygiene.extractionStatus
    : typeof payload.extractionStatus === "string"
      ? payload.extractionStatus
      : null;
}

function contentQualityScore(sourceObject: SourceObjectLike) {
  const payload = asRecord(sourceObject?.payload);
  const hygiene = asRecord(payload.contentHygiene);
  const raw = typeof hygiene.contentQualityScore === "number"
    ? hygiene.contentQualityScore
    : typeof payload.contentQualityScore === "number"
      ? payload.contentQualityScore
      : null;
  return raw;
}

function rejectionReasons(sourceObject: SourceObjectLike) {
  const payload = asRecord(sourceObject?.payload);
  const hygiene = asRecord(payload.contentHygiene);
  return [
    typeof payload.extractionRejectionReason === "string" ? payload.extractionRejectionReason : null,
    typeof hygiene.rejectionReason === "string" ? hygiene.rejectionReason : null,
    ...strings(payload.extractionRejectionReasons),
    ...strings(hygiene.reasons),
  ].filter((item): item is string => Boolean(item));
}

function reviewStats(reviews: ReviewLike[] | null | undefined) {
  const rows = reviews ?? [];
  const active = rows.filter((review) => review.status === "pending" || review.status === "acknowledged").length;
  const dismissed = rows.filter((review) => review.status === "dismissed").length;
  const closed = rows.filter((review) => ["dismissed", "actioned", "expired"].includes(review.status)).length;
  const irrelevant = rows.filter((review) => review.feedbackKind === "irrelevant").length;
  const wrongLink = rows.filter((review) => review.feedbackKind === "wrong_link").length;
  return { total: rows.length, active, dismissed, closed, irrelevant, wrongLink };
}

function feedbackStats(feedback: FeedbackLike[] | null | undefined, reviews: ReviewLike[] | null | undefined) {
  const rows = [
    ...(feedback ?? []).map((item) => item.feedbackKind),
    ...(reviews ?? []).map((item) => item.feedbackKind).filter((item): item is string => Boolean(item)),
  ];
  const irrelevant = rows.filter((kind) => kind === "irrelevant").length;
  const wrongLink = rows.filter((kind) => kind === "wrong_link").length;
  const negative = irrelevant + wrongLink;
  return { total: rows.length, irrelevant, wrongLink, negative };
}

export function getMarketSignalSuppressionReason(input: {
  signal: MarketSignalSuppressionInput;
  sourceQuality?: SourceQualityLike;
  requirePendingReview?: boolean;
}) {
  const sourceQuality = input.sourceQuality;
  if (sourceQuality?.scoreBand === "poor" || (typeof sourceQuality?.score === "number" && sourceQuality.score < 50)) {
    return "source_quality_poor";
  }

  const pageType = pageTypeFromPayload(input.signal.sourceObject);
  if (pageType && !SIGNAL_ELIGIBLE_PAGE_TYPES.includes(pageType)) return `source_page_type_${pageType}`;

  const status = extractionStatus(input.signal.sourceObject);
  if (status && status !== "signal_eligible") return status;

  const score = contentQualityScore(input.signal.sourceObject);
  if (typeof score === "number" && score < 60) return "content_quality_below_60";

  const reasons = rejectionReasons(input.signal.sourceObject);
  if (reasons.length > 0) return reasons[0];

  const reviews = reviewStats(input.signal.impactReviews);
  if (reviews.total > 0 && reviews.active === 0 && reviews.closed === reviews.total) {
    return "all_impact_reviews_closed";
  }
  if (input.requirePendingReview && reviews.active === 0) return "no_pending_or_acknowledged_review";

  const feedback = feedbackStats(input.signal.feedback, input.signal.impactReviews);
  if (feedback.total > 0 && feedback.negative / feedback.total >= 0.5) {
    return feedback.wrongLink >= feedback.irrelevant ? "wrong_link_feedback_majority" : "irrelevant_feedback_majority";
  }

  const linkCount = input.signal.links?.length ?? null;
  if (linkCount === 0 && input.requirePendingReview) return "zero_valid_links";

  return null;
}

export function shouldSuppressMarketSignal(input: {
  signal: MarketSignalSuppressionInput;
  sourceQuality?: SourceQualityLike;
  requirePendingReview?: boolean;
}) {
  return Boolean(getMarketSignalSuppressionReason(input));
}

export function shouldShowMarketSignalInMorningBrief(input: {
  signal: MarketSignalSuppressionInput;
  sourceQuality?: SourceQualityLike;
}) {
  return !shouldSuppressMarketSignal({ ...input, requirePendingReview: true });
}

export function shouldUseMarketSignalInStrategyContext(input: {
  signal: MarketSignalSuppressionInput;
  sourceQuality?: SourceQualityLike;
}) {
  return !shouldSuppressMarketSignal({ ...input, requirePendingReview: true });
}
