import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { dismissMarketImpactReview, recordMarketSignalFeedback } from "../src/lib/market-intelligence/market-impact-review";
import { rejectBoilerplateLaneCandidate } from "../src/lib/market-intelligence/lane-validation";

function databaseTarget() {
  const value = process.env.DATABASE_URL ?? "";
  if (!value.trim()) return { configured: false, neon: false, localhost: false, host: null as string | null };
  try {
    const url = new URL(value);
    return {
      configured: true,
      neon: /neon\.tech$/i.test(url.hostname) || url.hostname.includes("neon"),
      localhost: /^(localhost|127\.0\.0\.1)$/i.test(url.hostname),
      host: url.hostname,
    };
  } catch {
    return { configured: true, neon: false, localhost: /localhost|127\.0\.0\.1/.test(value), host: null as string | null };
  }
}

function fail(message: string): never {
  throw new Error(`${message}\nSet ALLOW_MARKET_REVIEW_CLEANUP=1 only after confirming DATABASE_URL points at the intended Neon database.`);
}

async function main() {
  if (process.env.ALLOW_MARKET_REVIEW_CLEANUP !== "1") {
    fail("Cleanup refused: ALLOW_MARKET_REVIEW_CLEANUP is not 1.");
  }
  const db = databaseTarget();
  if (!db.configured) fail("Cleanup refused: DATABASE_URL is not configured.");
  if (db.localhost) fail("Cleanup refused: DATABASE_URL appears to be local.");
  if (!db.neon) fail("Cleanup refused: DATABASE_URL does not appear to be Neon.");

  const candidates = await prisma.marketImpactReview.findMany({
    where: {
      status: "pending",
      linkedEntityType: "lane",
      marketSignal: {
        sourceObject: {
          sourceExternalId: { startsWith: "market:cbp-csms:" },
        },
      },
    },
    include: {
      marketSignal: { select: { id: true, sourceObjectId: true, summary: true } },
      marketSignalLink: { select: { id: true, entityId: true } },
    },
    take: 500,
  });

  const badReviews = candidates.filter((review) =>
    rejectBoilerplateLaneCandidate(review.linkedEntityId) ||
    rejectBoilerplateLaneCandidate(review.marketSignalLink?.entityId),
  );

  const changed = [];
  for (const review of badReviews) {
    await dismissMarketImpactReview({
      officeId: review.officeId,
      reviewId: review.id,
      userId: "system:cleanup-bad-cbp-market-reviews",
      feedbackKind: "wrong_link",
      feedbackNote: "Dismissed by guarded cleanup: CBP pseudo-lane came from boilerplate/chrome text, not validated freight geography.",
    });
    await recordMarketSignalFeedback({
      officeId: review.officeId,
      marketSignalId: review.marketSignalId,
      marketImpactReviewId: review.id,
      userId: "system:cleanup-bad-cbp-market-reviews",
      feedbackKind: "wrong_link",
      note: "CBP pseudo-lane rejected by lane-validation cleanup.",
    }).catch(() => null);
    changed.push({ reviewId: review.id, signalId: review.marketSignalId, linkedEntityId: review.linkedEntityId });
  }

  console.log(JSON.stringify({
    ok: true,
    database: { configured: db.configured, neon: db.neon, localhost: db.localhost, host: db.host },
    candidateReviews: candidates.length,
    dismissedReviews: changed.length,
    dismissed: changed,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
