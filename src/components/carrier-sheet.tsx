"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  createCarrierAction,
  deleteCarrierAction,
  updateCarrierAction,
  type CarrierPatch,
} from "@/app/dashboard/carriers/actions";
import { CARRIER_VETTING_STATUSES, insuranceExpiryState } from "@/lib/carrier-vetting";
import { carrierRowFromDetail, type CarrierRow } from "@/lib/carrier-fields";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

type SortKey =
  | "name"
  | "mcNumber"
  | "dotNumber"
  | "vettingStatus"
  | "cargoLimit"
  | "cargoInsuranceExpiry"
  | "homeBase"
  | "scorecardScore";

const COLUMNS: Array<{ key: SortKey | "badges"; label: string; width?: number }> = [
  { key: "name", label: "Carrier", width: 170 },
  { key: "mcNumber", label: "MC #", width: 90 },
  { key: "dotNumber", label: "DOT #", width: 95 },
  { key: "vettingStatus", label: "Vetting", width: 125 },
  { key: "badges", label: "Capabilities", width: 170 },
  { key: "cargoLimit", label: "Cargo limit", width: 100 },
  { key: "cargoInsuranceExpiry", label: "Cargo ins. expiry", width: 120 },
  { key: "homeBase", label: "Home base", width: 130 },
  { key: "scorecardScore", label: "Score", width: 60 },
];

const NUMERIC_KEYS: SortKey[] = ["cargoLimit", "scorecardScore"];

function fmtExpiry(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtMoney(value: number | null): string {
  if (value == null) return "";
  return String(value);
}

type Draft = Record<"name" | "mcNumber" | "dotNumber" | "homeBase", string>;

const EMPTY_DRAFT: Draft = { name: "", mcNumber: "", dotNumber: "", homeBase: "" };

export function CarrierSheet({ initialRows }: { initialRows: CarrierRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [q, setQ] = useState("");
  const [statusTab, setStatusTab] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyCounts, setBusyCounts] = useState<Record<string, number>>({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  const now = useMemo(() => new Date(), []);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row.vettingStatus] = (byStatus[row.vettingStatus] ?? 0) + 1;
    return byStatus;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows;
    if (statusTab !== "all") out = out.filter((r) => r.vettingStatus === statusTab);
    if (needle) {
      out = out.filter((r) =>
        [r.name, r.mcNumber, r.dotNumber, r.homeBase, ...r.badges.map((b) => b.label)]
          .some((v) => v && v.toLowerCase().includes(needle))
      );
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        if (NUMERIC_KEYS.includes(sortKey)) {
          const av = a[sortKey] as number | null;
          const bv = b[sortKey] as number | null;
          if (av == null && bv == null) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av - bv) * sortDir;
        }
        if (sortKey === "cargoInsuranceExpiry") {
          const av = a.cargoInsuranceExpiry ? Date.parse(a.cargoInsuranceExpiry) : null;
          const bv = b.cargoInsuranceExpiry ? Date.parse(b.cargoInsuranceExpiry) : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * sortDir;
        }
        const av = ((a[sortKey] as string | null) ?? "").toLowerCase();
        const bv = ((b[sortKey] as string | null) ?? "").toLowerCase();
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av.localeCompare(bv) * sortDir;
      });
    }
    return out;
  }, [rows, q, statusTab, sortKey, sortDir]);

  function flash(message: string) {
    setError(message);
    setTimeout(() => setError(null), 6000);
  }

  function markBusy(id: string, busy: boolean) {
    setBusyCounts((prev) => {
      const next = { ...prev };
      const n = (next[id] ?? 0) + (busy ? 1 : -1);
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
    });
  }

  function revertCells(rowId: string, fields: string[]) {
    setRevisions((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        const key = `${rowId}:${field}`;
        next[key] = (next[key] ?? 0) + 1;
      }
      return next;
    });
  }

  function commit(row: CarrierRow, patch: CarrierPatch) {
    markBusy(row.id, true);
    startTransition(async () => {
      try {
        const res = await updateCarrierAction(row.id, patch);
        if ("error" in res) {
          flash(res.error);
          revertCells(row.id, Object.keys(patch));
          return;
        }
        const nextRow = carrierRowFromDetail(res.detail);
        setRows((prev) => prev.map((r) => (r.id === row.id ? nextRow : r)));
      } catch {
        flash("Could not save — check your connection and try again.");
        revertCells(row.id, Object.keys(patch));
      } finally {
        markBusy(row.id, false);
      }
    });
  }

  function remove(row: CarrierRow) {
    if (!window.confirm(`Remove ${row.name} from the bench? Vetting history is deleted too.`)) return;
    markBusy(row.id, true);
    startTransition(async () => {
      try {
        const res = await deleteCarrierAction(row.id);
        if ("error" in res) {
          flash(res.error);
          return;
        }
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } catch {
        flash("Could not delete — check your connection and try again.");
      } finally {
        markBusy(row.id, false);
      }
    });
  }

  function saveDraft() {
    if (!draft || savingDraft) return;
    if (!draft.name.trim()) {
      flash("Carrier name is required.");
      return;
    }
    setSavingDraft(true);
    startTransition(async () => {
      try {
        const res = await createCarrierAction({
          name: draft.name,
          mcNumber: draft.mcNumber,
          dotNumber: draft.dotNumber,
          homeBase: draft.homeBase,
        });
        if ("error" in res) {
          flash(res.error);
          return;
        }
        setRows((prev) => [carrierRowFromDetail(res.detail), ...prev]);
        setDraft(null);
      } catch {
        flash("Could not add the carrier — check your connection and try again.");
      } finally {
        setSavingDraft(false);
      }
    });
  }

  function header(col: (typeof COLUMNS)[number]) {
    const sortable = col.key !== "badges";
    const active = sortKey === col.key;
    return (
      <th
        key={col.key}
        style={sortable ? undefined : { cursor: "default" }}
        className={active ? "active" : undefined}
        onClick={
          sortable
            ? () => {
                if (active) setSortDir((d) => (d === 1 ? -1 : 1));
                else {
                  setSortKey(col.key as SortKey);
                  setSortDir(1);
                }
              }
            : undefined
        }
      >
        {col.label}
        {active ? (sortDir === 1 ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  const tabs: Array<[string, string]> = [
    ["all", `All (${rows.length})`],
    ...CARRIER_VETTING_STATUSES.filter(([v]) => counts[v]).map(
      ([v, label]) => [v, `${label} (${counts[v]})`] as [string, string]
    ),
  ];

  return (
    <div className="contact-sheet">
      <div className="mode-tabs" style={{ marginBottom: 12 }}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`mode-tab${statusTab === key ? " active" : ""}`}
            onClick={() => setStatusTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="sheet-toolbar">
        <input
          className="sheet-search"
          placeholder="Search carrier, MC, DOT, capability…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {error && <span className="sheet-error">{error}</span>}
        <button type="button" className="btn btn-sm" onClick={() => setDraft(draft ? null : { ...EMPTY_DRAFT })}>
          <Icon name="plus" size={13} strokeWidth={2.5} /> Add carrier
        </button>
      </div>

      <div className="card table-shell" style={{ maxHeight: "72vh" }}>
        <table className="data-table sheet-table">
          <colgroup>
            {COLUMNS.map((col) => (
              <col key={col.key} style={col.width ? { width: col.width } : undefined} />
            ))}
            <col style={{ width: 56 }} />
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map(header)}
              <th style={{ cursor: "default" }} aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {draft && (
              <tr
                className="sheet-draft-row"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") saveDraft();
                }}
              >
                <td>
                  <input
                    className="sheet-input"
                    placeholder="Carrier name *"
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </td>
                <td>
                  <input className="sheet-input" placeholder="MC #" value={draft.mcNumber} onChange={(e) => setDraft({ ...draft, mcNumber: e.target.value })} />
                </td>
                <td>
                  <input className="sheet-input" placeholder="DOT #" value={draft.dotNumber} onChange={(e) => setDraft({ ...draft, dotNumber: e.target.value })} />
                </td>
                <td colSpan={4}>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>Vetting checklist is created automatically.</span>
                </td>
                <td>
                  <input className="sheet-input" placeholder="Home base" value={draft.homeBase} onChange={(e) => setDraft({ ...draft, homeBase: e.target.value })} />
                </td>
                <td>
                  <button type="button" className="btn btn-sm" disabled={savingDraft} onClick={saveDraft}>
                    {savingDraft ? "Saving…" : "Save"}
                  </button>
                </td>
                <td>
                  <button type="button" className="sheet-del" title="Discard" disabled={savingDraft} onClick={() => setDraft(null)}>
                    <Icon name="x" size={13} />
                  </button>
                </td>
              </tr>
            )}
            {visible.length === 0 && !draft && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="table-empty-cell">
                  {rows.length === 0
                    ? "No carriers yet — hit “Add carrier” to start building the vetted bench."
                    : "No carriers match."}
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const rev = (field: string) => revisions[`${row.id}:${field}`] ?? 0;
              const busy = (busyCounts[row.id] ?? 0) > 0;
              const expiry = insuranceExpiryState(row.cargoInsuranceExpiry, now);
              const expiryStyle =
                expiry === "expired"
                  ? { color: "var(--danger)", fontWeight: 600 }
                  : expiry === "expiring_soon"
                    ? { color: "var(--warning)", fontWeight: 600 }
                    : undefined;
              return (
                <tr key={row.id} className={busy ? "sheet-row-busy" : undefined} style={row.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <CellInput key={`n${rev("name")}:${row.name}`} value={row.name} onCommit={(v) => commit(row, { name: v })} />
                  </td>
                  <td>
                    <CellInput key={`m${rev("mcNumber")}:${row.mcNumber ?? ""}`} value={row.mcNumber} onCommit={(v) => commit(row, { mcNumber: v })} />
                  </td>
                  <td>
                    <CellInput key={`d${rev("dotNumber")}:${row.dotNumber ?? ""}`} value={row.dotNumber} onCommit={(v) => commit(row, { dotNumber: v })} />
                  </td>
                  <td>
                    <CellSelect
                      key={`v${rev("vettingStatus")}:${row.vettingStatus}`}
                      value={row.vettingStatus}
                      options={CARRIER_VETTING_STATUSES}
                      onCommit={(v) => commit(row, { vettingStatus: v })}
                    />
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {row.badges.length === 0 && <span style={{ opacity: 0.4, fontSize: 12 }}>—</span>}
                      {row.badges.map((badge) => (
                        <span
                          key={badge.code}
                          title={badge.label}
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: 0.5,
                            padding: "1px 5px",
                            borderRadius: 4,
                            border: "1px solid var(--border, currentColor)",
                            opacity: 0.75,
                          }}
                        >
                          {badge.code}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <CellInput
                      key={`c${rev("cargoLimit")}:${row.cargoLimit ?? ""}`}
                      value={fmtMoney(row.cargoLimit)}
                      placeholder="USD"
                      onCommit={(v) => commit(row, { cargoLimit: v })}
                    />
                  </td>
                  <td style={expiryStyle} title={expiry === "expired" ? "Cargo insurance EXPIRED" : expiry === "expiring_soon" ? "Expires within 30 days" : undefined}>
                    <CellInput
                      key={`e${rev("cargoInsuranceExpiry")}:${row.cargoInsuranceExpiry ?? ""}`}
                      value={row.cargoInsuranceExpiry ? row.cargoInsuranceExpiry.slice(0, 10) : null}
                      placeholder="YYYY-MM-DD"
                      title={fmtExpiry(row.cargoInsuranceExpiry)}
                      onCommit={(v) => commit(row, { cargoInsuranceExpiry: v })}
                    />
                  </td>
                  <td>
                    <CellInput key={`h${rev("homeBase")}:${row.homeBase ?? ""}`} value={row.homeBase} onCommit={(v) => commit(row, { homeBase: v })} />
                  </td>
                  <td title={`${row.loadsCompleted} load(s) completed`}>
                    {row.scorecardScore != null ? row.scorecardScore.toFixed(0) : "—"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 2 }}>
                      <Link href={`/dashboard/carriers/${row.id}`} className="sheet-del" title={`Open ${row.name} — vetting checklist & insurance`}>
                        <Icon name="chevron-right" size={13} />
                      </Link>
                      <button type="button" className="sheet-del" title={`Delete ${row.name}`} onClick={() => remove(row)}>
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sheet-count">
        Showing {visible.length} of {rows.length} carriers. Click any cell to edit — approval is gated on the vetting checklist (open a row for the full picture).
      </p>
    </div>
  );
}
