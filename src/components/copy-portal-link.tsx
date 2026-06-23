"use client";

import { useState, useTransition } from "react";
import { ensurePortalToken } from "@/lib/portal";
import { Icon } from "@/components/icon";

export function CopyPortalLink({ jobId }: { jobId: string }) {
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function copy() {
    setError(null);
    start(async () => {
      const result = await ensurePortalToken(jobId);
      if (!("ok" in result)) {
        setError(result.error);
        return;
      }
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-secondary btn-sm btn-inline-icon"
      title={error ?? "Copy a customer-shareable read-only link"}
      disabled={busy}
    >
      <Icon name={copied ? "check" : "external"} size={11} strokeWidth={2.5} />
      {copied ? "Copied" : busy ? "Generating" : "Portal link"}
    </button>
  );
}
