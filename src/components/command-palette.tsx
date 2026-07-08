"use client";

// ⌘K global search palette: one input over loads, RFQs, companies, contacts
// and email threads (src/lib/global-search.ts). Picking a result navigates to
// it — a load opens its detail page, which also updates the workbench focus
// via the focus-job middleware cookie, so the old "find job" behavior is a
// side effect of the new one. The .cmdk-* classnames are load-bearing: later
// theme layers in globals.css restyle them, so keep them stable.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { globalSearch, type GlobalSearchGroup, type GlobalSearchResult } from "@/lib/global-search";
import { Icon } from "@/components/icon";

const GROUP_LABEL: Record<GlobalSearchGroup, string> = {
  loads: "Loads",
  rfqs: "RFQs",
  companies: "Companies",
  contacts: "Contacts",
  threads: "Email",
};

const GROUP_ORDER: GlobalSearchGroup[] = ["loads", "rfqs", "companies", "contacts", "threads"];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debouncedQuery = useDebounced(query, 150);

  // Global hotkey
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Run search whenever opened or query changes. The query!==debounced guard
  // skips the window where the input was externally reset (reopen) but the
  // debounced value still holds the previous session's text.
  useEffect(() => {
    if (!open) return;
    if (query !== debouncedQuery) return;
    let cancelled = false;
    setSearching(true);
    globalSearch(debouncedQuery)
      .then((rs) => {
        if (!cancelled) {
          setResults(rs);
          setActiveIdx(0);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => { cancelled = true; };
  }, [open, query, debouncedQuery]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Results ordered by group so the flat index used for keyboard navigation
  // matches the rendered order exactly.
  const ordered = GROUP_ORDER.flatMap((g) => results.filter((r) => r.group === g));

  function pick(r: GlobalSearchResult) {
    startTransition(() => {
      setOpen(false);
      router.push(r.href as never);
    });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(ordered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (ordered[activeIdx]) pick(ordered[activeIdx]);
    }
  }

  if (!open) return (
    <button
      className="cmdk-hint"
      onClick={() => setOpen(true)}
      title="Search the app (⌘K)"
      aria-label="Search the app"
    >
      <Icon name="search" size={12} strokeWidth={2} />
      <span>Search</span>
      <kbd>⌘K</kbd>
    </button>
  );

  let flatIdx = -1;

  return (
    <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Icon name="search" size={14} strokeWidth={2} style={{ color: "var(--text-3)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search loads, RFQs, companies, contacts, email…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmdk-results" role="listbox" aria-label="Search results">
          {ordered.length === 0 ? (
            <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--text-3)", textAlign: "center" }}>
              {searching ? "Searching…" : query ? "No matches" : "Start typing to search"}
            </div>
          ) : (
            GROUP_ORDER.map((g) => {
              const group = ordered.filter((r) => r.group === g);
              if (group.length === 0) return null;
              return (
                <div key={g}>
                  <div className="cmdk-group-label">{GROUP_LABEL[g]}</div>
                  {group.map((r) => {
                    flatIdx += 1;
                    const idx = flatIdx;
                    const active = idx === activeIdx;
                    return (
                      <button
                        key={`${r.group}:${r.id}`}
                        className={`cmdk-row${active ? " active" : ""}`}
                        role="option"
                        aria-selected={active}
                        onClick={() => pick(r)}
                        onMouseEnter={() => setActiveIdx(idx)}
                      >
                        <span className="cmdk-ref">{r.ref ?? ""}</span>
                        <span className="cmdk-customer">{r.title}</span>
                        <span className="cmdk-route">{r.detail ?? "—"}</span>
                        <span className="cmdk-status">{r.status ?? GROUP_LABEL[r.group]}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
