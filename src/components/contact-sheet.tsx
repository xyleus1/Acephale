"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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

const COLUMNS: Array<{ key: SortKey | "notes"; label: string; width?: number }> = [
  { key: "name", label: "Name", width: 140 },
  { key: "company", label: "Company", width: 140 },
  { key: "type", label: "Type", width: 135 },
  { key: "status", label: "Status", width: 110 },
  { key: "relationship", label: "Relationship", width: 105 },
  { key: "email", label: "Email", width: 210 },
  { key: "phone", label: "Phone", width: 115 },
  { key: "location", label: "Location", width: 110 },
  { key: "lastTouchAt", label: "Last contacted", width: 105 },
  { key: "notes", label: "Notes" },
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
  // Local state so the picked value stays visible during the save round trip;
  // a failed save remounts the cell (key bump) back to the stored value.
  const [local, setLocal] = useState(value ?? "");
  const [menu, setMenu] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items: Array<readonly [string, string]> = allowEmpty ? [["", "—"], ...options] : [...options];
  const label = options.find(([v]) => v === local)?.[1] ?? "—";

  function openMenu() {
    const r = triggerRef.current!.getBoundingClientRect();
    const height = items.length * 30 + 10;
    const up = r.bottom + height > window.innerHeight - 8;
    setMenu({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, up });
  }

  function close(refocus = false) {
    setMenu(null);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(v: string) {
    close(true);
    if (v === local) return;
    setLocal(v);
    onCommit(v);
  }

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu !== null]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".sheet-select-option") ?? []);
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? Math.min(idx + 1, buttons.length - 1) : Math.max(idx - 1, 0);
      buttons[next]?.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`sheet-select-trigger${local ? "" : " sheet-select-empty"}`}
        onClick={() => (menu ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            if (!menu) {
              e.preventDefault();
              openMenu();
            }
          }
        }}
      >
        <span className="sheet-select-label">{label}</span>
        <Icon name="chevron-down" size={12} strokeWidth={2} />
      </button>
      {menu && (
        <div
          ref={menuRef}
          className="sheet-select-menu"
          role="listbox"
          style={{ top: menu.top, left: menu.left, transform: menu.up ? "translateY(-100%)" : undefined }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map(([v, optionLabel]) => (
            <button
              type="button"
              key={v || "(empty)"}
              className={`sheet-select-option${v === local ? " selected" : ""}`}
              role="option"
              aria-selected={v === local}
              autoFocus={v === local}
              onClick={() => pick(v)}
            >
              <span className="sheet-select-check">{v === local && <Icon name="check" size={12} strokeWidth={2.5} />}</span>
              {optionLabel}
            </button>
          ))}
        </div>
      )}
    </>
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

// Cells revert per field on a failed save: map patch keys to the field used in cell keys.
function patchFields(patch: ContactPatch): string[] {
  return Object.keys(patch).map((k) => (k === "companyName" ? "company" : k));
}

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
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyCounts, setBusyCounts] = useState<Record<string, number>>({});
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

  function commit(row: ContactRow, patch: ContactPatch) {
    markBusy(row.id, true);
    startTransition(async () => {
      try {
        const res = await updateContactAction(row.id, patch);
        if ("error" in res) {
          flash(res.error);
          revertCells(row.id, patchFields(patch));
          return;
        }
        setRows((prev) => prev.map((r) => (r.id === row.id ? res.row : r)));
      } catch {
        flash("Could not save — check your connection and try again.");
        revertCells(row.id, patchFields(patch));
      } finally {
        markBusy(row.id, false);
      }
    });
  }

  function commitCompany(row: ContactRow, name: string) {
    const known = companies.some((c) => c.toLowerCase() === name.toLowerCase());
    if (!known && !window.confirm(`“${name}” is a new company — create it?`)) {
      revertCells(row.id, ["company"]);
      return;
    }
    commit(row, { companyName: name });
  }

  function remove(row: ContactRow) {
    if (!window.confirm(`Delete ${row.name}? This cannot be undone.`)) return;
    markBusy(row.id, true);
    startTransition(async () => {
      try {
        const res = await deleteContactAction(row.id);
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
      flash("Name is required.");
      return;
    }
    if (!draft.company.trim()) {
      flash("Company is required.");
      return;
    }
    setSavingDraft(true);
    const payload: ContactPatch = {
      name: draft.name,
      companyName: draft.company,
      type: draft.type,
      status: draft.status,
      relationship: draft.relationship,
      email: draft.email,
      phone: draft.phone,
      location: draft.location,
      notes: draft.notes,
    };
    startTransition(async () => {
      try {
        const res = await createContactAction(payload);
        if ("error" in res) {
          flash(res.error);
          return;
        }
        setRows((prev) => [res.row, ...prev]);
        setDraft(null);
      } catch {
        flash("Could not add the contact — check your connection and try again.");
      } finally {
        setSavingDraft(false);
      }
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
              <col key={col.key} style={col.width ? { width: col.width } : undefined} />
            ))}
            <col style={{ width: 32 }} />
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
                    <button type="button" className="btn btn-sm" disabled={savingDraft} onClick={saveDraft}>
                      {savingDraft ? "Saving…" : "Save"}
                    </button>
                  </div>
                </td>
                <td>
                  <input className="sheet-input" placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
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
                  {rows.length === 0 ? "No contacts yet — hit “Add contact” to start." : "No contacts match."}
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const rev = (field: string) => revisions[`${row.id}:${field}`] ?? 0;
              const busy = (busyCounts[row.id] ?? 0) > 0;
              return (
                <tr key={row.id} className={busy ? "sheet-row-busy" : undefined}>
                  <td>
                    <CellInput key={`n${rev("name")}:${row.name}`} value={row.name} onCommit={(v) => commit(row, { name: v })} />
                  </td>
                  <td>
                    <CellInput
                      key={`c${rev("company")}:${row.company}`}
                      value={row.company}
                      list="crm-company-options"
                      onCommit={(v) => commitCompany(row, v)}
                    />
                  </td>
                  <td>
                    <CellSelect key={`t${rev("type")}:${row.type ?? ""}`} value={row.type} options={CONTACT_TYPES} allowEmpty onCommit={(v) => commit(row, { type: v })} />
                  </td>
                  <td>
                    <CellSelect key={`s${rev("status")}:${row.status ?? ""}`} value={row.status} options={CONTACT_STATUSES} allowEmpty onCommit={(v) => commit(row, { status: v })} />
                  </td>
                  <td>
                    <CellSelect key={`r${rev("relationship")}:${row.relationship}`} value={row.relationship} options={RELATIONSHIP_LEVELS} onCommit={(v) => commit(row, { relationship: v })} />
                  </td>
                  <td>
                    <CellInput key={`e${rev("email")}:${row.email ?? ""}`} value={row.email} onCommit={(v) => commit(row, { email: v })} />
                  </td>
                  <td>
                    <CellInput key={`p${rev("phone")}:${row.phone ?? ""}`} value={row.phone} onCommit={(v) => commit(row, { phone: v })} />
                  </td>
                  <td>
                    <CellInput key={`l${rev("location")}:${row.location ?? ""}`} value={row.location} onCommit={(v) => commit(row, { location: v })} />
                  </td>
                  <td className="sheet-touch" title={row.lastTouchAt ? new Date(row.lastTouchAt).toLocaleString("en-GB") : undefined}>
                    {fmtLastTouch(row.lastTouchAt)}
                  </td>
                  <td>
                    <CellInput key={`o${rev("notes")}:${row.notes ?? ""}`} value={row.notes} onCommit={(v) => commit(row, { notes: v })} />
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
