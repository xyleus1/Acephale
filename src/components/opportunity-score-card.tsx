import { Icon } from "./icon";
import type { OpportunityScore } from "@/lib/opportunity-score";
import { opportunityTone } from "@/lib/opportunity-score";
import {
  buildStrategyDecisionContract,
  buildStrategyRouteDecision,
  type StrategyDecisionContract,
  type StrategyEvidenceCheck,
  type StrategyRouteDecisionRow,
} from "@/lib/commercial-strategy";
import { operatorMetricLabel, operatorToolLabel } from "@/lib/operator-action-labels";

function toneClass(score: number) {
  return `opp-${opportunityTone(score)}`;
}

function contractStateLabel(state: StrategyDecisionContract["state"]) {
  if (state === "blocked") return "Blocked";
  if (state === "review") return "Review only";
  return "Ready";
}

function evidenceStateLabel(tone: StrategyEvidenceCheck["tone"] | StrategyDecisionContract["proven"][number]["tone"] | undefined) {
  if (tone === "blocked") return "Blocked";
  if (tone === "review") return "Needs proof";
  if (tone === "rates") return "Needs rates";
  if (tone === "ready") return "Proven";
  return "Context";
}

function componentSignal(value: number) {
  if (value >= 76) return "strong";
  if (value >= 54) return "watch";
  return "weak";
}

export function OpportunityScorePill({ score }: { score: OpportunityScore }) {
  const contract = buildStrategyDecisionContract(score);
  const decisionQuality = score.evidenceChecks.find((check) => check.key === "decision_quality") ?? null;
  return (
    <span className={`opp-pill ${toneClass(score.score)} decision-${contract.state}`}>
      <span className="opp-pill-state">{contractStateLabel(contract.state)}</span>
      <span>{operatorToolLabel(score.operatorDecision.toolHint)} · {decisionQuality?.label ?? score.recommendationLabel}</span>
    </span>
  );
}

export function OpportunityScoreCard({ score }: { score: OpportunityScore }) {
  const bars = [
    ["Maturity", score.components.maturity],
    ["Price", score.components.pricePower],
    ["Route", score.components.routeQuality],
    ["Risk", score.components.riskControl],
    ["Customer", score.components.customerValue],
    ["Confidence", score.components.confidence],
  ] as const;
  const price = score.price;
  const fmt = (n: number | null) => n == null ? "-" : `${price.currency} ${Math.round(n).toLocaleString()}`;
  const fmtPct = (n: number | null | undefined) => n == null ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
  const fmtCbm = (n: number | null | undefined) => n == null ? "-" : `${n.toFixed(3)} CBM`;
  const cargoMath = score.evidence.cargoMath;
  const targetPosture = score.evidence.targetPosture;
  const coveragePosture = score.evidence.coveragePosture;
  const cargoSource = cargoMath?.source === "DIMENSIONS" ? "Complete dimensions" :
    cargoMath?.source === "PARTIAL_DIMENSIONS" ? "Partial dimensions" :
    cargoMath?.source === "STORED_VOLUME" ? "Stored volume only" :
    cargoMath?.source === "STACKABILITY_ONLY" ? "Stackability noted" :
    null;
  const ladderPoints = [
    { key: "buy", label: "Buy cost", value: price.buyCost, tone: "base" },
    { key: "floor", label: "Floor", value: price.floorPrice, tone: "floor" },
    { key: "target", label: "Customer target", value: score.evidence.targetPrice, tone: "target" },
    { key: "rec", label: "Recommended", value: price.recommendedPrice, tone: "recommended" },
    { key: "stretch", label: "Stretch", value: price.stretchPrice, tone: "stretch" },
    { key: "walk", label: "Walk-away", value: price.walkAwayPrice, tone: "walk" },
  ].filter((p) => p.value != null) as Array<{ key: string; label: string; value: number; tone: string }>;
  const maxPoint = Math.max(...ladderPoints.map((p) => p.value), 1);
  const topActions = score.actions.slice(0, 3);
  const routeDecision = buildStrategyRouteDecision(score);
  const topRoutes = [
    routeDecision.selected,
    ...routeDecision.alternatives,
  ].filter((item): item is StrategyRouteDecisionRow => Boolean(item)).slice(0, 3);
  const decisionReasons = score.decisionReasons.slice(0, 4);
  const blockerQueue = score.blockerResolutionPlan.slice(0, 4);
  const evidenceChecks = score.evidenceChecks.slice(0, 6);
  const operatorDecision = score.operatorDecision;
  const decisionQuality = score.evidenceChecks.find((check) => check.key === "decision_quality") ?? null;
  const decisionContract = buildStrategyDecisionContract(score);
  const weakestProof = decisionContract.assumptions.find((item) => item.tone === "blocked" || item.tone === "review")
    ?? decisionContract.assumptions[0]
    ?? decisionContract.proven[0]
    ?? null;
  const firstAllowedMove = decisionContract.allowedAgentMoves[0] ?? operatorDecision.command;
  const firstForbiddenMove = decisionContract.forbidden[0] ?? "No external send without operator approval.";
  const surfaceLabels: Record<typeof operatorDecision.surfaceHint, string> = {
    rfq_missing_info: "RFQ maturity",
    pricing_forwarder_drafts: "Pricing desk",
    pricing_review: "Strategy review",
    customer_quote: "Customer quote",
    deal_parking: "Parked deal",
  };

  return (
    <section className={`opp-card ${toneClass(score.score)}`}>
      <div className="opp-card-top">
        <div>
          <div className="opp-title">{score.recommendationLabel}</div>
          <div className="opp-action">{score.action}</div>
        </div>
        <div className={`opp-contract-lockup ${decisionContract.state}`}>
          <span>Decision state</span>
          <strong>{contractStateLabel(decisionContract.state)}</strong>
          <em>{score.band} band · {score.confidence} confidence</em>
        </div>
      </div>

      <div className={`strategy-control-contract ${decisionContract.state}`} aria-label="Commercial decision contract">
        <div>
          <span className="strategy-section-label">Weakest proof</span>
          <strong>{weakestProof ? `${weakestProof.label}: ${evidenceStateLabel(weakestProof.tone)}` : "No weak proof"}</strong>
          <em>{weakestProof?.detail ?? "The current recommendation has no blocked or review evidence in the contract."}</em>
        </div>
        <div>
          <span className="strategy-section-label">Agent may</span>
          <strong>{operatorToolLabel(operatorDecision.toolHint)}</strong>
          <em>{firstAllowedMove}</em>
        </div>
        <div>
          <span className="strategy-section-label">Stop rule</span>
          <strong>{firstForbiddenMove}</strong>
          <em>{decisionContract.nextHumanQuestion ?? decisionContract.summary}</em>
        </div>
        <div className={`strategy-quality-chip ${decisionQuality?.tone ?? "info"}`}>
          <span>Decision quality</span>
          <strong>{evidenceStateLabel(decisionQuality?.tone)}</strong>
          <em>{decisionQuality?.detail ?? "Decision-quality audit has not been attached to this strategy."}</em>
        </div>
      </div>

      <div className="strategy-decision-strip">
        <div>
          <span>Guardrail</span>
          <strong>{price.guardrailStatus.toLowerCase().replace("_", " ")}</strong>
        </div>
        <div>
          <span>Win odds</span>
          <strong>{price.winProbability}%</strong>
        </div>
        <div>
          <span>Expected GP</span>
          <strong>{fmt(price.expectedGrossProfit)}</strong>
        </div>
        <div>
          <span>Coverage</span>
          <strong>{score.evidence.quoteCoverage}</strong>
        </div>
      </div>

      <div className={`strategy-operator-decision ${operatorDecision.phase.toLowerCase().replace(/_/g, "-")} ${operatorDecision.priority}`}>
        <div className="strategy-operator-main">
          <span className="strategy-section-label">Operator decision</span>
          <strong>{operatorDecision.title}</strong>
          <em>{operatorDecision.command}</em>
        </div>
        <div className="strategy-operator-meta">
          <span>{operatorDecision.owner.toLowerCase()}</span>
          <span>{operatorDecision.ctaLabel}</span>
          {operatorDecision.requiresApproval && <span>approval</span>}
        </div>
        <div className="strategy-agent-handoff">
          <span>Agent handoff</span>
          <strong>{operatorToolLabel(operatorDecision.toolHint)}</strong>
          <em>{surfaceLabels[operatorDecision.surfaceHint]}</em>
        </div>
        {(operatorDecision.blockers.length > 0 || operatorDecision.approvals.length > 0) && (
          <div className="strategy-operator-reasons">
            {[...operatorDecision.blockers, ...operatorDecision.approvals].slice(0, 4).map((item) => <span key={item}>{item}</span>)}
          </div>
        )}
      </div>

      <div className={`strategy-quote-gate ${score.quoteGate.status.toLowerCase().replace(/_/g, "-")}`}>
        <div>
          <span className="strategy-section-label">Quote gate</span>
          <strong>{score.quoteGate.label}</strong>
          <em>{score.quoteGate.decision}</em>
        </div>
        <div className="strategy-quote-gate-flags">
          <span className={score.quoteGate.canSendToForwarders ? "ok" : "blocked"}>Forwarders {score.quoteGate.canSendToForwarders ? "allowed" : "blocked"}</span>
          <span className={score.quoteGate.canQuoteCustomer ? "ok" : "blocked"}>Customer quote {score.quoteGate.canQuoteCustomer ? "ready" : "not ready"}</span>
          {score.quoteGate.requiresApproval && <span className="review">Approval required</span>}
        </div>
        {(score.quoteGate.blockers.length > 0 || score.quoteGate.approvals.length > 0) && (
          <div className="strategy-quote-gate-reasons">
            {[...score.quoteGate.blockers, ...score.quoteGate.approvals].slice(0, 4).map((item) => <span key={item}>{item}</span>)}
          </div>
        )}
      </div>

      {(decisionReasons.length > 0 || blockerQueue.length > 0 || evidenceChecks.length > 0) && (
        <div className="strategy-rationale-grid" aria-label="Decision rationale and evidence">
          {decisionReasons.length > 0 && (
            <div className="strategy-reason-stack">
              <div className="strategy-rationale-head">
                <span className="strategy-section-label">Why this move</span>
                <strong>Decision stack</strong>
              </div>
              {decisionReasons.map((reason, index) => (
                <div key={`${reason.key}-${reason.summary}`} className={`strategy-rationale-row ${reason.tone}`}>
                  <span>#{index + 1} {reason.label}</span>
                  <strong>{reason.summary}</strong>
                  <em>{reason.detail}</em>
                </div>
              ))}
            </div>
          )}

          {blockerQueue.length > 0 ? (
            <div className="strategy-blocker-queue">
              <div className="strategy-rationale-head">
                <span className="strategy-section-label">Clear next</span>
                <strong>{blockerQueue[0].label}</strong>
              </div>
              {blockerQueue.map((item, index) => (
                <div key={item.key} className={`strategy-blocker-row ${item.priority}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.ask}</strong>
                    <em>{item.why}</em>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="strategy-blocker-queue clear">
              <div className="strategy-rationale-head">
                <span className="strategy-section-label">Clear next</span>
                <strong>No blocker queue</strong>
              </div>
            </div>
          )}

          {evidenceChecks.length > 0 && (
            <div className="strategy-evidence-stack">
              <div className="strategy-rationale-head">
                <span className="strategy-section-label">Evidence</span>
                <strong>Trust ledger</strong>
              </div>
              {evidenceChecks.map((check) => (
                <div key={check.key} className={`strategy-evidence-row ${check.tone}`}>
                  <span>{check.label}</span>
                  <strong title={operatorMetricLabel(check.metric, check.tone)}>{operatorMetricLabel(check.metric, check.tone)}</strong>
                  <em>{check.detail}</em>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="strategy-price-grid">
        <div>
          <span>Floor</span>
          <strong>{fmt(price.floorPrice)}</strong>
        </div>
        <div>
          <span>Recommended</span>
          <strong>{fmt(price.recommendedPrice)}</strong>
        </div>
        <div>
          <span>Stretch</span>
          <strong>{fmt(price.stretchPrice)}</strong>
        </div>
        <div>
          <span>Walk-away</span>
          <strong>{fmt(price.walkAwayPrice)}</strong>
        </div>
      </div>

      <div className={`strategy-coverage-posture ${coveragePosture.status.toLowerCase().replace(/_/g, "-")}`}>
        <div className="strategy-coverage-head">
          <div>
            <span className="strategy-section-label">Coverage posture</span>
            <strong>{coveragePosture.label}</strong>
          </div>
          <em>{coveragePosture.stance}</em>
        </div>
        <div className="strategy-coverage-grid">
          <div>
            <span>Live</span>
            <strong>{coveragePosture.receivedQuotes}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>{coveragePosture.pendingQuotes}</strong>
          </div>
          <div>
            <span>Lane</span>
            <strong>{coveragePosture.laneRateMatches}</strong>
          </div>
          <div>
            <span>History</span>
            <strong>{coveragePosture.historicalLaneJobs}</strong>
          </div>
        </div>
      </div>

      <div className={`strategy-target-posture ${targetPosture.status.toLowerCase().replace(/_/g, "-")}`}>
        <div className="strategy-target-head">
          <div>
            <span className="strategy-section-label">Target posture</span>
            <strong>{targetPosture.label}</strong>
          </div>
          <em>{targetPosture.stance}</em>
        </div>
        <div className="strategy-target-grid">
          <div>
            <span>Target</span>
            <strong>{targetPosture.target == null ? "-" : `${targetPosture.currency} ${Math.round(targetPosture.target).toLocaleString()}`}</strong>
          </div>
          <div>
            <span>Margin at target</span>
            <strong>{fmtPct(targetPosture.marginAtTargetPct)}</strong>
          </div>
          <div>
            <span>Gap to floor</span>
            <strong>{fmtPct(targetPosture.gapToFloorPct)}</strong>
          </div>
          <div>
            <span>Gap to rec.</span>
            <strong>{fmtPct(targetPosture.gapToRecommendedPct)}</strong>
          </div>
        </div>
      </div>

      <div className={`strategy-negotiation-posture ${score.negotiation.posture.toLowerCase().replace(/_/g, "-")}`}>
        <div className="strategy-negotiation-head">
          <div>
            <span className="strategy-section-label">Negotiation posture</span>
            <strong>{score.negotiation.label}</strong>
          </div>
          <em>{score.negotiation.internalGuardrail}</em>
        </div>
        <div className="strategy-negotiation-copy">
          <div>
            <span>Customer</span>
            <strong>{score.negotiation.customerTalkTrack}</strong>
          </div>
          <div>
            <span>Forwarder</span>
            <strong>{score.negotiation.forwarderCounter}</strong>
          </div>
        </div>
        {score.negotiation.leverage.length > 0 && (
          <div className="strategy-negotiation-leverage">
            {score.negotiation.leverage.slice(0, 3).map((item) => <span key={item}>{item}</span>)}
          </div>
        )}
      </div>

      {cargoMath && (
        <div className={`strategy-cargo-math ${cargoMath.dimensionsPartial ? "partial" : ""}`}>
          <div className="strategy-cargo-head">
            <div>
              <span className="strategy-section-label">Cargo math</span>
              <strong>{cargoSource}</strong>
            </div>
            {cargoMath.dimensionsPartial && <em>Complete dimensions before pricing</em>}
          </div>
          <div className="strategy-cargo-grid">
            <div>
              <span>Physical</span>
              <strong>{fmtCbm(cargoMath.physicalCbm ?? cargoMath.storedVolume)}</strong>
            </div>
            <div>
              <span>Chargeable</span>
              <strong>{fmtCbm(cargoMath.chargeableCbm ?? cargoMath.storedVolume)}</strong>
            </div>
            <div>
              <span>Stackable</span>
              <strong>{cargoMath.stackable ?? "unknown"}</strong>
            </div>
            <div>
              <span>Top load</span>
              <strong>{cargoMath.topLoad ?? "unknown"}</strong>
            </div>
          </div>
          <div className="strategy-cargo-note">
            {cargoMath.dimensionsPartial
              ? `${cargoMath.completeRows}/${cargoMath.enteredRows} dimension rows complete. CBM remains unverified.`
              : cargoMath.chargeableCbm != null && cargoMath.physicalCbm != null && cargoMath.chargeableCbm > cargoMath.physicalCbm
                ? "Non-stackable floor-space calculation is increasing the chargeable CBM."
                : "Cargo volume is available for pricing checks."}
          </div>
        </div>
      )}

      {ladderPoints.length > 0 && (
        <div className="strategy-price-ladder" aria-label="Pricing ladder">
          {ladderPoints.map((point) => (
            <div key={point.key} className={`strategy-ladder-row ${point.tone}`}>
              <span>{point.label}</span>
              <div className="strategy-ladder-track">
                <i style={{ width: `${Math.max(8, Math.round((point.value / maxPoint) * 100))}%` }} />
              </div>
              <strong>{fmt(point.value)}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="strategy-memo">{score.strategyMemo}</div>

      {routeDecision.selected && (
        <div className="strategy-route">
          <div>
            <span>Route pick</span>
            <strong>{routeDecision.selected.label}</strong>
          </div>
          <em>{routeDecision.summary}</em>
        </div>
      )}

      {topRoutes.length > 0 && (
        <div className="strategy-route-options">
          <div className="strategy-section-label">Route options</div>
          <div className="strategy-route-list">
            {topRoutes.map((route) => {
              const freshness = route.rateFreshnessStatus
                ? route.rateFreshnessStatus.replace(/_/g, " ")
                : route.source.toLowerCase().replace(/_/g, " ");
              return (
                <div key={`${route.rank}-${route.label}-${route.source}-${route.cost ?? "x"}`} className={`strategy-route-card ${route.rateReliable === false ? "stale" : route.rank === 1 ? "selected" : ""}`}>
                  <div>
                    <strong>{route.label}</strong>
                    <span>{route.provider ?? route.source.toLowerCase().replace("_", " ")} · {freshness}</span>
                  </div>
                  <em>{route.costLabel}</em>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="opp-bars">
        {bars.map(([label, value]) => (
          <div key={label} className="opp-bar-row">
            <span>{label}</span>
            <div className="opp-bar-track">
              <div className="opp-bar-fill" style={{ width: `${value}%` }} />
            </div>
            <strong title={`${label} signal: ${componentSignal(value)}`}>{componentSignal(value)}</strong>
          </div>
        ))}
      </div>

      <div className="opp-grid">
        <div>
          <div className="opp-list-title">
            <Icon name="check" size={12} />
            Evidence
          </div>
          {score.strengths.length > 0 ? (
            <ul className="opp-list">
              {score.strengths.map((s) => <li key={s}>{s}</li>)}
            </ul>
          ) : (
            <div className="opp-muted">No strong positive signals yet.</div>
          )}
        </div>
        <div>
          <div className="opp-list-title">
            <Icon name="alert" size={12} />
            Risks
          </div>
          {score.risks.length > 0 ? (
            <ul className="opp-list">
              {score.risks.map((s) => <li key={s}>{s}</li>)}
            </ul>
          ) : (
            <div className="opp-muted">No major risks detected.</div>
          )}
        </div>
      </div>

      {topActions.length > 0 && (
        <div className="strategy-action-rail">
          <div className="strategy-section-label">Next decisions</div>
          {topActions.map((action) => (
            <div key={`${action.actionType}-${action.title}`} className={`strategy-action-item ${action.priority}`}>
              <span>{action.priority}</span>
              <div>
                <strong>{action.title}</strong>
                <em>{action.rationale}</em>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="opp-foot">
        <span>{score.confidence} confidence</span>
        <span>{score.details.receivedQuotes} quotes received</span>
        <span>{price.winProbability}% win probability</span>
        {price.expectedMarginPct != null && <span>{price.expectedMarginPct.toFixed(1)}% expected margin</span>}
        <span>{price.guardrailStatus.toLowerCase().replace("_", " ")}</span>
      </div>
    </section>
  );
}
