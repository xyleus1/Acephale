"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";

export type RfqWhatsAppPreview = {
  phoneDisplay: string | null;
  waUrl: string | null;
  text: string;
  missing: string[];
  sentAtLabel: string | null;
  configured: boolean;
};

// The Turkish WhatsApp inquiry draft with Copy / wa.me / Send-through-CRM.
// Shared by the RFQ sheet's expanded row and the RFQ detail page — onSend is
// a (bound) server action so both server and client parents can mount it.
export function WhatsAppPreviewCard({ preview, onSend }: {
  preview: RfqWhatsAppPreview;
  onSend: () => Promise<{ ok: true } | { error: string }>;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  const sent = Boolean(preview.sentAtLabel) || justSent;
  const sendDisabledReason = !preview.configured
    ? "CRM WhatsApp sending is not configured (WHATSAPP_SEND_ENABLED + Cloud API credentials)."
    : !preview.phoneDisplay
      ? "No usable phone number on this RFQ."
      : null;

  function copy() {
    navigator.clipboard.writeText(preview.text).then(
      () => {
        setCopied(true);
        setCopyError(false);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 2000);
      },
      () => setCopyError(true),
    );
  }

  function send() {
    startTransition(async () => {
      setError(null);
      try {
        const res = await onSend();
        if ("error" in res) {
          setError(res.error);
        } else {
          setJustSent(true);
          router.refresh();
        }
      } catch {
        // A rejected action (network drop, server crash) leaves delivery
        // unknown — say so instead of crashing to the error boundary.
        setError("Send failed or was interrupted — check the WhatsApp thread before retrying.");
      }
    });
  }

  return (
    <div className="rfq-mail-card">
      <div className="rfq-mail-card-head">
        <div>
          <div className="rfq-expand-block-title">WhatsApp inquiry</div>
          <div className="rfq-mail-hint">
            {preview.configured
              ? "Send from the CRM number, or copy it / open the chat on your own phone"
              : "Sent from your own phone — copy it, or open the chat prefilled"}
          </div>
        </div>
        <div className="rfq-mail-card-actions">
          {sent && (
            <span className="rfq-mail-sent">
              <Icon name="check" size={11} strokeWidth={2.5} />
              Sent{preview.sentAtLabel ? ` ${preview.sentAtLabel}` : ""}
            </span>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={12} strokeWidth={2.25} />
            {copied ? "Copied" : "Copy"}
          </button>
          {preview.waUrl ? (
            <a className="btn btn-secondary btn-sm" href={preview.waUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="message-circle" size={12} strokeWidth={2.25} />
              Open WhatsApp
            </a>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" disabled title="No usable phone number on this RFQ.">
              <Icon name="message-circle" size={12} strokeWidth={2.25} />
              Open WhatsApp
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm${sent ? " btn-secondary" : ""}`}
            disabled={busy || Boolean(sendDisabledReason)}
            title={sendDisabledReason ?? undefined}
            onClick={send}
          >
            <Icon name="whatsapp" size={12} strokeWidth={2.25} />
            {busy ? "Sending…" : sent ? "Send again" : "Send"}
          </button>
        </div>
      </div>
      <div className="rfq-mail-meta">
        <div><span>To</span><strong>{preview.phoneDisplay ?? "no phone number on this RFQ"}</strong></div>
        {preview.missing.length > 0 && <div><span>Asks</span><strong>{preview.missing.join(", ")}</strong></div>}
      </div>
      <pre className="rfq-mail-body">{preview.text}</pre>
      {copyError && <div className="rfq-mail-error">Could not copy — select the message text manually.</div>}
      {error && <div className="rfq-mail-error">{error}</div>}
    </div>
  );
}
