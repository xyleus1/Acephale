"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_PAGE_CUE_EVENT, type AgentPageCueDetail } from "@/lib/agent-page-presence";

export type AgentPageAction = {
  id: number;
  cues: AgentPageCueDetail[];
};

type FocusRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type FocusState = {
  cue: AgentPageCueDetail;
  rect: FocusRect;
  cursor: { x: number; y: number };
  step: number;
  total: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function findCueElement(cue: AgentPageCueDetail) {
  const escapedTarget = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(cue.target)
    : cue.target.replace(/["\\]/g, "\\$&");
  const byTarget = document.querySelector<HTMLElement>(`[data-agent-target="${escapedTarget}"]`);
  if (byTarget) return byTarget;

  const byTokenTarget = document.querySelector<HTMLElement>(`[data-agent-target~="${escapedTarget}"]`);
  return byTokenTarget ?? document.querySelector<HTMLElement>(".workbench-main") ?? document.querySelector<HTMLElement>("main");
}

export function AgentPagePresenceLayer({
  action,
  listenForExternalCues = false,
}: {
  action?: AgentPageAction | null;
  listenForExternalCues?: boolean;
}) {
  const [externalAction, setExternalAction] = useState<AgentPageAction | null>(null);
  const [focus, setFocus] = useState<FocusState | null>(null);
  const externalCueTimerRef = useRef<number | null>(null);
  const activeAction = externalAction ?? action ?? null;

  useEffect(() => {
    if (!listenForExternalCues) return;

    function onExternalCues(event: Event) {
      const detail = (event as CustomEvent<{ cues?: AgentPageCueDetail[] }>).detail;
      const cues = detail?.cues?.filter((cue) => cue.target && cue.label && cue.detail) ?? [];
      if (cues.length === 0) return;

      if (externalCueTimerRef.current) {
        window.clearTimeout(externalCueTimerRef.current);
      }
      setExternalAction({
        id: Date.now(),
        cues,
      });
      const clearDelayMs = Math.min(7600, cues.length * 1450 + 900);
      externalCueTimerRef.current = window.setTimeout(() => {
        setExternalAction(null);
        externalCueTimerRef.current = null;
      }, clearDelayMs);
    }

    window.addEventListener(AGENT_PAGE_CUE_EVENT, onExternalCues);
    return () => {
      window.removeEventListener(AGENT_PAGE_CUE_EVENT, onExternalCues);
      if (externalCueTimerRef.current) window.clearTimeout(externalCueTimerRef.current);
    };
  }, [listenForExternalCues]);

  useEffect(() => {
    if (!activeAction || activeAction.cues.length === 0 || typeof window === "undefined") {
      setFocus(null);
      return;
    }

    let cancelled = false;
    let activeEl: HTMLElement | null = null;
    const timers: number[] = [];

    const clearActiveElement = () => {
      if (activeEl) {
        activeEl.removeAttribute("data-agent-active");
        activeEl = null;
      }
    };

    const activate = (index: number) => {
      if (cancelled) return;
      clearActiveElement();

      const cue = activeAction.cues[index];
      if (!cue) {
        setFocus(null);
        return;
      }

      const el = findCueElement(cue);
      if (!el) {
        activate(index + 1);
        return;
      }

      activeEl = el;
      activeEl.setAttribute("data-agent-active", "true");
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        const rect = {
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
        const cursorX = clamp(r.left + Math.min(r.width * 0.82, r.width - 20), 18, window.innerWidth - 28);
        const cursorY = clamp(r.top + Math.min(56, Math.max(28, r.height * 0.35)), 72, window.innerHeight - 72);

        setFocus({
          cue,
          rect,
          cursor: { x: cursorX, y: cursorY },
          step: index + 1,
          total: activeAction.cues.length,
        });

        timers.push(window.setTimeout(() => activate(index + 1), cue.durationMs ?? 1250));
      }, 260));
    };

    activate(0);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      clearActiveElement();
      setFocus(null);
    };
  }, [activeAction]);

  if (!focus) return null;

  const calloutLeft = clamp(focus.cursor.x + 16, 16, window.innerWidth - 286);
  const calloutTop = clamp(focus.cursor.y + 18, 76, window.innerHeight - 118);

  return (
    <div className="agent-page-presence" aria-hidden="true">
      <div
        className="agent-page-spotlight"
        style={{
          left: focus.rect.left - 8,
          top: focus.rect.top - 8,
          width: focus.rect.width + 16,
          height: focus.rect.height + 16,
        }}
      />
      <div
        className="agent-page-cursor"
        style={{ transform: `translate3d(${focus.cursor.x}px, ${focus.cursor.y}px, 0)` }}
      >
        <span className="agent-page-cursor-pointer" />
        <span className="agent-page-cursor-dot" />
      </div>
      <div
        className="agent-page-callout"
        style={{ left: calloutLeft, top: calloutTop }}
      >
        <div className="agent-page-callout-meta">
          <span>Agent checking</span>
          <b>{focus.step}/{focus.total}</b>
        </div>
        <strong>{focus.cue.label}</strong>
        <small>{focus.cue.detail}</small>
        <em>{focus.cue.target.replace(/-/g, " ")}</em>
      </div>
    </div>
  );
}
