"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { draftReplyToMessage } from "@/lib/sourcing-award";
import { sendWhatsAppReplyToThread } from "@/lib/whatsapp-reply";
import { DraftModal } from "@/components/draft-modal";

export function InboxQuickReply({ threadId, threadSubject, channel = "email", composerEnabled = true }: {
  threadId: string;
  threadSubject: string;
  /** "whatsapp" adds a plain-text quick composer next to the drafted reply. */
  channel?: "email" | "whatsapp";
  /** Hide the composer when CRM WhatsApp sending isn't configured. */
  composerEnabled?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [intent, setIntent] = useState("");
  const [showIntent, setShowIntent] = useState(false);
  const [draft, setDraft] = useState<{ draft: string; replyTo: string | null; channel: "email" | "whatsapp" } | null>(null);
  const [quickText, setQuickText] = useState("");
  const [sending, startSend] = useTransition();
  const [sendState, setSendState] = useState<"idle" | "sent" | "error">("idle");

  function go(useIntent: boolean) {
    start(async () => {
      const r = await draftReplyToMessage({
        threadId,
        intent: useIntent ? intent : undefined,
      });
      if ("error" in r) { alert(r.error); return; }
      setDraft({ draft: r.draft, replyTo: r.replyTo, channel: r.channel });
      setShowIntent(false);
      setIntent("");
    });
  }

  function sendQuick() {
    const body = quickText.trim();
    if (!body || sending) return;
    startSend(async () => {
      setSendState("idle");
      const r = await sendWhatsAppReplyToThread({ threadDbId: threadId, body });
      if ("error" in r) {
        setSendState("error");
        alert(r.error);
        return;
      }
      setQuickText("");
      setSendState("sent");
      setTimeout(() => setSendState("idle"), 2000);
      router.refresh();
    });
  }

  return (
    <>
      <div className="inbox-action-group" onClick={(e) => e.stopPropagation()}>
        {channel === "whatsapp" && composerEnabled && !showIntent && (
          <span className="wa-composer wa-composer-inline" style={{ display: "inline-flex" }}>
            <input
              type="text"
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); sendQuick(); }
              }}
              placeholder="Mesaj yaz…"
              className="wa-composer-input"
              style={{ width: 150 }}
              disabled={sending}
            />
            <button
              type="button"
              onClick={sendQuick}
              disabled={sending || !quickText.trim()}
              className="inbox-action-btn primary"
              title="Send via the CRM WhatsApp number"
            >
              {sending ? "…" : sendState === "sent" ? "Sent" : "Send"}
            </button>
          </span>
        )}
        {!showIntent ? (
          <>
            <button
              type="button"
              onClick={() => go(false)}
              disabled={busy}
              className="inbox-action-btn soft-brand"
              title="Draft a reply from the latest message"
            >
              <Icon name="sparkles" size={11} />
              {busy ? "Drafting…" : "Draft reply"}
            </button>
            <button
              type="button"
              onClick={() => setShowIntent(true)}
              disabled={busy}
              className="inbox-action-btn intent"
              title="Add guidance for the draft"
            >
              + intent
            </button>
          </>
        ) : (
          <div className="inbox-action-group">
            <input
              type="text"
              value={intent}
              autoFocus
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); go(true); }
                if (e.key === "Escape") { setShowIntent(false); setIntent(""); }
              }}
              placeholder="counter at $480/MT, ask for sample…"
              className="inbox-intent-input"
            />
            <button
              type="button"
              onClick={() => go(true)}
              disabled={busy || !intent.trim()}
              className="inbox-action-btn primary"
            >
              {busy ? "…" : "Draft"}
            </button>
            <button
              type="button"
              onClick={() => { setShowIntent(false); setIntent(""); }}
              className="inbox-action-btn"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {draft && (
        <DraftModal
          title={`Reply draft - ${threadSubject}`}
          subtitle={
            draft.channel === "whatsapp"
              ? `WhatsApp to ${draft.replyTo ? `+${draft.replyTo.replace(/^whatsapp:/, "").replace(/\D/g, "")}` : "counterparty"}`
              : draft.replyTo ? `To: ${draft.replyTo}` : ""
          }
          draft={draft.draft}
          threadDbId={threadId}
          replyTo={draft.replyTo}
          channel={draft.channel}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}
