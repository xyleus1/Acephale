"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { draftReplyToMessage } from "@/lib/sourcing-award";
import { DraftModal } from "@/components/draft-modal";

export function InboxQuickReply({ threadId, threadSubject }: { threadId: string; threadSubject: string }) {
  const [busy, start] = useTransition();
  const [intent, setIntent] = useState("");
  const [showIntent, setShowIntent] = useState(false);
  const [draft, setDraft] = useState<{ draft: string; replyTo: string | null } | null>(null);

  function go(useIntent: boolean) {
    start(async () => {
      const r = await draftReplyToMessage({
        threadId,
        intent: useIntent ? intent : undefined,
      });
      if ("error" in r) { alert(r.error); return; }
      setDraft({ draft: r.draft, replyTo: r.replyTo });
      setShowIntent(false);
      setIntent("");
    });
  }

  return (
    <>
      <div className="inbox-action-group" onClick={(e) => e.stopPropagation()}>
        {!showIntent ? (
          <>
            <button
              type="button"
              onClick={() => go(false)}
              disabled={busy}
              className="inbox-action-btn soft-brand"
              title="AI drafts a reply based on the latest message"
            >
              <Icon name="sparkles" size={11} />
              {busy ? "Drafting…" : "AI reply"}
            </button>
            <button
              type="button"
              onClick={() => setShowIntent(true)}
              disabled={busy}
              className="inbox-action-btn intent"
              title="Tell the AI what stance to take"
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
          title={`Reply draft — ${threadSubject}`}
          subtitle={draft.replyTo ? `To: ${draft.replyTo}` : ""}
          draft={draft.draft}
          threadDbId={threadId}
          replyTo={draft.replyTo}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}
