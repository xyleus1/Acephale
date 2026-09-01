"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CustomerProcurementListItem } from "@/lib/supply-os/customer-procurement";
import {
  chatPanelAlert,
  sourcingPanelAlert,
  type SupplyOsChatActivity,
  type SupplyOsPanelAlert,
} from "@/lib/supply-os/panel-alerts";
import type { SupplyOsPanel } from "@/lib/supply-os/panel-routing";

const POLL_INTERVAL_MS = 30_000;

type SeenMap = Record<string, string>;

/** Alert inputs are keyed by workspace so a company switch cannot save one company's timestamp under another's key. */
type AlertState = {
  key: string | null;
  seen: SeenMap;
  chatActivity: SupplyOsChatActivity | null;
  requests: CustomerProcurementListItem[];
};

function readSeen(key: string): SeenMap | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return null;
  }
}

/**
 * Tracks unread agent replies and sourcing updates for the sidebar, using the
 * panel data the workspace already exposes. Seen state is per browser.
 */
export function useSupplyOsPanelAlerts({
  storageScope,
  workspaceId,
  activePanel,
  contextEnabled,
}: {
  storageScope: string;
  workspaceId: string | null;
  activePanel: SupplyOsPanel;
  contextEnabled: boolean;
}) {
  const seenKey = `derya:supply-os:panel-seen:${storageScope}:${workspaceId ?? "none"}`;
  const [state, setState] = useState<AlertState>({ key: null, seen: {}, chatActivity: null, requests: [] });

  useEffect(() => {
    const stored = readSeen(seenKey);
    if (stored) {
      setState({ key: seenKey, seen: stored, chatActivity: null, requests: [] });
      return;
    }
    const now = new Date().toISOString();
    const initial = { materials: now, context: now };
    setState({ key: seenKey, seen: initial, chatActivity: null, requests: [] });
    try {
      window.localStorage.setItem(seenKey, JSON.stringify(initial));
    } catch {
      // Storage can be disabled. Alerts then reset on reload.
    }
  }, [seenKey]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    let timer: number | null = null;
    const load = async () => {
      const fetches: Promise<void>[] = [
        (async () => {
          const params = new URLSearchParams({ activeOnly: "true", sourceWorkspaceId: workspaceId });
          const response = await fetch(`/api/procurement/requests?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
            headers: { accept: "application/json" },
          });
          if (!response.ok) return;
          const payload = await response.json() as { requests?: CustomerProcurementListItem[] };
          setState((current) => (current.key === seenKey
            ? { ...current, requests: payload.requests ?? [] }
            : current));
        })(),
      ];
      if (contextEnabled) {
        fetches.push((async () => {
          const response = await fetch(
            `/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}/context/activity`,
            { cache: "no-store", signal: controller.signal, headers: { accept: "application/json" } },
          );
          if (!response.ok) return;
          const payload = await response.json() as { activity?: SupplyOsChatActivity };
          setState((current) => (current.key === seenKey
            ? { ...current, chatActivity: payload.activity ?? null }
            : current));
        })());
      }
      await Promise.all(fetches);
    };
    const tick = () => {
      void load().catch(() => undefined).finally(() => {
        if (controller.signal.aborted) return;
        timer = window.setTimeout(tick, POLL_INTERVAL_MS);
      });
    };
    tick();
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [contextEnabled, seenKey, workspaceId]);

  const ready = state.key === seenKey;
  const alerts = useMemo(() => ({
    materials: ready ? sourcingPanelAlert(state.requests, state.seen.materials ?? null) : null,
    context: ready && contextEnabled ? chatPanelAlert(state.chatActivity, state.seen.context ?? null) : null,
  }), [contextEnabled, ready, state.chatActivity, state.requests, state.seen.context, state.seen.materials]);

  const markSeen = useCallback((panel: string, latestAt: string) => {
    setState((current) => {
      if (current.key !== seenKey || current.seen[panel] === latestAt) return current;
      const seen = { ...current.seen, [panel]: latestAt };
      try {
        window.localStorage.setItem(seenKey, JSON.stringify(seen));
      } catch {
        // Storage can be disabled. Alerts then reset on reload.
      }
      return { ...current, seen };
    });
  }, [seenKey]);

  useEffect(() => {
    const alert: SupplyOsPanelAlert | null = activePanel === "context"
      ? alerts.context
      : activePanel === "materials"
        ? alerts.materials
        : null;
    if (!alert) return;
    markSeen(activePanel, alert.latestAt);
  }, [activePanel, alerts, markSeen]);

  return alerts;
}
