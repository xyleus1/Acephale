import { prisma } from "@/lib/prisma";
import { assessJobStrategy } from "@/lib/commercial-strategy-persistence";
import { getMarketSignalsForStrategyContext } from "@/lib/market-intelligence/link-market-signals";

export async function listDealRiskAssessments(officeId: string, limit = 20) {
  const jobs = await prisma.job.findMany({
    where: { officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    select: {
      id: true,
      reference: true,
      companyId: true,
      company: { select: { name: true } },
      origin: true,
      destination: true,
      mode: true,
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(50, limit * 2)),
  });

  const assessed = await Promise.all(
    jobs.map(async (job) => {
      const [run, marketSignals] = await Promise.all([
        assessJobStrategy(officeId, job.id).catch(() => null),
        getMarketSignalsForStrategyContext({ officeId, jobId: job.id, companyId: job.companyId, limit: 3 }).catch(() => []),
      ]);
      const topRisk = run?.strategy.riskAssessments[0] ?? null;
      if (!run || !topRisk || !["HIGH", "CRITICAL"].includes(topRisk.level)) return null;
      return {
        jobId: job.id,
        reference: job.reference,
        customer: job.company?.name ?? null,
        route: job.origin || job.destination ? `${job.origin ?? "?"} → ${job.destination ?? "?"}` : null,
        mode: job.mode,
        recommendation: run.strategy.recommendationLabel,
        strategyGrade: {
          band: run.strategy.band,
          confidence: run.strategy.confidence,
        },
        risk: topRisk,
        mitigation: topRisk.mitigation,
        marketSignals: marketSignals.map((signal) => ({
          signalId: signal.signalId,
          severity: signal.severity,
          category: signal.category,
          summary: signal.summary,
          pricingImplication: signal.pricingImplication,
        })),
      };
    })
  );

  return assessed
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.risk.score - a.risk.score)
    .slice(0, Math.max(1, Math.min(50, limit)));
}

export async function refreshRiskAlerts(officeId: string) {
  const staleDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const companies = await prisma.company.findMany({
    where: { officeId },
    include: {
      activities: {
        orderBy: { occurredAt: "desc" },
        take: 1
      }
    }
  });

  const riskyCompanies = companies.filter(
    (company) => company.activities.length === 0 || company.activities[0].occurredAt < staleDate
  );

  const riskyIds = new Set(riskyCompanies.map((c) => c.id));

  const existingOpen = await prisma.riskAlert.findMany({
    where: { officeId, isOpen: true },
    select: { id: true, companyId: true }
  });

  // Close alerts for accounts that are no longer stale
  const toClose = existingOpen.filter((a) => !riskyIds.has(a.companyId));
  if (toClose.length > 0) {
    await prisma.riskAlert.updateMany({
      where: { id: { in: toClose.map((x) => x.id) } },
      data: { isOpen: false, resolvedAt: new Date() }
    });
  }

  // Open new alerts for newly stale accounts
  const existingByCompany = new Set(existingOpen.map((a) => a.companyId));
  for (const company of riskyCompanies) {
    if (!existingByCompany.has(company.id)) {
      await prisma.riskAlert.create({
        data: {
          officeId,
          companyId: company.id,
          level: "MEDIUM",
          reason: "No activity in 14+ days"
        }
      });
    }
  }

  // Log run time so we can throttle auto-runs
  await prisma.event.create({
    data: {
      officeId,
      type: "risk.scan.auto",
      payload: { staleCount: riskyCompanies.length, closedCount: toClose.length }
    }
  });

  return { staleCount: riskyCompanies.length };
}

/** Returns true if a risk scan has NOT been run in the last `hours` hours */
export async function shouldRunRiskScan(officeId: string, hours = 4): Promise<boolean> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const last = await prisma.event.findFirst({
    where: { officeId, type: "risk.scan.auto", createdAt: { gte: since } },
    select: { id: true }
  });
  return last === null;
}
