"use client";

import { useState, useTransition } from "react";
import { updateLoadSecurityCheckAction } from "@/app/dashboard/jobs/[jobId]/actions";
import {
  LOAD_SECURITY_CHECKLIST,
  LOAD_SECURITY_CHECK_STATUSES,
  securityTierLabel,
} from "@/lib/security-sop";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

const CHECK_HINTS = new Map(LOAD_SECURITY_CHECKLIST.map((item) => [item.key, item.hint]));

export type LoadSecurityCheckRow = {
  id: string;
  key: string;
  label: string;
  status: string;
  note: string | null;
  completedAt: string | null;
};

// The operator half of the security SOP trust artifact: seeded from the
// load's tier, worked through before dispatch. A customer-safe rendering
// lands on the portal in a later phase.
export function LoadSecurityCard({
  securityTier,
  declaredValue,
  declaredValueCurrency,
  initialChecks,
}: {
  securityTier: string | null;
  declaredValue: number | null;
  declaredValueCurrency: string | null;
  initialChecks: LoadSecurityCheckRow[];
}) {
  const [checks, setChecks] = useState(initialChecks);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [, startTransition] = useTransition();

  if (!securityTier && checks.length === 0) return null;

  const done = checks.filter((c) => c.status === "done" || c.status === "na").length;
  const flagged = checks.filter((c) => c.status === "flagged").length;

  function flash(message: string) {
    setError(message);
    setTimeout(() => setError(null), 6000);
  }

  function commit(check: LoadSecurityCheckRow, patch: { status?: string; note?: string }) {
    startTransition(async () => {
      try {
        const res = await updateLoadSecurityCheckAction(check.id, patch);
        if ("error" in res) {
          flash(res.error);
          setRev((r) => r + 1);
          return;
        }
        setChecks((prev) =>
          prev.map((c) =>
            c.id === check.id ? { ...c, status: res.status, note: res.note, completedAt: res.completedAt } : c
          )
        );
      } catch {
        flash("Could not save - check your connection and try again.");
        setRev((r) => r + 1);
      }
    });
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name="shield" size={15} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Security SOP</span>
        <span style={{ fontSize: 12, opacity: 0.65 }}>
          {securityTierLabel(securityTier)}
          {declaredValue != null && ` · declared ${declaredValueCurrency ?? "USD"} ${declaredValue.toLocaleString("en-US")}`}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: flagged > 0 ? "var(--danger)" : undefined }}>
          {flagged > 0 ? `${flagged} flagged · ` : ""}
          {done}/{checks.length} done
        </span>
      </div>
      {error && <span className="sheet-error">{error}</span>}
      {checks.length === 0 ? (
        <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>
          No checklist for this tier - raise the security tier in Edit to seed the SOP.
        </p>
      ) : (
        <div className="table-shell">
          <table className="data-table">
            <colgroup>
              <col />
              <col style={{ width: 96 }} />
              <col style={{ width: 200 }} />
            </colgroup>
            <tbody>
              {checks.map((check) => (
                <tr key={check.id}>
                  <td
                    title={CHECK_HINTS.get(check.key) ?? undefined}
                    style={check.status === "done" || check.status === "na" ? { opacity: 0.55 } : undefined}
                  >
                    {check.label}
                  </td>
                  <td>
                    <CellSelect
                      key={`s${check.id}:${rev}:${check.status}`}
                      value={check.status}
                      options={LOAD_SECURITY_CHECK_STATUSES}
                      onCommit={(v) => commit(check, { status: v })}
                    />
                  </td>
                  <td>
                    <CellInput
                      key={`n${check.id}:${rev}:${check.note ?? ""}`}
                      value={check.note}
                      placeholder="Seal #, driver, evidence…"
                      onCommit={(v) => commit(check, { note: v })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
