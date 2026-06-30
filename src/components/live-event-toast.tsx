"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getLatestEvent, type LatestEvent } from "@/lib/agent-events";

const POLL_MS = 15_000;

const KIND_ICON: Record<LatestEvent["kind"], React.ReactNode> = {
  "rfq":           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  "carrier-reply": <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  "milestone":     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  "doc":           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  "job":           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
};

export function LiveEventToast() {
  const router = useRouter();
  const lastSeenAt = useRef<string | null>(null);
  const [toast, setToast] = useState<LatestEvent | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;

    async function tick() {
      try {
        const ev = await getLatestEvent();
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
          // Refresh server data on the current page
          router.refresh();
        }
      } catch {
        // swallow
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); if (dismissTimer.current) clearTimeout(dismissTimer.current); };
  }, [router]);

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
