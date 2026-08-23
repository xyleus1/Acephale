"use client";

import { useState, useTransition } from "react";
import {
  makeDefaultEmailSender,
  setEmailAccountSendEnabled,
} from "@/app/dashboard/settings/email/actions";

export function EmailAccountControls({
  accountId,
  active,
  sendEnabled,
  isDefaultSender,
}: {
  accountId: string;
  active: boolean;
  sendEnabled: boolean;
  isDefaultSender: boolean;
}) {
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Account configuration failed.");
      }
    });
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          type="button"
          className={`btn ${sendEnabled ? "btn-secondary" : ""} btn-sm`}
          disabled={busy || !active}
          onClick={() => run(() => setEmailAccountSendEnabled(accountId, !sendEnabled))}
          style={{ fontSize: 12 }}
        >
          {sendEnabled ? "Disable sending" : "Enable sending"}
        </button>
        {sendEnabled && !isDefaultSender ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || !active}
            onClick={() => run(() => makeDefaultEmailSender(accountId))}
            style={{ fontSize: 12 }}
          >
            Make default
          </button>
        ) : null}
      </div>
      {error ? <span role="alert" style={{ maxWidth: 280, color: "var(--danger)", fontSize: 11.5 }}>{error}</span> : null}
    </div>
  );
}
