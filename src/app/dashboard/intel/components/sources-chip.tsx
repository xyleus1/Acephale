"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  dedupeIntelSourceUses,
  formatCacheAge,
  formatReviewAge,
  resolveIntelSourceUse,
  type IntelSourceUse,
} from "@/lib/intel";

type Position = { top: number; left: number };

export function SourcesChip({
  sources,
  label = "Sources",
  comfortable = false,
}: {
  sources: readonly IntelSourceUse[];
  label?: string;
  comfortable?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `intel-sources-${useId().replaceAll(":", "")}`;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const resolved = useMemo(
    () => dedupeIntelSourceUses(sources).map(resolveIntelSourceUse),
    [sources]
  );

  function toggle() {
    setOpen((value) => !value);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    const height = Math.min(panel.offsetHeight, window.innerHeight - 48);
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const fitsBelow = window.innerHeight - rect.bottom - 12 >= height;
    const top = fitsBelow ? rect.bottom + 6 : Math.max(12, rect.top - height - 6);
    setPosition({ top, left });
    panel.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const closeOnViewportChange = (event: Event) => {
      const target = event.target;
      if (event.type === "scroll" && target instanceof Node && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-sm"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        data-intel-sources-trigger
        onClick={toggle}
        style={{
          minHeight: comfortable ? 44 : 22,
          padding: comfortable ? "8px 12px" : "2px 7px",
          borderRadius: 999,
          fontSize: comfortable ? 11 : 10,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        {label} {resolved.length}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-modal="false"
              aria-label="Sources used"
              tabIndex={-1}
              data-intel-sources-popover
              style={{
                position: "fixed",
                zIndex: 10000,
                top: position.top,
                left: position.left,
                width: "min(360px, calc(100vw - 24px))",
                maxHeight: "min(440px, calc(100vh - 48px))",
                overflowY: "auto",
                padding: comfortable ? 16 : 12,
                border: "1px solid var(--border, rgba(128,128,128,0.35))",
                borderRadius: 10,
                background: "var(--panel, #fff)",
                color: "var(--text, #171717)",
                boxShadow: "0 14px 40px rgba(0,0,0,0.2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, fontSize: 11, fontWeight: 700 }}>Sources used on this item</div>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-intel-sources-close
                  aria-label="Close sources"
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  style={{
                    minHeight: comfortable ? 44 : 22,
                    padding: comfortable ? "8px 12px" : "2px 7px",
                    fontSize: comfortable ? 12 : 10,
                  }}
                >
                  Close
                </button>
              </div>
              {resolved.length === 0 ? (
                <div
                  style={{
                    fontSize: comfortable ? 13 : 11,
                    lineHeight: 1.45,
                    opacity: 0.7,
                  }}
                >
                  No external source-backed facts are attached to this item.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {resolved.map((source) => (
                    <div
                      key={`${source.sourceId}:${source.sourceUrl}`}
                      style={{
                        fontSize: comfortable ? 13 : 11,
                        lineHeight: 1.45,
                      }}
                    >
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontWeight: 700, textDecoration: "underline" }}
                      >
                        {source.name}
                      </a>
                      <div style={{ opacity: 0.7 }}>{source.publisher}</div>
                      <div style={{ opacity: 0.6, overflowWrap: "anywhere" }}>{source.sourceUrl}</div>
                      <div style={{ opacity: 0.6 }}>
                        {source.fetchedAt
                          ? `Data as of ${source.asOf ?? "not published"} · Cache ${formatCacheAge(source)}`
                          : `Source as of ${source.asOf ?? "not published"} · Reviewed ${source.reviewedAt?.slice(0, 10) ?? "date unavailable"} (${formatReviewAge(source)})`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
