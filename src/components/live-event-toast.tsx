"use client";

import { useEffect, useRef, useState } from "react";
import type { LatestEvent } from "@/lib/agent-events";

const POLL_MS = 15_000;

const KIND_ICON: Record<LatestEvent["kind"], React.ReactNode> = {
  "rfq":           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  "carrier-reply": <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  "milestone":     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  "doc":           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  "job":           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
  "whatsapp":      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M9.2 8.6c.3 2.6 3.6 5.9 6.2 6.2l1.1-1.5-1.9-1.1-.9.5a5.7 5.7 0 0 1-2.4-2.4l.5-.9-1.1-1.9z"/></svg>,
};

export function LiveEventToast() {
  const lastSeenAt = useRef<string | null>(null);
  const [toast, setToast] = useState<LatestEvent | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;

    async function tick() {
      try {
        const response = await fetch("/api/dashboard/events/latest", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const body = await response.json().catch(() => ({})) as { event?: LatestEvent | null };
        const ev = body.event ?? null;
        if (stopped || !ev) return;
        // Establish baseline silently on first run
        if (lastSeenAt.current === null) {
          lastSeenAt.current = ev.at;
          return;
        }
        if (new Date(ev.at).getTime() > new Date(lastSeenAt.current).getTime()) {
          lastSeenAt.current = ev.at;
          setToast(ev);
          if (dismissTimer.current) clearTimeout(dismissTimer.current);
          dismissTimer.current = setTimeout(() => setToast(null), 8000);
        }
      } catch {
        // swallow
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); if (dismissTimer.current) clearTimeout(dismissTimer.current); };
  }, []);

  if (!toast) return null;

  return (
    <div className="live-toast" role="status" aria-live="polite">
      <span className="live-toast-icon">{KIND_ICON[toast.kind]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="live-toast-title">{toast.title}</div>
        {toast.sub && <div className="live-toast-sub">{toast.sub}</div>}
      </div>
      <a href={toast.href} className="live-toast-link">Open</a>
      <button className="live-toast-close" onClick={() => setToast(null)} aria-label="Dismiss">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
