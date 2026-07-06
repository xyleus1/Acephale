import { Icon } from "@/components/icon";
import {
  type CommercialStrategy,
  type StrategyEvidenceCheck,
  type StrategyExecutionPacket,
  type StrategyRouteDecision,
} from "@/lib/commercial-strategy";
import { operatorMetricLabel, operatorToolLabel } from "@/lib/operator-action-labels";

type EngineTone = StrategyEvidenceCheck["tone"] | "rates";
type EngineIcon = Parameters<typeof Icon>[0]["name"];

type EnginePart = {
  key: string;
  label: string;
  value: string;
  metric: string;
  detail: string;
  fix: string;
  tone: EngineTone;
  icon: EngineIcon;
};

function money(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 10) / 10}%`;
}

function toneFromEvidence(tone: StrategyEvidenceCheck["tone"] | "rates" | string | null | undefined): EngineTone {
  if (tone === "ready" || tone === "review" || tone === "blocked" || tone === "rates" || tone === "info") return tone;
  return "info";
}

function gateTone(status: CommercialStrategy["quoteGate"]["status"]): EngineTone {
  if (status === "READY_TO_QUOTE") return "ready";
  if (status === "REVIEW_REQUIRED") return "review";
  if (status === "NEEDS_RATES") return "rates";
  return "blocked";
}

function guardrailTone(status: CommercialStrategy["price"]["guardrailStatus"]): EngineTone {
  if (status === "PASS") return "ready";
  if (status === "BLOCKED") return "blocked";
  if (status === "NEEDS_COST") return "rates";
  return "review";
}

function scoreTone(score: number): EngineTone {
  if (score >= 78) return "ready";
  if (score >= 58) return "review";
  return "blocked";
}

function riskTone(score: number | null | undefined): EngineTone {
  if (score == null) return "ready";
  if (score >= 70) return "blocked";
  if (score >= 45) return "review";
  return "ready";
}

function routeTone(routeDecision: StrategyRouteDecision): EngineTone {
  const selected = routeDecision.selected;
  if (!selected) return "rates";
  if (!routeDecision.canQuoteCustomer) return gateTone(routeDecision.quoteGateStatus);
  if (selected.rateReliable === false) return "review";
  if (selected.confidence === "high") return "ready";
  if (selected.confidence === "medium") return "review";
  return "rates";
}

function componentLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").toLowerCase();
}

function EngineBoardNode({ part }: { part: EnginePart }) {
  return (
    <article className={`brain-engine-node ${part.key} ${part.tone}`}>
      <div className="brain-engine-node-head">
        <span className="brain-engine-icon"><Icon name={part.icon} size={15} /></span>
        <div>
          <span>{part.label}</span>
          <strong>{part.value}</strong>
        </div>
      </div>
      <div className="brain-engine-node-metric">{part.metric}</div>
      <p>{part.detail}</p>
      <em>{part.fix}</em>
    </article>
  );
}

export function CommercialBrainEngineSchematic({
  strategy,
  packet,
  routeDecision,
  jobReference,
}: {
  strategy: CommercialStrategy;
  packet: StrategyExecutionPacket;
  routeDecision: StrategyRouteDecision;
  jobReference: string;
}) {
  const maturityChecks = strategy.maturityChecks ?? [];
  const readyMaturity = maturityChecks.filter((check) => check.status === "ready");
  const missingMaturity = maturityChecks.filter((check) => check.status === "missing");
  const firstBlocker = strategy.blockerResolutionPlan[0] ?? null;
  const docReadiness = strategy.evidence.documentReadiness;
  const weakest = packet.evidence.weakest;
  const firstGap = packet.evidence.gaps[0] ?? null;
  const coverage = strategy.evidence.coveragePosture;
  const rateFreshness = strategy.evidence.rateFreshness;
  const selectedRoute = routeDecision.selected;
  const routeRows = [routeDecision.selected, ...routeDecision.alternatives].filter(Boolean).slice(0, 4);
  const topRisk = strategy.riskAssessments[0] ?? null;
  const allowedMove = packet.contract.allowedAgentMoves[0] ?? "Review only.";
  const forbiddenMove = packet.contract.forbidden[0] ?? packet.safety.stopCondition;
  const coreTone = scoreTone(strategy.score);
  const outputTone = gateTone(strategy.quoteGate.status);
  const intakeTone: EngineTone = missingMaturity.length > 0 || strategy.missing.length > 0 ? "blocked" : "ready";
  const docLine = docReadiness
    ? `${docReadiness.approved}/${docReadiness.total} docs approved`
    : "No document packet attached";
  const coverageMetric = `${coverage.receivedQuotes} live / ${coverage.pendingQuotes} pending`;
  const evidenceTone = toneFromEvidence(weakest?.tone ?? rateFreshness?.tone ?? (coverage.receivedQuotes > 0 ? "ready" : "rates"));
  const riskValue = topRisk ? `${topRisk.level} ${topRisk.category}` : "Low";

  const parts: EnginePart[] = [
    {
      key: "intake",
      label: "Intake manifold",
      value: maturityChecks.length > 0 ? `${readyMaturity.length}/${maturityChecks.length} RFQ checks` : "RFQ scan",
      metric: strategy.missing.length > 0 ? `${strategy.missing.length} missing` : docLine,
      detail: missingMaturity[0]?.detail ?? docReadiness?.detail ?? "Core RFQ and document inputs are not blocking this decision.",
      fix: firstBlocker?.ask ?? "Keep source facts explicit; do not infer missing customer data.",
      tone: intakeTone,
      icon: "list",
    },
    {
      key: "evidence",
      label: "Evidence pump",
      value: weakest ? weakest.label : coverage.label,
      metric: weakest ? operatorMetricLabel(weakest.metric, weakest.tone) : coverageMetric,
      detail: weakest?.detail ?? rateFreshness?.detail ?? `${coverage.label}: ${coverage.stance}`,
      fix: firstGap?.action ?? "Evidence can feed pricing, route, and risk checks without hiding weak inputs.",
      tone: evidenceTone,
      icon: "activity",
    },
    {
      key: "pricing",
      label: "Pricing governor",
      value: strategy.price.guardrailStatus.toLowerCase().replace(/_/g, " "),
      metric: money(strategy.price.recommendedPrice, strategy.price.currency),
      detail: `Buy ${money(strategy.price.buyCost, strategy.price.currency)} -> floor ${money(strategy.price.floorPrice, strategy.price.currency)} -> margin ${pct(strategy.price.expectedMarginPct)}.`,
      fix: strategy.price.rationale[0] ?? "Use the guardrail before any customer-facing price leaves the desk.",
      tone: guardrailTone(strategy.price.guardrailStatus),
      icon: "dollar",
    },
    {
      key: "route",
      label: "Route turbine",
      value: selectedRoute?.label ?? "No priced route",
      metric: selectedRoute ? `${selectedRoute.costLabel} / ${selectedRoute.confidence}` : "needs rates",
      detail: routeDecision.summary,
      fix: routeDecision.selectionRule,
      tone: routeTone(routeDecision),
      icon: "ship",
    },
    {
      key: "risk",
      label: "Risk regulator",
      value: riskValue,
      metric: topRisk ? `${topRisk.score}/100` : `${strategy.components.riskControl}/100 control`,
      detail: topRisk?.reason ?? "No dominant commercial, cargo, timing, or route risk overrides this action.",
      fix: topRisk?.mitigation ?? "Keep risk clear by preserving route, document, and approval proof.",
      tone: riskTone(topRisk?.score),
      icon: "shield",
    },
    {
      key: "output",
      label: "Output clutch",
      value: strategy.quoteGate.label,
      metric: operatorToolLabel(strategy.operatorDecision.toolHint),
      detail: packet.primary.command,
      fix: forbiddenMove,
      tone: outputTone,
      icon: "settings",
    },
  ];

  const intakePart = parts.find((part) => part.key === "intake")!;
  const evidencePart = parts.find((part) => part.key === "evidence")!;
  const pricingPart = parts.find((part) => part.key === "pricing")!;
  const routePart = parts.find((part) => part.key === "route")!;
  const riskPart = parts.find((part) => part.key === "risk")!;
  const outputPart = parts.find((part) => part.key === "output")!;
  const proofRows = packet.evidence.gaps.length > 0
    ? packet.evidence.gaps.slice(0, 4)
    : [{
      key: "clear",
      label: "No blocking gap",
      tone: "ready" as const,
      metric: "ready",
      detail: "No proof gap blocks the current decision gate.",
      action: "Proceed only within the decision contract.",
      owner: "INTERNAL" as const,
      target: "strategy-evidence" as const,
    }];
  const connectors = [
    "Intake -> Evidence",
    "Evidence -> Pricing, route, risk",
    "Governors -> Decision core",
    "Core -> Output clutch",
  ];

  return (
    <section className={`commercial-brain-engine ${outputTone}`} aria-label="Commercial decision engine schematic">
      <div className="brain-engine-header">
        <div>
          <span>Commercial decision engine</span>
          <h2>{strategy.recommendationLabel}</h2>
          <p>{strategy.strategyMemo}</p>
        </div>
        <div className={`brain-engine-verdict ${coreTone}`}>
          <span>{jobReference}</span>
          <strong>{strategy.band}{strategy.score}</strong>
          <em>{strategy.confidence} confidence</em>
        </div>
      </div>

      <div className="brain-engine-board" aria-label="Connected commercial decision board">
        <svg className="brain-engine-pipes" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden>
          <defs>
            <marker id="brain-engine-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M0,0 L8,4 L0,8 Z" />
            </marker>
          </defs>
          <path className={`pipe ${intakePart.tone}`} d="M178 282 C230 282 244 282 296 282" />
          <path className={`pipe ${pricingPart.tone}`} d="M430 262 C498 154 548 142 612 142" />
          <path className={`pipe ${routePart.tone}`} d="M430 282 C494 282 548 282 612 282" />
          <path className={`pipe ${riskPart.tone}`} d="M430 302 C498 410 548 422 612 422" />
          <path className={`pipe ${pricingPart.tone}`} d="M766 142 C818 154 830 218 856 252" />
          <path className={`pipe ${routePart.tone}`} d="M766 282 C812 282 830 282 856 282" />
          <path className={`pipe ${riskPart.tone}`} d="M766 422 C818 410 830 346 856 312" />
          <path className={`pipe ${outputPart.tone}`} d="M932 282 C954 282 966 282 986 282" />
        </svg>

        <EngineBoardNode part={intakePart} />
        <EngineBoardNode part={evidencePart} />
        <EngineBoardNode part={pricingPart} />
        <EngineBoardNode part={routePart} />
        <EngineBoardNode part={riskPart} />

        <article className={`brain-engine-core ${coreTone}`}>
          <div className="brain-engine-core-ring" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="brain-engine-core-copy">
            <span>Decision core</span>
            <strong>{strategy.band} band / {strategy.score}</strong>
            <em>{strategy.label}</em>
          </div>
          <div className="brain-engine-component-grid" aria-label="Score anatomy">
            {Object.entries(strategy.components).map(([key, value]) => (
              <div key={key}>
                <span>{componentLabel(key)}</span>
                <strong>{value}</strong>
                <i style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
              </div>
            ))}
          </div>
        </article>

        <EngineBoardNode part={outputPart} />
      </div>

      <div className="brain-engine-flow" aria-label="Decision flow">
        {connectors.map((connector, index) => (
          <span key={connector}>
            <b>{index + 1}</b>
            {connector}
          </span>
        ))}
      </div>

      <div className="brain-engine-lower-grid">
        <div className="brain-engine-panel price">
          <div className="brain-engine-panel-head">
            <span>Price ladder</span>
            <strong>{strategy.price.currency}</strong>
          </div>
          <div className="brain-engine-price-ladder">
            <span>Buy <strong>{money(strategy.price.buyCost, strategy.price.currency)}</strong></span>
            <span>Floor <strong>{money(strategy.price.floorPrice, strategy.price.currency)}</strong></span>
            <span>Recommended <strong>{money(strategy.price.recommendedPrice, strategy.price.currency)}</strong></span>
            <span>Stretch <strong>{money(strategy.price.stretchPrice, strategy.price.currency)}</strong></span>
            <span>Walk-away <strong>{money(strategy.price.walkAwayPrice, strategy.price.currency)}</strong></span>
            <span>Win <strong>{strategy.price.winProbability}%</strong></span>
          </div>
        </div>

        <div className="brain-engine-panel route">
          <div className="brain-engine-panel-head">
            <span>Route chamber</span>
            <strong>{routeDecision.selected?.label ?? "No selected route"}</strong>
          </div>
          <div className="brain-engine-route-list">
            {routeRows.map((row) => row && (
              <div key={`${row.rank}-${row.label}-${row.source}`}>
                <span>#{row.rank}</span>
                <strong>{row.label}</strong>
                <em>{row.costLabel} / {row.confidence} / risk {row.riskScore}</em>
              </div>
            ))}
            {routeRows.length === 0 && (
              <div>
                <span>--</span>
                <strong>No priced route</strong>
                <em>Request current forwarder rates before customer-facing pricing.</em>
              </div>
            )}
          </div>
        </div>

        <div className="brain-engine-panel proof">
          <div className="brain-engine-panel-head">
            <span>Proof queue</span>
            <strong>{packet.evidence.gaps.length > 0 ? `${packet.evidence.gaps.length} to clear` : "Clear"}</strong>
          </div>
          <div className="brain-engine-proof-list">
            {proofRows.map((gap) => (
              <div key={`${gap.key}-${gap.target}`} className={toneFromEvidence(gap.tone)}>
                <span>{gap.owner} / {gap.label}</span>
                <strong>{gap.action}</strong>
                <em>{operatorMetricLabel(gap.metric, gap.tone)} / {gap.detail}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="brain-engine-panel contract">
          <div className="brain-engine-panel-head">
            <span>Decision contract</span>
            <strong>{packet.contract.title}</strong>
          </div>
          <p>{packet.contract.summary}</p>
          <div className="brain-engine-contract-grid">
            <div>
              <span>Agent may</span>
              <strong>{allowedMove}</strong>
            </div>
            <div>
              <span>Forbidden</span>
              <strong>{forbiddenMove}</strong>
            </div>
          </div>
        </div>

        <div className="brain-engine-panel commands">
          <div className="brain-engine-panel-head">
            <span>Command ledger</span>
            <strong>{packet.primary.label}</strong>
          </div>
          <div className="brain-engine-command-list">
            {packet.commandLedger.slice(0, 5).map((item) => (
              <div key={item.key} className={toneFromEvidence(item.tone)}>
                <span>{item.owner} / {item.label}</span>
                <strong>{item.command}</strong>
                <em>{item.stopRule}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="brain-engine-panel risks">
          <div className="brain-engine-panel-head">
            <span>Risk stack</span>
            <strong>{topRisk?.level ?? "LOW"}</strong>
          </div>
          <div className="brain-engine-risk-list">
            {(strategy.riskAssessments.length > 0 ? strategy.riskAssessments.slice(0, 4) : [{
              category: "CONFIDENCE" as const,
              level: "LOW" as const,
              score: Math.max(0, 100 - strategy.components.riskControl),
              reason: "No dominant risk overrides the commercial action.",
              mitigation: "Keep source proof attached to the decision.",
            }]).map((risk) => (
              <div key={`${risk.category}-${risk.reason}`} className={riskTone(risk.score)}>
                <span>{risk.category} / {risk.score}/100</span>
                <strong>{risk.reason}</strong>
                <em>{risk.mitigation}</em>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
