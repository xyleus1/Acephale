"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

export function CopyPortalLink({ jobId }: { jobId: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const url = `${window.location.origin}/portal/${jobId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-secondary btn-sm btn-inline-icon"
      title="Copy a customer-shareable read-only link"
    >
      <Icon name={copied ? "check" : "external"} size={11} strokeWidth={2.5} />
      {copied ? "Copied" : "Portal link"}
    </button>
  );
}
