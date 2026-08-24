// Deterministic fit scoring. A lead only earns outreach priority from
// evidence found on its own pages, never from a model guess.

import { normalizeTurkish } from "./extract";
import type { LeadGenProfile } from "./profile";

export type LeadFitInput = {
  companyName: string;
  domain: string;
  pageText: string;
  segmentKey: string | null;
  emailCount: number;
  hasPhone: boolean;
};

export type LeadFitResult = {
  score: number;
  tier: "A" | "B" | "C" | "reject";
  matchedSignals: string[];
  matchedSegments: string[];
  rejectionReason: string | null;
};

const MAX_SIGNAL_POINTS = 60;
const SEGMENT_POINTS = 25;
const CONTACT_POINTS = 15;

export function scoreLead(profile: LeadGenProfile, input: LeadFitInput): LeadFitResult {
  const haystack = normalizeTurkish(`${input.companyName} ${input.domain} ${input.pageText}`);

  const matchedSignals = profile.positiveSignals.filter((signal) =>
    haystack.includes(normalizeTurkish(signal)),
  );
  const negativeHits = profile.negativeSignals.filter((signal) =>
    haystack.includes(normalizeTurkish(signal)),
  );

  const matchedSegments = profile.segments
    .filter((segment) =>
      segment.keywords.some((keyword) =>
        keyword
          .split(" ")
          .every((token) => haystack.includes(normalizeTurkish(token))),
      ),
    )
    .map((segment) => segment.key);

  if (matchedSignals.length === 0) {
    return {
      score: 0,
      tier: "reject",
      matchedSignals,
      matchedSegments,
      rejectionReason: "no industrial signal on the page",
    };
  }
  if (negativeHits.length > matchedSignals.length) {
    return {
      score: 0,
      tier: "reject",
      matchedSignals,
      matchedSegments,
      rejectionReason: `off-profile page (${negativeHits.slice(0, 3).join(", ")})`,
    };
  }

  const signalScore = Math.min(MAX_SIGNAL_POINTS, matchedSignals.length * 8);
  const segmentWeight = profile.segments
    .filter((segment) => matchedSegments.includes(segment.key))
    .reduce((max, segment) => Math.max(max, segment.weight), 0);
  const segmentScore = Math.round(segmentWeight * SEGMENT_POINTS);
  const contactScore =
    (input.emailCount > 0 ? 10 : 0) + (input.emailCount > 1 ? 3 : 0) + (input.hasPhone ? 2 : 0);

  const score = Math.min(100, signalScore + segmentScore + Math.min(CONTACT_POINTS, contactScore));

  const tier = score >= 70 ? "A" : score >= 50 ? "B" : "C";
  return { score, tier, matchedSignals, matchedSegments, rejectionReason: null };
}
