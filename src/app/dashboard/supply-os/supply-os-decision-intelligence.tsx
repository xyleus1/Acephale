import { AlertTriangle, CheckCircle2, ExternalLink, RadioTower, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import styles from "./supply-os-decision-intelligence.module.css";

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
}

function firstSourceUrl(value: unknown) {
  for (const candidate of strings(value)) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:") return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}

function short(value: string | null | undefined, max = 180) {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3).trim()}...`;
}

function timeLabel(value: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export async function SupplyOsDecisionIntelligence({ officeId }: { officeId: string }) {
  const signals = await prisma.marketSignal.findMany({
    where: {
      officeId,
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    take: 24,
    select: {
      id: true,
      category: true,
      severity: true,
      confidence: true,
      summary: true,
      operatorImplication: true,
      pricingImplication: true,
      recommendedActions: true,
      sourceRefs: true,
      createdAt: true,
      effectiveFrom: true,
      effectiveTo: true,
      impactReviews: {
        where: { status: { in: ["pending", "acknowledged"] } },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          id: true,
          impactLevel: true,
          impactReason: true,
          recommendedAction: true,
          status: true,
          linkedEntityType: true,
        },
      },
    },
  });

  const ranked = signals
    .sort((left, right) => {
      const leftScore = (SEVERITY_WEIGHT[left.severity] ?? 0) * 100 + left.impactReviews.length * 20 + left.confidence * 10;
      const rightScore = (SEVERITY_WEIGHT[right.severity] ?? 0) * 100 + right.impactReviews.length * 20 + right.confidence * 10;
      return rightScore - leftScore;
    })
    .slice(0, 5);

  return (
    <section className={styles.intelligence} aria-labelledby="supply-os-intelligence-title">
      <header className={styles.header}>
        <div>
          <h2 id="supply-os-intelligence-title">Market signals</h2>
          <p>Inputs only. No quote or action is approved.</p>
        </div>
        <dl>
          <div><dt>Active signals</dt><dd>{signals.length}</dd></div>
          <div><dt>Shown</dt><dd>{ranked.length}</dd></div>
        </dl>
      </header>

      {ranked.length ? (
        <div className={styles.signalGrid}>
          {ranked.map((signal) => {
            const sourceUrl = firstSourceUrl(signal.sourceRefs);
            const impact = signal.impactReviews[0];
            const action = impact?.recommendedAction || strings(signal.recommendedActions)[0] || signal.operatorImplication;
            return (
              <article key={signal.id} data-severity={signal.severity}>
                <header>
                  <span>{signal.category.replaceAll("_", " ")}</span>
                  <strong>{signal.severity}</strong>
                </header>
                <h3>{short(signal.summary, 140)}</h3>
                <p>{short(impact?.impactReason || signal.operatorImplication || signal.pricingImplication || "No direct decision impact has been reviewed yet.")}</p>
                <div className={styles.decisionUse}>
                  {impact ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                  <span><small>{impact ? `${impact.status} ${impact.linkedEntityType} review` : "Signal awaiting entity review"}</small><strong>{short(action, 130) || "Confirm relevance before changing the sourcing plan."}</strong></span>
                </div>
                <footer>
                  <span><ShieldCheck size={12} /> Confidence {Math.round(signal.confidence * 100)}%</span>
                  <time dateTime={signal.createdAt.toISOString()}>{timeLabel(signal.createdAt)}</time>
                  {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Source <ExternalLink size={11} /></a> : <span>No public URL</span>}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <RadioTower size={22} />
          <div>
            <strong>No signals</strong>
            <p>Add an approved source to show reviewed evidence here.</p>
          </div>
        </div>
      )}
    </section>
  );
}
