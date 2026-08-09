"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type MarginProfile = { id: string; label: string; customerTier: string | null; urgency: string | null; marginPercent: number };
type Company = { id: string; name: string };
type CalcResult = {
  matchedLane: { origin: string; destination: string; mode: string; baseAmount: number; currency: string } | null;
  matchedMarginLabel: string | null;
  marginPercent: number;
  baseAmount: number;
  marginAmount: number;
  recommendedAmount: number;
  floorAmount: number;
  currency: string;
  warnings: string[];
};

type Props = {
  origins: string[];
  destinations: string[];
  modes: string[];
  marginProfiles: MarginProfile[];
  companies: Company[];
  calcResult: CalcResult | null;
  searchParams: { origin?: string; destination?: string; mode?: string; tier?: string; urgency?: string };
  createQuoteAction: (fd: FormData) => Promise<void>;
};

export function PricingCalculator({
  origins,
  destinations,
  modes,
  marginProfiles,
  companies,
  calcResult,
  searchParams,
  createQuoteAction,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [savePending, setSavePending] = useState(false);
  const [savedToCompany, setSavedToCompany] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);

  const [origin, setOrigin] = useState(searchParams.origin ?? "");
  const [destination, setDestination] = useState(searchParams.destination ?? "");
  const [mode, setMode] = useState(searchParams.mode ?? "");
  const [tier, setTier] = useState(searchParams.tier ?? "");
  const [urgency, setUrgency] = useState(searchParams.urgency ?? "");

  function calculate() {
    if (!origin || !destination || !mode) return;
    const params = new URLSearchParams();
    params.set("tab", "calculator");
    if (origin) params.set("origin", origin);
    if (destination) params.set("destination", destination);
    if (mode) params.set("mode", mode);
    if (tier) params.set("tier", tier);
    if (urgency) params.set("urgency", urgency);
    startTransition(() => { router.push(`/dashboard/pricing?${params}`); });
  }

  async function handleSaveQuote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavePending(true);
    const fd = new FormData(e.currentTarget);
    await createQuoteAction(fd);
    const companyId = String(fd.get("companyId"));
    const company = companies.find((c) => c.id === companyId);
    setSavedToCompany(company?.name ?? "company");
    setSavePending(false);
    setShowSaveForm(false);
  }

  const hasResult = calcResult !== null;
  const noLane = hasResult && !calcResult!.matchedLane;
  const hasPricedLane = !!calcResult?.baseAmount;

  return (
    <section className="card pricing-calculator">
      <header className="pricing-calculator-header">
        <h2 className="pricing-calculator-title">Rate calculator</h2>
        <p className="pricing-calculator-subtitle">Enter a route to price against lane rates and margin profiles.</p>
      </header>

      <div className="pricing-calculator-body">
        <div className="pricing-calculator-grid">
          <label className="field">
            <span>Origin</span>
            <input
              list="origin-list"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="e.g. Istanbul"
            />
            <datalist id="origin-list">{origins.map((o) => <option key={o} value={o} />)}</datalist>
          </label>
          <label className="field">
            <span>Destination</span>
            <input
              list="dest-list"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. Hamburg"
            />
            <datalist id="dest-list">{destinations.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
          <label className="field">
            <span>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Select mode</option>
              {modes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Client tier</span>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">Any</option>
              <option value="new">New</option>
              <option value="existing">Existing</option>
              <option value="vip">VIP</option>
            </select>
          </label>
          <label className="field">
            <span>Urgency</span>
            <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              <option value="">Any</option>
              <option value="flexible">Flexible</option>
              <option value="normal">Normal</option>
              <option value="asap">ASAP</option>
            </select>
          </label>
          <button
            type="button"
            onClick={calculate}
            disabled={!origin || !destination || !mode || isPending}
          >
            {isPending ? "..." : "Calculate"}
          </button>
        </div>

        {hasResult && (
          <div className="pricing-calc-result">
            {calcResult!.warnings.length > 0 && (
              <div className="pricing-alert-stack">
                {calcResult!.warnings.map((w) => (
                  <div key={w} className="pricing-alert">
                    <span aria-hidden>!</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="pricing-result-grid">
              <div className="pricing-result-panel">
                <div className="pricing-result-label">Breakdown</div>
                <div className="pricing-breakdown">
                  <div className="pricing-breakdown-row">
                    <span>Base rate</span>
                    <strong>{noLane ? "-" : `${calcResult!.baseAmount.toLocaleString()} ${calcResult!.currency}`}</strong>
                  </div>
                  <div className="pricing-breakdown-row">
                    <span>Margin ({calcResult!.marginPercent}%)</span>
                    <strong>{noLane ? "-" : `+${calcResult!.marginAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${calcResult!.currency}`}</strong>
                  </div>
                  <div className="pricing-breakdown-row total">
                    <span>Floor (min)</span>
                    <strong>{noLane ? "-" : `${calcResult!.floorAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${calcResult!.currency}`}</strong>
                  </div>
                </div>
              </div>

              <div className="pricing-result-panel">
                <div className="pricing-result-label">Lane matched</div>
                {calcResult!.matchedLane ? (
                  <>
                    <div className="pricing-match-title">
                      {calcResult!.matchedLane.origin} to {calcResult!.matchedLane.destination}
                    </div>
                    <div className="pricing-match-meta">{calcResult!.matchedLane.mode}</div>
                  </>
                ) : (
                  <div className="pricing-match-missing">No match found</div>
                )}
                {calcResult!.matchedMarginLabel && (
                  <div className="pricing-match-meta">Margin: {calcResult!.matchedMarginLabel}</div>
                )}
              </div>

              <div className={["pricing-result-panel", hasPricedLane ? "dark" : ""].filter(Boolean).join(" ")}>
                <div className="pricing-result-label">Recommended quote</div>
                {hasPricedLane ? (
                  <>
                    <div className="pricing-recommended-amount">
                      {calcResult!.recommendedAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="pricing-recommended-currency">{calcResult!.currency}</div>
                  </>
                ) : (
                  <div className="pricing-save-muted">Add a lane rate first.</div>
                )}
              </div>

              {hasPricedLane && (
                <div>
                  {savedToCompany ? (
                    <div className="pricing-save-success">Saved to {savedToCompany}</div>
                  ) : showSaveForm ? (
                    <form onSubmit={handleSaveQuote} className="pricing-save-form">
                      <input type="hidden" name="origin" value={calcResult!.matchedLane?.origin ?? origin} />
                      <input type="hidden" name="destination" value={calcResult!.matchedLane?.destination ?? destination} />
                      <input type="hidden" name="mode" value={mode} />
                      <input type="hidden" name="value" value={calcResult!.recommendedAmount.toFixed(0)} />
                      <input type="hidden" name="currency" value={calcResult!.currency} />
                      <select name="companyId" required>
                        <option value="">Select company...</option>
                        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <input name="notes" placeholder="Notes (optional)" />
                      <div className="pricing-save-actions">
                        <button type="submit" disabled={savePending}>{savePending ? "Saving..." : "Save quote"}</button>
                        <button type="button" className="btn btn-secondary" onClick={() => setShowSaveForm(false)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={() => setShowSaveForm(true)}>
                      Save as quote
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
