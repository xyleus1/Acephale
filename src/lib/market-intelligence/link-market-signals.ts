import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildSourceQualityLookup, listSourceQualitySummaries } from "./source-quality";
import { shouldUseMarketSignalInStrategyContext } from "./signal-suppression";
import {
  detectKnownMarketLocations,
  isValidMarketLane,
  normalizeMarketLane,
  parseMarketLane,
} from "./lane-validation";

export type SignalImpact = {
  entityType: "company" | "job" | "inquiry" | "lane" | "country" | "chokepoint";
  entityId: string;
  matchType: string;
  confidence: number;
  reason: string;
};

type SignalShape = {
  id: string;
  officeId: string;
  category: string;
  severity: string;
  confidence: number;
  affectedModes: Prisma.JsonValue;
  affectedOrigins: Prisma.JsonValue;
  affectedDestinations: Prisma.JsonValue;
  affectedPorts: Prisma.JsonValue;
  affectedLanes: Prisma.JsonValue;
  affectedCarriers: Prisma.JsonValue;
  summary: string;
};

function strings(value: Prisma.JsonValue | unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function norm(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMode(value: string | null | undefined) {
  const mode = norm(value);
  if (!mode) return "";
  if (mode.includes("sea") || mode.includes("ocean") || mode.includes("fcl") || mode.includes("lcl")) return "ocean";
  if (mode.includes("air")) return "air";
  if (mode.includes("road") || mode.includes("truck")) return "road";
  if (mode.includes("rail")) return "rail";
  if (mode.includes("courier")) return "courier";
  return mode;
}

function locationTokens(value: string | null | undefined) {
  const tokens = new Set(norm(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 2));
  for (const location of detectKnownMarketLocations(value ?? "")) {
    tokens.add(location.label.toLowerCase());
    for (const alias of location.aliases) tokens.add(alias.toLowerCase());
  }
  return tokens;
}

function locationMatches(signalValues: string[], routeValue: string | null | undefined) {
  if (signalValues.length === 0 || !routeValue) return false;
  const routeTokens = locationTokens(routeValue);
  return signalValues.some((signalValue) => {
    const signalTokens = locationTokens(signalValue);
    for (const token of signalTokens) {
      if (routeTokens.has(token)) return true;
    }
    return false;
  });
}

function normalizedLanes(value: Prisma.JsonValue | unknown) {
  return strings(value)
    .map(normalizeMarketLane)
    .filter((lane): lane is string => Boolean(lane))
    .filter((lane, index, array) => array.indexOf(lane) === index);
}

function laneMatches(signalLanes: string[], origin: string | null | undefined, destination: string | null | undefined) {
  if (signalLanes.length === 0 || (!origin && !destination)) return false;
  const originTokens = locationTokens(origin);
  const destinationTokens = locationTokens(destination);
  return signalLanes.some((lane) => {
    const parsed = parseMarketLane(lane);
    if (!parsed) return false;
    const left = locationTokens(parsed.from.label);
    const right = locationTokens(parsed.to.label);
    const leftMatches = [...left].some((token) => originTokens.has(token));
    const rightMatches = [...right].some((token) => destinationTokens.has(token));
    return leftMatches && rightMatches;
  });
}

export function scoreSignalAgainstLane(signal: SignalShape, target: {
  mode?: string | null;
  origin?: string | null;
  destination?: string | null;
  carrierText?: string | null;
}) {
  const affectedModes = strings(signal.affectedModes).map(normalizeMode);
  const affectedOrigins = strings(signal.affectedOrigins);
  const affectedDestinations = strings(signal.affectedDestinations);
  const affectedPorts = strings(signal.affectedPorts);
  const affectedLanes = normalizedLanes(signal.affectedLanes);
  const affectedCarriers = strings(signal.affectedCarriers);

  let score = 0;
  const reasons: string[] = [];
  const targetMode = normalizeMode(target.mode);
  if (affectedModes.length > 0 && targetMode && affectedModes.includes(targetMode)) {
    score += 0.22;
    reasons.push(`mode:${targetMode}`);
  }
  if (locationMatches([...affectedOrigins, ...affectedPorts], target.origin)) {
    score += 0.28;
    reasons.push(`origin:${target.origin}`);
  }
  if (locationMatches([...affectedDestinations, ...affectedPorts], target.destination)) {
    score += 0.28;
    reasons.push(`destination:${target.destination}`);
  }
  if (laneMatches(affectedLanes, target.origin, target.destination)) {
    score += 0.35;
    reasons.push("lane");
  }
  const carrierText = norm(target.carrierText);
  if (carrierText && affectedCarriers.some((carrier) => carrierText.includes(norm(carrier)))) {
    score += 0.12;
    reasons.push("carrier");
  }

  return {
    matched: score >= 0.45 || (reasons.includes("lane") && score >= 0.35),
    confidence: Number(Math.min(0.95, signal.confidence * Math.max(0.45, score)).toFixed(2)),
    matchType: reasons.includes("lane") ? "lane" : reasons.join("+") || "none",
    reason: reasons.length ? `Matched ${reasons.join(", ")} against market signal "${signal.summary}".` : "No conservative match.",
  };
}

async function upsertLink(args: {
  officeId: string;
  signalId: string;
  impact: SignalImpact;
}) {
  return prisma.marketSignalLink.upsert({
    where: {
      signalId_entityType_entityId: {
        signalId: args.signalId,
        entityType: args.impact.entityType,
        entityId: args.impact.entityId,
      },
    },
    update: {
      matchType: args.impact.matchType,
      confidence: args.impact.confidence,
      reason: args.impact.reason,
    },
    create: {
      officeId: args.officeId,
      signalId: args.signalId,
      entityType: args.impact.entityType,
      entityId: args.impact.entityId,
      matchType: args.impact.matchType,
      confidence: args.impact.confidence,
      reason: args.impact.reason,
    },
  });
}

export async function linkMarketSignalToBusinessObjects(input: {
  officeId: string;
  signalId: string;
  strict?: boolean;
}) {
  try {
    const signal = await prisma.marketSignal.findFirst({
      where: { id: input.signalId, officeId: input.officeId },
    });
    if (!signal) return [];
    const affectedLanes = normalizedLanes(signal.affectedLanes);
    const isCustomsOrCompliance = signal.category === "customs" || signal.category === "compliance";
    const isRegulatoryContextOnly = isCustomsOrCompliance && affectedLanes.length === 0;

    const [jobs, inquiries] = await Promise.all([
      prisma.job.findMany({
        where: { officeId: input.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
        select: {
          id: true, companyId: true, reference: true, origin: true, destination: true, mode: true,
          inquiry: { select: { carrierQuotes: { select: { carrier: true } } } },
        },
        take: 250,
      }),
      prisma.inquiry.findMany({
        where: { officeId: input.officeId, status: { in: ["INGESTED", "PARSED", "PRICED", "QUOTED"] } },
        select: {
          id: true, companyId: true, subject: true, origin: true, destination: true, mode: true,
          carrierQuotes: { select: { carrier: true } },
        },
        take: 250,
      }),
    ]);

    const impacts: SignalImpact[] = [];
    const companyConfidence = new Map<string, SignalImpact>();
    const addCompany = (companyId: string | null | undefined, confidence: number, reason: string) => {
      if (!companyId) return;
      const existing = companyConfidence.get(companyId);
      if (!existing || confidence > existing.confidence) {
        companyConfidence.set(companyId, {
          entityType: "company",
          entityId: companyId,
          matchType: "derived_from_active_work",
          confidence,
          reason,
        });
      }
    };

    if (!isRegulatoryContextOnly) {
      for (const job of jobs) {
        const carrierText = job.inquiry?.carrierQuotes.map((quote) => quote.carrier).join(" ") ?? "";
        const match = scoreSignalAgainstLane(signal, { mode: job.mode, origin: job.origin, destination: job.destination, carrierText });
        if (!match.matched) continue;
        impacts.push({
          entityType: "job",
          entityId: job.id,
          matchType: match.matchType,
          confidence: match.confidence,
          reason: `${match.reason} Job ${job.reference}.`,
        });
        addCompany(job.companyId, match.confidence, `Company has active job ${job.reference} affected by signal.`);
      }

      for (const inquiry of inquiries) {
        const carrierText = inquiry.carrierQuotes.map((quote) => quote.carrier).join(" ");
        const match = scoreSignalAgainstLane(signal, { mode: inquiry.mode, origin: inquiry.origin, destination: inquiry.destination, carrierText });
        if (!match.matched) continue;
        impacts.push({
          entityType: "inquiry",
          entityId: inquiry.id,
          matchType: match.matchType,
          confidence: match.confidence,
          reason: `${match.reason} RFQ "${inquiry.subject}".`,
        });
        addCompany(inquiry.companyId, match.confidence, `Company has active RFQ "${inquiry.subject}" affected by signal.`);
      }
    }

    impacts.push(...companyConfidence.values());
    for (const lane of affectedLanes) {
      if (!isValidMarketLane(lane)) continue;
      impacts.push({
        entityType: "lane",
        entityId: lane,
        matchType: "signal_lane",
        confidence: signal.confidence,
        reason: `Lane named by market signal: ${lane}.`,
      });
    }
    if (isRegulatoryContextOnly && strings(signal.affectedDestinations).some((destination) => destination === "US" || destination === "United States")) {
      impacts.push({
        entityType: "country",
        entityId: "US",
        matchType: "source_country_compliance",
        confidence: Math.max(0.55, Math.min(0.9, signal.confidence)),
        reason: "Regulatory source treated as U.S. customs/compliance context; no validated freight lane was detected.",
      });
    }

    const unique = new Map<string, SignalImpact>();
    for (const impact of impacts) {
      const key = `${impact.entityType}:${impact.entityId}`;
      const existing = unique.get(key);
      if (!existing || impact.confidence > existing.confidence) unique.set(key, impact);
    }

    const written = [];
    for (const impact of unique.values()) {
      written.push(await upsertLink({ officeId: input.officeId, signalId: signal.id, impact }));
    }
    return written;
  } catch (error) {
    if (input.strict) throw error;
    return [];
  }
}

export async function getMarketSignalsForStrategyContext(input: {
  officeId: string;
  jobId?: string | null;
  inquiryId?: string | null;
  companyId?: string | null;
  limit?: number;
}) {
  const entityFilters = [
    input.jobId ? { entityType: "job", entityId: input.jobId } : null,
    input.inquiryId ? { entityType: "inquiry", entityId: input.inquiryId } : null,
    input.companyId ? { entityType: "company", entityId: input.companyId } : null,
  ].filter((item): item is { entityType: string; entityId: string } => Boolean(item));
  if (entityFilters.length === 0) return [];

  const [links, sourceQuality] = await Promise.all([
    prisma.marketSignalLink.findMany({
    where: { officeId: input.officeId, OR: entityFilters },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(20, input.limit ?? 5)),
    include: {
      signal: {
        include: {
          links: true,
          impactReviews: { select: { status: true, feedbackKind: true } },
          feedback: { select: { feedbackKind: true } },
          sourceObject: { select: { id: true, title: true, sourceExternalId: true, payload: true } },
        },
      },
    },
  }).catch(() => []),
    listSourceQualitySummaries({ officeId: input.officeId }).catch(() => []),
  ]);
  const sourceQualityLookup = buildSourceQualityLookup(sourceQuality);

  return links.filter((link) => shouldUseMarketSignalInStrategyContext({
    signal: link.signal,
    sourceQuality: sourceQualityLookup.bySourceObjectId.get(link.signal.sourceObjectId ?? ""),
  })).map((link) => ({
    signalId: link.signal.id,
    category: link.signal.category,
    severity: link.signal.severity,
    confidence: link.signal.confidence,
    matchConfidence: link.confidence,
    matchType: link.matchType,
    summary: link.signal.summary,
    pricingImplication: link.signal.pricingImplication,
    operatorImplication: link.signal.operatorImplication,
    customerImpact: link.signal.customerImpact,
    affectedModes: strings(link.signal.affectedModes),
    affectedLanes: normalizedLanes(link.signal.affectedLanes),
    sourceRefs: strings(link.signal.sourceRefs),
    createdAt: link.signal.createdAt,
  }));
}
