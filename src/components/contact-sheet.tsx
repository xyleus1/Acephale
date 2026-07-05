"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  createContactAction,
  deleteContactAction,
  updateContactAction,
  type ContactPatch,
} from "@/app/dashboard/crm/actions";
import {
  CONTACT_STATUSES,
  CONTACT_TYPES,
  RELATIONSHIP_LEVELS,
  type ContactRow,
} from "@/lib/contact-fields";
import { Icon } from "@/components/icon";

type SortKey =
  | "name"
  | "company"
  | "type"
  | "status"
  | "relationship"
  | "email"
  | "phone"
  | "location"
  | "lastTouchAt";

const COLUMNS: Array<{ key: SortKey | "notes"; label: string; width: number }> = [
  { key: "name", label: "Name", width: 150 },
  { key: "company", label: "Company", width: 160 },
  { key: "type", label: "Type", width: 140 },
  { key: "status", label: "Status", width: 120 },
  { key: "relationship", label: "Relationship", width: 110 },
  { key: "email", label: "Email", width: 200 },
  { key: "phone", label: "Phone", width: 130 },
  { key: "location", label: "Location", width: 130 },
  { key: "lastTouchAt", label: "Last contacted", width: 110 },
  { key: "notes", label: "Notes", width: 220 },
];

function fmtLastTouch(iso: string | null): string {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CellInput({
  value,
  placeholder,
  list,
  onCommit,
}: {
  value: string | null;
  placeholder?: string;
  list?: string;
  onCommit: (next: string) => void;
}) {
  const cancelled = useRef(false);
  return (
    <input
      className="sheet-input"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      list={list}
      onBlur={(e) => {
        if (cancelled.current) {
          cancelled.current = false;
          e.target.value = value ?? "";
          return;
        }
        const next = e.target.value.trim();
        if (next !== (value ?? "")) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function CellSelect({
  value,
  options,
  allowEmpty,
  onCommit,
}: {
  value: string | null;
  options: ReadonlyArray<readonly [string, string]>;
  allowEmpty?: boolean;
  onCommit: (next: string) => void;
}) {
  return (
    <select
      className={`sheet-select${value ? "" : " sheet-select-empty"}`}
      value={value ?? ""}
      onChange={(e) => onCommit(e.target.value)}
    >
      {allowEmpty && <option value="">—</option>}
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

type Draft = Record<"name" | "company" | "type" | "status" | "relationship" | "email" | "phone" | "location" | "notes", string>;

const EMPTY_DRAFT: Draft = {
  name: "",
  company: "",
  type: "",
  status: "",
  relationship: "unknown",
  email: "",
  phone: "",
  location: "",
  notes: "",
};

export function ContactSheet({
  initialRows,
  companies,
  initialQuery,
}: {
  initialRows: ContactRow[];
  companies: string[];
  initialQuery: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [q, setQ] = useState(initialQuery);
  const [typeTab, setTypeTab] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  const counts = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const row of rows) {
      const key = row.type && CONTACT_TYPES.some(([v]) => v === row.type) ? row.type : "none";
      byType[key] = (byType[key] ?? 0) + 1;
    }
    return byType;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows;
    if (typeTab === "none") out = out.filter((r) => !r.type || !CONTACT_TYPES.some(([v]) => v === r.type));
    else if (typeTab !== "all") out = out.filter((r) => r.type === typeTab);
    if (needle) {
      out = out.filter((r) =>
        [r.name, r.company, r.email, r.phone, r.location, r.notes]
          .some((v) => v && v.toLowerCase().includes(needle))
      );
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        if (sortKey === "lastTouchAt") {
          const av = a.lastTouchAt ? Date.parse(a.lastTouchAt) : null;
          const bv = b.lastTouchAt ? Date.parse(b.lastTouchAt) : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * sortDir;
        }
        const av = (a[sortKey] ?? "").toLowerCase();
        const bv = (b[sortKey] ?? "").toLowerCase();
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av.localeCompare(bv) * sortDir;
      });
    }
    return out;
  }, [rows, q, typeTab, sortKey, sortDir]);

  function flash(message: string) {
    setError(message);
    setTimeout(() => setError(null), 6000);
  }

  function markBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function commit(row: ContactRow, patch: ContactPatch) {
    markBusy(row.id, true);
    startTransition(async () => {
      const res = await updateContactAction(row.id, patch);
      markBusy(row.id, false);
      if ("error" in res) {
        flash(res.error);
        setRevisions((prev) => ({ ...prev, [row.id]: (prev[row.id] ?? 0) + 1 }));
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === row.id ? res.row : r)));
    });
  }

  function remove(row: ContactRow) {
    if (!window.confirm(`Delete ${row.name}? This cannot be undone.`)) return;
    markBusy(row.id, true);
    startTransition(async () => {
      const res = await deleteContactAction(row.id);
      markBusy(row.id, false);
      if ("error" in res) {
        flash(res.error);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    });
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      flash("Name is required.");
      return;
    }
    if (!draft.company.trim()) {
      flash("Company is required.");
      return;
    }
    const payload = { ...draft, companyName: draft.company };
    startTransition(async () => {
      const res = await createContactAction(payload);
      if ("error" in res) {
        flash(res.error);
        return;
      }
      setRows((prev) => [res.row, ...prev]);
      setDraft(null);
    });
  }

  function header(col: (typeof COLUMNS)[number]) {
    const sortable = col.key !== "notes";
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
    ...CONTACT_TYPES.map(([v, label]) => [v, `${label} (${counts[v] ?? 0})`] as [string, string]),
    ...(counts["none"] ? ([["none", `Uncategorized (${counts["none"]})`]] as Array<[string, string]>) : []),
  ];

  return (
    <div className="contact-sheet">
      <div className="mode-tabs" style={{ marginBottom: 12 }}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`mode-tab${typeTab === key ? " active" : ""}`}
            onClick={() => setTypeTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="sheet-toolbar">
        <input
          className="sheet-search"
          placeholder="Search name, company, email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {error && <span className="sheet-error">{error}</span>}
        <button type="button" className="btn btn-sm" onClick={() => setDraft(draft ? null : { ...EMPTY_DRAFT })}>
          <Icon name="plus" size={13} strokeWidth={2.5} /> Add contact
        </button>
      </div>

      <datalist id="crm-company-options">
        {companies.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="card table-shell" style={{ maxHeight: "72vh" }}>
        <table className="data-table sheet-table">
          <colgroup>
            {COLUMNS.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
            <col style={{ width: 40 }} />
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
                    placeholder="Full name *"
                    autoFocus
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="sheet-input"
                    placeholder="Company *"
                    list="crm-company-options"
                    value={draft.company}
                    onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                  />
                </td>
                <td>
                  <CellSelect value={draft.type || null} options={CONTACT_TYPES} allowEmpty onCommit={(v) => setDraft({ ...draft, type: v })} />
                </td>
                <td>
                  <CellSelect value={draft.status || null} options={CONTACT_STATUSES} allowEmpty onCommit={(v) => setDraft({ ...draft, status: v })} />
                </td>
                <td>
                  <CellSelect value={draft.relationship} options={RELATIONSHIP_LEVELS} onCommit={(v) => setDraft({ ...draft, relationship: v })} />
                </td>
                <td>
                  <input className="sheet-input" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                </td>
                <td>
                  <input className="sheet-input" placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </td>
                <td>
                  <input className="sheet-input" placeholder="Location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
                </td>
                <td>
                  <div className="sheet-draft-actions">
                    <button type="button" className="btn btn-sm" onClick={saveDraft}>Save</button>
                  </div>
                </td>
                <td>
                  <input className="sheet-input" placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </td>
                <td>
                  <button type="button" className="sheet-del" title="Discard" onClick={() => setDraft(null)}>
                    <Icon name="x" size={13} />
                  </button>
                </td>
              </tr>
            )}
            {visible.length === 0 && !draft && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="table-empty-cell">
                  {rows.length === 0 ? "No contacts yet — hit “Add contact” to start." : "No contacts match."}
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const rev = revisions[row.id] ?? 0;
              const busy = busyIds.has(row.id);
              return (
                <tr key={row.id} className={busy ? "sheet-row-busy" : undefined}>
                  <td>
                    <CellInput key={`n${rev}:${row.name}`} value={row.name} onCommit={(v) => commit(row, { name: v })} />
                  </td>
                  <td>
                    <CellInput key={`c${rev}:${row.company}`} value={row.company} list="crm-company-options" onCommit={(v) => commit(row, { companyName: v })} />
                  </td>
                  <td>
                    <CellSelect value={row.type} options={CONTACT_TYPES} allowEmpty onCommit={(v) => commit(row, { type: v })} />
                  </td>
                  <td>
                    <CellSelect value={row.status} options={CONTACT_STATUSES} allowEmpty onCommit={(v) => commit(row, { status: v })} />
                  </td>
                  <td>
                    <CellSelect value={row.relationship} options={RELATIONSHIP_LEVELS} onCommit={(v) => commit(row, { relationship: v })} />
                  </td>
                  <td>
                    <CellInput key={`e${rev}:${row.email ?? ""}`} value={row.email} onCommit={(v) => commit(row, { email: v })} />
                  </td>
                  <td>
                    <CellInput key={`p${rev}:${row.phone ?? ""}`} value={row.phone} onCommit={(v) => commit(row, { phone: v })} />
                  </td>
                  <td>
                    <CellInput key={`l${rev}:${row.location ?? ""}`} value={row.location} onCommit={(v) => commit(row, { location: v })} />
                  </td>
                  <td className="sheet-touch" title={row.lastTouchAt ? new Date(row.lastTouchAt).toLocaleString("en-GB") : undefined}>
                    {fmtLastTouch(row.lastTouchAt)}
                  </td>
                  <td>
                    <CellInput key={`o${rev}:${row.notes ?? ""}`} value={row.notes} onCommit={(v) => commit(row, { notes: v })} />
                  </td>
                  <td>
                    <button type="button" className="sheet-del" title={`Delete ${row.name}`} onClick={() => remove(row)}>
                      <Icon name="x" size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sheet-count">
        Showing {visible.length} of {rows.length} contacts. Click any cell to edit — changes save automatically.
      </p>
    </div>
  );
}
