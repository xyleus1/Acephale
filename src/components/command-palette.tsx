"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchJobs, focusJobAction, type JobSearchResult } from "@/lib/job-search";
import { Icon } from "@/components/icon";

const STATUS_LABEL: Record<string, string> = {
  INQUIRY: "RFQ", QUOTED: "Pricing", BOOKED: "Booked / Waiting Cargo",
  IN_TRANSIT: "En Route", CUSTOMS: "En Route", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JobSearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debouncedQuery = useDebounced(query, 100);

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

  // Run search whenever opened or query changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    searchJobs(debouncedQuery).then((rs) => {
      if (!cancelled) {
        setResults(rs);
        setActiveIdx(0);
      }
    });
    return () => { cancelled = true; };
  }, [open, debouncedQuery]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  function pick(r: JobSearchResult) {
    startTransition(async () => {
      await focusJobAction(r.id);
      setOpen(false);
      router.push("/dashboard");
      router.refresh();
    });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[activeIdx]) pick(results[activeIdx]);
    }
  }

  if (!open) return (
    <button
      className="cmdk-hint"
      onClick={() => setOpen(true)}
      title="Open command palette (⌘K)"
      aria-label="Open command palette"
    >
      <Icon name="search" size={12} strokeWidth={2} />
      <span>Find job</span>
      <kbd>⌘K</kbd>
    </button>
  );

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
            placeholder="Search jobs by ref, customer, route, mode…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmdk-results">
          {results.length === 0 ? (
            <div style={{ padding: "20px 16px", fontSize: 13, color: "var(--text-3)", textAlign: "center" }}>
              {query ? "No matches" : "Start typing to search"}
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                className={`cmdk-row${i === activeIdx ? " active" : ""}`}
                onClick={() => pick(r)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="cmdk-ref">{r.reference}</span>
                <span className="cmdk-customer">{r.customer ?? "no customer"}</span>
                <span className="cmdk-route">
                  {r.origin && r.destination ? `${r.origin} → ${r.destination}` : "—"}
                  {r.mode ? ` · ${r.mode}` : ""}
                </span>
                <span className="cmdk-status">{STATUS_LABEL[r.status] ?? r.status}</span>
              </button>
            ))
          )}
        </div>
        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open in workbench</span>
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
