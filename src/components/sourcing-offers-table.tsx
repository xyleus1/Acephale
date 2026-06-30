"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { extractSourcingOffersForInquiry } from "@/lib/sourcing-offers";
import { awardSupplier, draftReplyToMessage, draftCounterOffer } from "@/lib/sourcing-award";
import { DraftModal } from "@/components/draft-modal";

type Offer = {
  supplierName?: string | null;
  pricePerUnit?: number | null;
  currency?: string | null;
  unit?: string | null;
  qtyAvailable?: string | null;
  incoterms?: string | null;
  paymentTerms?: string | null;
  origin?: string | null;
  leadTime?: string | null;
  validity?: string | null;
  sampleAvailable?: boolean | null;
  notes?: string | null;
  hasNoOffer?: boolean;
};

type Row = {
  threadId: string;
  threadSubject: string;
  fromEmail: string | null;
  lastMessageAt: string;
  awardedAt: string | null;
  offer: Offer | null;
};

export function SourcingOffersTable({ inquiryId, rows }: { inquiryId: string; rows: Row[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [awardModal, setAwardModal] = useState<{ threadId: string; supplierName: string; draft: string; replyTo: string | null } | null>(null);
  const [replyModal, setReplyModal] = useState<{ threadId: string; supplierName: string; draft: string; replyTo: string | null } | null>(null);
  const [counterModal, setCounterModal] = useState<{ threadId: string; supplierName: string; draft: string; replyTo: string | null } | null>(null);
  const [counterPrompt, setCounterPrompt] = useState<{ threadId: string; supplierName: string } | null>(null);
  const [counterTarget, setCounterTarget] = useState("");
  // Operator-entered freight rate per unit (USD); same unit as supplier offers
  // (assume MT for procurement; this is a back-of-envelope landed cost).
  const [freightPerUnit, setFreightPerUnit] = useState<string>("");

  function refresh() {
    start(async () => {
      await extractSourcingOffersForInquiry(inquiryId);
      router.refresh();
    });
  }
  function award(row: Row) {
    if (!confirm(`Award the deal to ${row.offer?.supplierName ?? row.fromEmail ?? "this supplier"}? This sets the job to "Awarded" and drafts a confirmation email.`)) return;
    start(async () => {
      const r = await awardSupplier(row.threadId);
      if ("error" in r) { alert(r.error); return; }
      setAwardModal({
        threadId: row.threadId,
        supplierName: row.offer?.supplierName ?? row.fromEmail ?? "Supplier",
        draft: r.emailDraft,
        replyTo: row.fromEmail,
      });
      router.refresh();
    });
  }
  function counter(row: Row) {
    setCounterPrompt({ threadId: row.threadId, supplierName: row.offer?.supplierName ?? row.fromEmail ?? "Supplier" });
    setCounterTarget("");
  }
  function runCounter() {
    if (!counterPrompt) return;
    const target = counterTarget.trim() || "5% under their current price";
    start(async () => {
      const r = await draftCounterOffer({ threadId: counterPrompt.threadId, target });
      if ("error" in r) { alert(r.error); return; }
      setCounterModal({
        threadId: counterPrompt.threadId,
        supplierName: counterPrompt.supplierName,
        draft: r.draft,
        replyTo: r.replyTo,
      });
      setCounterPrompt(null);
    });
  }
  function draftReply(row: Row, intent?: string) {
    start(async () => {
      const r = await draftReplyToMessage({ threadId: row.threadId, intent });
      if ("error" in r) { alert(r.error); return; }
      setReplyModal({
        threadId: row.threadId,
        supplierName: row.offer?.supplierName ?? row.fromEmail ?? "Supplier",
        draft: r.draft,
        replyTo: r.replyTo,
      });
    });
  }

  const freight = parseFloat(freightPerUnit) || 0;
  const landed = (o: Offer | null) => {
    if (!o?.pricePerUnit) return null;
    return o.pricePerUnit + (freight || 0);
  };

  // Sort by landed (price + freight) when freight set, else by price.
  const sorted = [...rows].sort((a, b) => {
    const akey = (freight ? landed(a.offer) : a.offer?.pricePerUnit) ?? Infinity;
    const bkey = (freight ? landed(b.offer) : b.offer?.pricePerUnit) ?? Infinity;
    return akey - bkey;
  });

  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="section-title">Supplier Offers</div>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              No supplier email threads linked to this sourcing inquiry yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const fmtPrice = (o: Offer | null) =>
    o?.pricePerUnit != null ? `${o.currency ?? ""} ${o.pricePerUnit.toLocaleString()}${o.unit ? `/${o.unit}` : ""}`.trim() : "—";

  return (
    <div className="card">
      <div className="card-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div className="section-title">Supplier Offers</div>
            <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
              {rows.length} supplier thread{rows.length === 1 ? "" : "s"} · cheapest first when priced
            </p>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 11, color: "var(--text-3)", display: "inline-flex", alignItems: "center", gap: 4 }} title="Freight per unit added to each offer for landed-cost ranking">
              + freight
              <input
                type="number"
                value={freightPerUnit}
                onChange={(e) => setFreightPerUnit(e.target.value)}
                placeholder="0/unit"
                style={{
                  width: 78, padding: "4px 6px",
                  border: "1px solid var(--border)", borderRadius: 3,
                  fontSize: 11.5, background: "var(--surface)",
                }}
              />
            </label>
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icon name="sparkles" size={11} />
              {busy ? "Extracting…" : "Re-extract with AI"}
            </button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
                <Th>Supplier</Th>
                <Th>Price</Th>
                {freight > 0 && <Th>Landed</Th>}
                <Th>Qty</Th>
                <Th>Origin</Th>
                <Th>Incoterms</Th>
                <Th>Payment</Th>
                <Th>Lead</Th>
                <Th>Valid</Th>
                <Th>Sample</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const o = r.offer;
                const isBest = i === 0 && o?.pricePerUnit != null;
                return (
                  <tr
                    key={r.threadId}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: isBest ? "var(--brand-light)" : undefined,
                    }}
                  >
                    <Td>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>
                        {o?.supplierName ?? r.fromEmail ?? "—"}
                        {isBest && (
                          <span style={{
                            marginLeft: 6, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                            background: "var(--brand)", color: "#fff",
                            textTransform: "uppercase", letterSpacing: "0.06em",
                          }}>BEST</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{r.threadSubject}</div>
                    </Td>
                    <Td><span style={{ fontWeight: 600 }}>{fmtPrice(o)}</span></Td>
                    {freight > 0 && (
                      <Td>
                        {landed(o) != null ? (
                          <span style={{ fontWeight: 700, color: "var(--brand)" }}>
                            {o?.currency ?? ""} {Math.round(landed(o)!).toLocaleString()}{o?.unit ? `/${o.unit}` : ""}
                          </span>
                        ) : "—"}
                      </Td>
                    )}
                    <Td>{o?.qtyAvailable ?? "—"}</Td>
                    <Td>{o?.origin ?? "—"}</Td>
                    <Td>{o?.incoterms ?? "—"}</Td>
                    <Td>{o?.paymentTerms ?? "—"}</Td>
                    <Td>{o?.leadTime ?? "—"}</Td>
                    <Td>{o?.validity ?? "—"}</Td>
                    <Td>
                      {o?.sampleAvailable === true ? <Icon name="check" size={12} /> :
                        o?.sampleAvailable === false ? <span style={{ color: "var(--text-3)" }}>no</span> : "—"}
                    </Td>
                    <Td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                        {r.awardedAt ? (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                            background: "var(--brand)", color: "#fff",
                            textTransform: "uppercase", letterSpacing: "0.06em",
                          }}>Awarded</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => award(r)}
                            disabled={busy}
                            style={{
                              fontSize: 10.5, fontWeight: 600, padding: "3px 8px", borderRadius: 3,
                              background: "var(--brand)", color: "#fff", border: "none", cursor: "pointer",
                            }}
                          >Award</button>
                        )}
                        <button
                          type="button"
                          onClick={() => draftReply(r)}
                          disabled={busy}
                          style={{
                            fontSize: 10.5, padding: "2px 6px", borderRadius: 3,
                            background: "transparent", color: "var(--brand)", border: "1px solid var(--brand-border)", cursor: "pointer",
                          }}
                        >AI reply</button>
                        <button
                          type="button"
                          onClick={() => counter(r)}
                          disabled={busy || !r.offer?.pricePerUnit}
                          title={r.offer?.pricePerUnit ? "AI counter-offer at a target price" : "Need a parsed price first"}
                          style={{
                            fontSize: 10.5, padding: "2px 6px", borderRadius: 3,
                            background: "transparent", color: "var(--text-2)",
                            border: "1px solid var(--border)",
                            cursor: r.offer?.pricePerUnit ? "pointer" : "not-allowed",
                            opacity: r.offer?.pricePerUnit ? 1 : 0.5,
                          }}
                        >Counter</button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {awardModal && (
        <DraftModal
          title={`Award confirmation — ${awardModal.supplierName}`}
          subtitle={awardModal.replyTo ? `To: ${awardModal.replyTo}` : ""}
          draft={awardModal.draft}
          threadDbId={awardModal.threadId}
          replyTo={awardModal.replyTo}
          onClose={() => setAwardModal(null)}
        />
      )}
      {replyModal && (
        <DraftModal
          title={`Reply draft — ${replyModal.supplierName}`}
          subtitle={replyModal.replyTo ? `To: ${replyModal.replyTo}` : ""}
          draft={replyModal.draft}
          threadDbId={replyModal.threadId}
          replyTo={replyModal.replyTo}
          onClose={() => setReplyModal(null)}
        />
      )}
      {counterModal && (
        <DraftModal
          title={`Counter-offer — ${counterModal.supplierName}`}
          subtitle={counterModal.replyTo ? `To: ${counterModal.replyTo}` : ""}
          draft={counterModal.draft}
          threadDbId={counterModal.threadId}
          replyTo={counterModal.replyTo}
          onClose={() => setCounterModal(null)}
        />
      )}
      {counterPrompt && (
        <div onClick={() => setCounterPrompt(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--surface)", borderRadius: 8, width: "min(440px, 92vw)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
          }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Counter-offer to {counterPrompt.supplierName}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>What's your target?</div>
            </div>
            <div style={{ padding: 18 }}>
              <input
                type="text"
                autoFocus
                value={counterTarget}
                onChange={(e) => setCounterTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runCounter(); if (e.key === "Escape") setCounterPrompt(null); }}
                placeholder="$480/MT, 5% under best, match cheapest…"
                style={{
                  width: "100%", padding: "8px 12px",
                  border: "1px solid var(--border-strong)", borderRadius: 4,
                  fontSize: 13, outline: "none", background: "var(--surface)",
                }}
              />
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setCounterPrompt(null)} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>Cancel</button>
                <button onClick={runCounter} disabled={busy} className="btn btn-sm" style={{ fontSize: 12 }}>
                  {busy ? "Drafting…" : "Draft counter-offer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "8px 10px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "8px 10px", verticalAlign: "top", color: "var(--text)" }}>{children}</td>;
}
