"use client";

import { useState, useTransition } from "react";
import { simulatePricingScenarioForJob } from "@/app/dashboard/jobs/[jobId]/actions";
import { Icon } from "@/components/icon";

type ScenarioResult = Awaited<ReturnType<typeof simulatePricingScenarioForJob>>;
type ReadyScenario = Extract<ScenarioResult, { ok: true }>["result"];

function parseAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function signed(value: number | null | undefined, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`;
}

export function PricingScenarioSandbox({
  jobId,
  defaultTargetPrice,
  defaultBuyCost,
  currency,
}: {
  jobId: string;
  defaultTargetPrice?: number | null;
  defaultBuyCost?: number | null;
  currency: string;
}) {
  const [targetPrice, setTargetPrice] = useState(defaultTargetPrice != null ? String(Math.round(defaultTargetPrice)) : "");
  const [buyCost, setBuyCost] = useState(defaultBuyCost != null ? String(Math.round(defaultBuyCost)) : "");
  const [targetCurrency, setTargetCurrency] = useState(currency);
  const [minMarginPct, setMinMarginPct] = useState("");
  const [noTarget, setNoTarget] = useState(false);
  const [replaceExistingQuotes, setReplaceExistingQuotes] = useState(false);
  const [result, setResult] = useState<ReadyScenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runScenario() {
    const target = noTarget ? null : parseAmount(targetPrice);
    const cost = parseAmount(buyCost);
    const minMargin = parseAmount(minMarginPct);
    if (!noTarget && target == null && cost == null && minMargin == null) {
      setError("Enter a target, buy cost, or floor margin to simulate.");
      return;
    }
    startTransition(async () => {
      setError(null);
      const next = await simulatePricingScenarioForJob(jobId, {
        targetPrice: target,
        targetCurrency,
        noTarget,
        buyCost: cost,
        assumeLiveBuyCost: cost != null,
        replaceExistingQuotes,
        minMarginPct: minMargin,
      });
      if (!next.ok) {
        setError(next.error);
        setResult(null);
        return;
      }
      setResult(next.result);
    });
  }

  return (
    <div className="pricing-scenario-sandbox">
      <div className="pricing-scenario-head">
        <div>
          <span>Scenario sandbox</span>
          <strong>Test a price scenario</strong>
          <em>Tests target, buy cost, floor, and quote gate without writing anything.</em>
        </div>
        <Icon name="dollar" size={18} />
      </div>

      <div className="pricing-scenario-form">
        <label>
          <span>Customer target</span>
          <input
            value={targetPrice}
            onChange={(event) => setTargetPrice(event.target.value)}
            disabled={noTarget || pending}
            inputMode="decimal"
            placeholder="2300"
          />
        </label>
        <label>
          <span>Buy cost</span>
          <input
            value={buyCost}
            onChange={(event) => setBuyCost(event.target.value)}
            disabled={pending}
            inputMode="decimal"
            placeholder="2000"
          />
        </label>
        <label>
          <span>Currency</span>
          <select value={targetCurrency} onChange={(event) => setTargetCurrency(event.target.value)} disabled={pending}>
            {["USD", "EUR", "GBP", "TRY"].map((cur) => <option key={cur} value={cur}>{cur}</option>)}
          </select>
        </label>
        <label>
          <span>Min margin %</span>
          <input
            value={minMarginPct}
            onChange={(event) => setMinMarginPct(event.target.value)}
            disabled={pending}
            inputMode="decimal"
            placeholder="floor"
          />
        </label>
      </div>

      <div className="pricing-scenario-toggles">
        <label>
          <input type="checkbox" checked={noTarget} onChange={(event) => setNoTarget(event.target.checked)} disabled={pending} />
          <span>No target confirmed</span>
        </label>
        <label>
          <input type="checkbox" checked={replaceExistingQuotes} onChange={(event) => setReplaceExistingQuotes(event.target.checked)} disabled={pending} />
          <span>Ignore existing quotes</span>
        </label>
      </div>

      <button type="button" className="btn btn-secondary record-wide-action pricing-scenario-run" onClick={runScenario} disabled={pending}>
        <Icon name="trending-up" size={13} />
        {pending ? "Simulating..." : "Run scenario"}
      </button>

      {error && <div className="record-helper-text quote-draft-error">{error}</div>}

      {result && (
        <div className={`pricing-scenario-result ${result.verdict.can_quote_customer ? "ready" : result.verdict.approval_required ? "review" : "blocked"}`}>
          <div className="pricing-scenario-verdict">
            <div>
              <span>Verdict</span>
              <strong>{result.verdict.quote_gate}</strong>
              <em>{result.verdict.operator_action}</em>
            </div>
            <div>
              <span>Guardrail</span>
              <strong>{result.verdict.guardrail.toLowerCase().replace("_", " ")}</strong>
              <em>{result.verdict.target_posture}</em>
            </div>
          </div>

          <div className="pricing-scenario-metrics">
            <div>
              <span>Recommended</span>
              <strong>{result.economics.recommended_price ?? "-"}</strong>
              <em>{signed(result.deltas.recommended_price)}</em>
            </div>
            <div>
              <span>Floor</span>
              <strong>{result.economics.floor_price ?? "-"}</strong>
              <em>{signed(result.deltas.floor_price)}</em>
            </div>
            <div>
              <span>Target margin</span>
              <strong>{result.economics.margin_at_target_pct == null ? "-" : `${result.economics.margin_at_target_pct.toFixed(1)}%`}</strong>
              <em>Target buy {result.economics.target_buy_limit_label ?? "-"}</em>
            </div>
            <div>
              <span>Decision grade</span>
              <strong>{result.current.strategy_grade.band} {"->"} {result.scenario.strategy_grade.band}</strong>
              <em>
                {result.deltas.band_changed || result.deltas.confidence_changed
                  ? `${result.current.strategy_grade.confidence} -> ${result.scenario.strategy_grade.confidence}`
                  : `Win ${signed(result.deltas.win_probability, "%")}`}
              </em>
            </div>
          </div>

          <div className="pricing-scenario-change">
            <span>{result.changed_decision.from.quote_gate}</span>
            <Icon name="arrow-right" size={13} />
            <strong>{result.changed_decision.to.quote_gate}</strong>
          </div>

          <p>{result.safety}</p>
        </div>
      )}
    </div>
  );
}
