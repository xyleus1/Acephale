"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { resolveQuoteAction } from "@/app/dashboard/activity/actions";

type Quote = {
  id: string;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  value: number | null;
  currency: string | null;
  quotedAt: string;
  company: { id: string; name: string };
};

export function PendingQuotesInline({
  quotes,
  now,
  labels,
}: {
  quotes: Quote[];
  now: string;
  labels: { colCompany: string; colRoute: string; colSent: string };
}) {
  const [items, setItems] = useState(quotes);
  const [resolving, setResolving] = useState<string | null>(null);

  async function handleResolve(quoteId: string, result: "WON" | "LOST") {
    setResolving(quoteId);
    setItems((prev) => prev.filter((q) => q.id !== quoteId));
    await resolveQuoteAction(quoteId, result);
    setResolving(null);
  }

  const nowMs = new Date(now).getTime();

  function daysSince(dateStr: string) {
    return Math.floor((nowMs - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: "16px 20px", color: "var(--text-3)", fontSize: 13 }}>
        No pending quotes.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table style={{ border: "none", borderTop: "1px solid var(--border)", borderRadius: 0 }}>
        <thead>
          <tr>
            <th>{labels.colCompany}</th>
            <th>{labels.colRoute}</th>
            <th>Value</th>
            <th>{labels.colSent}</th>
            <th style={{ width: 120 }}>Resolve</th>
          </tr>
        </thead>
        <tbody>
          {items.map((q) => {
            const d = daysSince(q.quotedAt);
            const isResolving = resolving === q.id;
            return (
              <tr key={q.id} style={{ opacity: isResolving ? 0.5 : 1 }}>
                <td>
                  <Link href={`/dashboard/crm/companies/${q.company.id}`} style={{ color: "var(--brand)", fontWeight: 500 }}>
                    {q.company.name}
                  </Link>
                </td>
                <td style={{ fontSize: 12, color: "var(--text-2)" }}>
                  {q.origin && q.destination
                    ? `${q.origin} → ${q.destination}`
                    : q.origin ?? q.destination ?? "—"}
                  {q.mode && (
                    <span style={{ marginLeft: 6, fontSize: 10, background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px" }}>
                      {q.mode}
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 13, fontWeight: 500 }}>
                  {q.value ? `${q.value.toLocaleString()} ${q.currency ?? ""}`.trim() : "—"}
                </td>
                <td style={{ fontSize: 12, color: d >= 5 ? "var(--danger)" : d >= 2 ? "var(--warning)" : "var(--text-3)", fontWeight: d >= 5 ? 600 : 400 }}>
                  {d === 0 ? "Today" : `${d}d ago`}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      disabled={isResolving}
                      onClick={() => handleResolve(q.id, "WON")}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid var(--success, #1f5d43)",
                        background: "transparent",
                        color: "var(--success, #1f5d43)",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Won
                    </button>
                    <button
                      type="button"
                      disabled={isResolving}
                      onClick={() => handleResolve(q.id, "LOST")}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "1px solid var(--danger)",
                        background: "transparent",
                        color: "var(--danger)",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Lost
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
