"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendReplyToThread } from "@/lib/gmail-send";
import { sendWhatsAppReplyToThread } from "@/lib/whatsapp-reply";

export function DraftModal({
  title, subtitle, draft, onClose,
  threadDbId, replyTo, channel = "email",
}: {
  title: string;
  subtitle?: string;
  draft: string;
  onClose: () => void;
  /** If provided, "Send" button appears and uses Gmail send to deliver as a real reply. */
  threadDbId?: string;
  replyTo?: string | null;
  /** "whatsapp" routes Send through the CRM's WhatsApp number instead of Gmail. */
  channel?: "email" | "whatsapp";
}) {
  const router = useRouter();
  const [text, setText] = useState(draft);
  const [busy, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string; needsReauth?: boolean } | null>(null);

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function send() {
    if (!threadDbId) return;
    if (!text.trim()) { setStatus({ kind: "err", msg: "Draft is empty" }); return; }
    start(async () => {
      setStatus(null);
      let r: { ok: true } | { error: string; needsReauth?: boolean };
      if (channel === "whatsapp") {
        r = await sendWhatsAppReplyToThread({ threadDbId, body: text });
      } else {
        r = await sendReplyToThread({
          threadDbId,
          body: text,
          replyTo: replyTo ?? undefined,
        });
      }
      if ("error" in r) {
        setStatus({ kind: "err", msg: r.error, needsReauth: r.needsReauth });
        return;
      }
      setStatus({ kind: "ok", msg: "Sent" });
      router.refresh();
      setTimeout(onClose, 1200);
    });
  }

  return (
    <div
      onClick={onClose}
      className="product-modal-overlay"
    >
      <div onClick={(e) => e.stopPropagation()} className="product-modal draft-modal">
        <div className="product-modal-header">
          <div>
            <div className="product-modal-title">{title}</div>
            {subtitle && <div className="product-modal-subtitle">{subtitle}</div>}
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="draft-modal-textarea"
        />
        <div className="draft-modal-footer">
          <div className={`draft-modal-status${status?.kind === "err" ? " is-error" : ""}`}>
            {status?.msg}
            {status?.needsReauth && (
              <>
                {" "}
                <a href="/dashboard/settings/email" className="draft-modal-link">Reconnect inbox</a>
              </>
            )}
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm modal-action-btn" disabled={busy}>Close</button>
          <button onClick={copy} className="btn btn-secondary btn-sm modal-action-btn" disabled={busy}>
            {copied ? "Copied" : "Copy"}
          </button>
          {threadDbId && (
            <button onClick={() => send()} className="btn btn-sm modal-action-btn" disabled={busy}>
              {busy ? "Sending..." : status?.kind === "ok" ? "Sent" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
