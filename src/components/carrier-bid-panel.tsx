"use client";

import { useState, useTransition } from "react";
import {
  createCarrierBidAction,
  deleteCarrierBidAction,
  recordTruckloadQuoteAction,
  selectCarrierBidAction,
  updateCarrierBidAction,
  updateQuoteOutcomeReasonAction,
  type CarrierBidPatch,
  type RecordedQuoteRow,
} from "@/app/dashboard/rfq/[inquiryId]/actions";
import {
  CARRIER_BID_SOURCES,
  CARRIER_BID_STATUSES,
  QUOTE_OUTCOMES,
  QUOTE_OUTCOME_REASONS,
  type CarrierBidRow,
} from "@/lib/truckload-quote-fields";
import { CARRIER_EQUIPMENT_TYPES } from "@/lib/carrier-vetting";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

function money(value: number | null): string {
  return value != null ? `$${value.toLocaleString("en-US")}` : "-";
}

// The truckload desk on an RFQ: capture carrier bids (buy side), pick the
// winner, and snapshot issued quotes into the flywheel. Outcomes settle from
// the RFQ status (Booked => won, Missed => lost).
export function CarrierBidPanel({
  inquiryId,
  initialBids,
  initialQuotes,
  benchCarrierNames,
}: {
  inquiryId: string;
  initialBids: CarrierBidRow[];
  initialQuotes: RecordedQuoteRow[];
  benchCarrierNames: string[];
}) {
  const [bids, setBids] = useState(initialBids);
  const [quotes, setQuotes] = useState(initialQuotes);
  const [draft, setDraft] = useState<{ carrierName: string; totalAmount: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [busy, startTransition] = useTransition();

  function flash(message: string) {
    setError(message);
    setTimeout(() => setError(null), 6000);
  }

  function fail(message?: string) {
    flash(message ?? "Could not save - check your connection and try again.");
    setRev((r) => r + 1);
  }

  function commitBid(bid: CarrierBidRow, patch: CarrierBidPatch) {
    startTransition(async () => {
      try {
        const res = await updateCarrierBidAction(bid.id, patch);
        if ("error" in res) return fail(res.error);
        setBids((prev) => prev.map((b) => (b.id === bid.id ? res.bid : b)));
      } catch {
        fail();
      }
    });
  }

  function selectBid(bid: CarrierBidRow) {
    startTransition(async () => {
      try {
        const res = await selectCarrierBidAction(bid.id);
        if ("error" in res) return fail(res.error);
        setBids((prev) =>
          prev.map((b) => (b.id === bid.id ? res.bid : b.status === "SELECTED" ? { ...b, status: "RECEIVED" } : b))
        );
      } catch {
        fail();
      }
    });
  }

  function removeBid(bid: CarrierBidRow) {
    if (!window.confirm(`Delete the ${bid.carrierName} bid?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteCarrierBidAction(bid.id);
        if ("error" in res) return fail(res.error);
        setBids((prev) => prev.filter((b) => b.id !== bid.id));
      } catch {
        fail();
      }
    });
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.carrierName.trim()) return flash("Carrier name is required.");
    startTransition(async () => {
      try {
        const res = await createCarrierBidAction(inquiryId, {
          carrierName: draft.carrierName,
          totalAmount: draft.totalAmount,
        });
        if ("error" in res) return fail(res.error);
        setBids((prev) => [res.bid, ...prev]);
        setDraft(null);
      } catch {
        fail();
      }
    });
  }

  function recordQuote() {
    startTransition(async () => {
      try {
        const res = await recordTruckloadQuoteAction(inquiryId);
        if ("error" in res) return fail(res.error);
        setQuotes((prev) => [res.quote, ...prev]);
      } catch {
        fail();
      }
    });
  }

  function commitReason(quote: RecordedQuoteRow, reason: string) {
    startTransition(async () => {
      try {
        const res = await updateQuoteOutcomeReasonAction(quote.id, reason);
        if ("error" in res) return fail(res.error);
        setQuotes((prev) => prev.map((q) => (q.id === quote.id ? { ...q, outcomeReason: reason || null } : q)));
      } catch {
        fail();
      }
    });
  }

  const outcomeLabel = new Map<string, string>(QUOTE_OUTCOMES.map(([v, l]) => [v, l]));

  return (
    <div className="record-panel">
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icon name="truck" size={15} />
          <div className="record-card-title">Truckload desk</div>
          <span style={{ fontSize: 12, opacity: 0.6 }}>carrier bids + recorded quotes</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button type="button" className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setDraft(draft ? null : { carrierName: "", totalAmount: "" })}>
              <Icon name="plus" size={12} strokeWidth={2.5} /> Bid
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={recordQuote}
              title="Snapshot the current domestic draft economics into the quote flywheel"
            >
              <Icon name="dollar" size={12} strokeWidth={2.5} /> Record quote
            </button>
          </div>
        </div>
        {error && <span className="sheet-error">{error}</span>}

        {(bids.length > 0 || draft) && (
          <div className="table-shell">
            <table className="data-table">
              <colgroup>
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 64 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 64 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Carrier</th><th>Equipment</th><th>Bid (all-in)</th><th>$/mi</th><th>Days</th><th>Source</th><th>Status</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {draft && (
                  <tr className="sheet-draft-row">
                    <td>
                      <input
                        className="sheet-input"
                        placeholder="Carrier name *"
                        list="bench-carrier-names"
                        autoFocus
                        value={draft.carrierName}
                        onChange={(e) => setDraft({ ...draft, carrierName: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && saveDraft()}
                      />
                    </td>
                    <td colSpan={5}>
                      <input
                        className="sheet-input"
                        placeholder="All-in bid, e.g. 2450"
                        value={draft.totalAmount}
                        onChange={(e) => setDraft({ ...draft, totalAmount: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && saveDraft()}
                      />
                    </td>
                    <td>
                      <button type="button" className="btn btn-sm" disabled={busy} onClick={saveDraft}>Save</button>
                    </td>
                    <td>
                      <button type="button" className="sheet-del" title="Discard" onClick={() => setDraft(null)}>
                        <Icon name="x" size={13} />
                      </button>
                    </td>
                  </tr>
                )}
                {bids.map((bid) => (
                  <tr key={bid.id} style={bid.status === "SELECTED" ? { fontWeight: 600 } : undefined}>
                    <td title={bid.carrierVettingStatus ? `Bench: ${bid.carrierVettingStatus}` : "Not on the vetted bench"}>
                      <CellInput key={`c${bid.id}:${rev}:${bid.carrierName}`} value={bid.carrierName} list="bench-carrier-names" onCommit={(v) => commitBid(bid, { carrierName: v })} />
                      {bid.carrierVettingStatus === "approved" && (
                        <span title="Vetted bench carrier" style={{ marginLeft: 4, color: "var(--success, #2e7d32)" }}>
                          <Icon name="shield" size={11} />
                        </span>
                      )}
                    </td>
                    <td>
                      <CellSelect key={`e${bid.id}:${rev}:${bid.equipmentType ?? ""}`} value={bid.equipmentType} options={CARRIER_EQUIPMENT_TYPES} allowEmpty onCommit={(v) => commitBid(bid, { equipmentType: v })} />
                    </td>
                    <td className="numeric">
                      <CellInput key={`t${bid.id}:${rev}:${bid.totalAmount ?? ""}`} value={bid.totalAmount != null ? String(bid.totalAmount) : null} placeholder="USD" onCommit={(v) => commitBid(bid, { totalAmount: v })} />
                    </td>
                    <td className="numeric">
                      <CellInput key={`r${bid.id}:${rev}:${bid.ratePerMile ?? ""}`} value={bid.ratePerMile != null ? String(bid.ratePerMile) : null} onCommit={(v) => commitBid(bid, { ratePerMile: v })} />
                    </td>
                    <td className="numeric">
                      <CellInput key={`d${bid.id}:${rev}:${bid.transitDays ?? ""}`} value={bid.transitDays != null ? String(bid.transitDays) : null} onCommit={(v) => commitBid(bid, { transitDays: v })} />
                    </td>
                    <td>
                      <CellSelect key={`s${bid.id}:${rev}:${bid.source}`} value={bid.source} options={CARRIER_BID_SOURCES} onCommit={(v) => commitBid(bid, { source: v })} />
                    </td>
                    <td>
                      <CellSelect key={`st${bid.id}:${rev}:${bid.status}`} value={bid.status} options={CARRIER_BID_STATUSES} onCommit={(v) => commitBid(bid, { status: v })} />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 2 }}>
                        <button
                          type="button"
                          className="sheet-del"
                          title="Select this bid - wins the buy side, sets load cost"
                          disabled={busy || bid.status === "SELECTED"}
                          onClick={() => selectBid(bid)}
                        >
                          <Icon name="check" size={13} />
                        </button>
                        <button type="button" className="sheet-del" title="Delete bid" onClick={() => removeBid(bid)}>
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <datalist id="bench-carrier-names">
          {benchCarrierNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        {quotes.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.55, marginBottom: 6 }}>
              Recorded quotes
            </div>
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th><th>Sell</th><th>Buy</th><th>GP</th><th>Margin</th><th>Outcome</th><th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td style={{ fontSize: 12, opacity: 0.7 }}>
                        {new Date(quote.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </td>
                      <td className="numeric">{money(quote.sellAmount)}</td>
                      <td className="numeric">{money(quote.buyAmount)}</td>
                      <td className="numeric">{money(quote.grossProfit)}</td>
                      <td className="numeric">{quote.marginPct != null ? `${quote.marginPct}%` : "-"}</td>
                      <td>{outcomeLabel.get(quote.outcome) ?? quote.outcome}</td>
                      <td>
                        {quote.outcome === "LOST" || quote.outcome === "NO_QUOTE" ? (
                          <CellSelect
                            key={`qr${quote.id}:${rev}:${quote.outcomeReason ?? ""}`}
                            value={quote.outcomeReason}
                            options={QUOTE_OUTCOME_REASONS}
                            allowEmpty
                            onCommit={(v) => commitReason(quote, v)}
                          />
                        ) : (
                          <span style={{ opacity: 0.4 }}>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>
          Quotes settle automatically when the RFQ is marked Booked (won) or Missed (lost). Buy rates feed the lane memory.
        </p>
      </div>
    </div>
  );
}
