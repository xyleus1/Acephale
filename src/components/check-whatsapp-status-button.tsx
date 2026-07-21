"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";

// Settings-page button that probes the live WhatsApp gateway (provider,
// instance state, last inbound) and renders the result inline.
export function CheckWhatsAppStatusButton() {
  const [busy, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function check() {
    start(async () => {
      setResult(null);
      setIsError(false);
      try {
        const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          provider: string;
          instanceState: string | null;
          sendEnabled: boolean;
          lastInboundAt: string | null;
        };
        const parts = [
          data.provider === "greenapi" ? `instance ${data.instanceState ?? "unknown"}` : "Meta Cloud API",
          data.sendEnabled ? "sending enabled" : "sending disabled",
          data.lastInboundAt
            ? `last inbound ${new Date(data.lastInboundAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : "no inbound yet",
        ];
        setIsError(data.provider === "greenapi" && data.instanceState !== "authorized");
        setResult(parts.join(" · "));
      } catch {
        setIsError(true);
        setResult("Status check failed - see server logs.");
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={check} disabled={busy}>
        <Icon name="activity" size={12} strokeWidth={2.25} />
        {busy ? "Checking…" : "Check status"}
      </button>
      {result && (
        <span style={{ fontSize: 11.5, color: isError ? "var(--danger)" : "var(--success)", fontWeight: 600 }}>
          {result}
        </span>
      )}
    </span>
  );
}
