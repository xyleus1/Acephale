"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { displayParty, isWhatsAppAddress } from "@/lib/whatsapp-display";
import { markThreadReadAction } from "@/lib/thread-read";

type Attachment = { filename: string; mimeType: string; size: number; attachmentId: string };

type Message = {
  id: string;
  direction: string;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  sentAt: string;
  classification: string | null;
  workflowLabel?: string;
  workflowLabelClass?: string;
  gmailMessageId: string | null;
  attachments: Attachment[];
};

function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// "Today" / "Yesterday" / "8 Jul 2026" - chat-view day separators.
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function AttachmentRow({ m }: { m: Message }) {
  if (m.attachments.length === 0) return null;
  return (
    <div className="record-attachment-row">
      {m.attachments.map((a) => {
        const dl = m.gmailMessageId
          ? `/api/gmail/attachment?messageDbId=${m.id}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}`
          : null;
        return dl ? (
          <a key={a.attachmentId} href={dl} download={a.filename} className="record-attachment">
            <Icon name="paperclip" size={11} />
            <strong>{a.filename}</strong>
            <span className="record-attachment-meta">{formatBytes(a.size)}</span>
            <Icon name="download" size={11} />
          </a>
        ) : (
          <span key={a.attachmentId} className="thread-attachment-muted">
            <Icon name="paperclip" size={11} />
            {a.filename} · {formatBytes(a.size)}
          </span>
        );
      })}
    </div>
  );
}

export function ThreadAccordion({
  threadId, messageCount, messages, channel = "email", hasUnread = false,
}: {
  threadId: string;
  messageCount: number;
  messages: Message[];
  channel?: "email" | "whatsapp";
  hasUnread?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set());

  function toggleBody(id: string) {
    setExpandedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    // Opening the conversation clears the unread dot. Gated on the server-fed
    // hasUnread prop (refresh flips it off), so a thread that goes unread
    // again while mounted clears correctly on the next open; the action is
    // idempotent, so a rare double-fire is harmless.
    if (next && hasUnread) {
      markThreadReadAction(threadId)
        .then(() => router.refresh())
        .catch(() => null);
    }
  }

  const isChat = channel === "whatsapp";

  return (
    <div className="thread-accordion">
      <button
        type="button"
        onClick={toggleOpen}
        className="thread-accordion-toggle"
      >
        <Icon name={open ? "chevron-up" : "chevron-down"} size={11} />
        {open ? "Hide" : "Show"} {isChat ? "conversation" : "full thread"} ({messageCount} {messageCount === 1 ? "message" : "messages"})
      </button>
      {open && (isChat ? (
        <div className="wa-thread">
          {messages.map((m, i) => {
            const expanded = expandedBodies.has(m.id);
            const longBody = (m.bodyText?.length ?? 0) > 1200;
            const shownBody = !longBody || expanded ? m.bodyText : (m.bodyText ?? "").slice(0, 1200);
            const isOutbound = m.direction === "OUTBOUND";
            const prev = messages[i - 1];
            const showDay = !prev || dayLabel(prev.sentAt) !== dayLabel(m.sentAt);
            const isMediaNote = Boolean(m.bodyText?.startsWith("[Unsupported WhatsApp"));
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {showDay && <div className="wa-day-sep">{dayLabel(m.sentAt)}</div>}
                <div className={`wa-bubble ${isOutbound ? "outbound" : "inbound"}`}>
                  {!isOutbound && (
                    <div className="wa-bubble-sender">{displayParty(m.fromEmail, m.fromName)}</div>
                  )}
                  {shownBody && (
                    <span className={isMediaNote ? "wa-media-note" : undefined}>
                      {shownBody}
                      {longBody && !expanded && <>…</>}
                    </span>
                  )}
                  {longBody && (
                    <button type="button" onClick={() => toggleBody(m.id)} className="thread-message-more">
                      {expanded ? "Show less" : "Show full message"}
                    </button>
                  )}
                  <AttachmentRow m={m} />
                  <span className="wa-bubble-meta">
                    {new Date(m.sentAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    {isOutbound && <span className="wa-tick">✓</span>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="thread-accordion-body">
          {messages.map((m) => {
            const expanded = expandedBodies.has(m.id);
            const longBody = (m.bodyText?.length ?? 0) > 1200;
            const shownBody = !longBody || expanded ? m.bodyText : (m.bodyText ?? "").slice(0, 1200);
            return (
              <div key={m.id} className={`thread-message${m.direction === "OUTBOUND" ? " outbound" : ""}`}>
                <div className="thread-message-header">
                  <span className="thread-message-sender">
                    {displayParty(m.fromEmail, m.fromName)}
                    <span className="thread-message-direction">
                      {m.direction}
                    </span>
                    {m.workflowLabel && (
                      <span className={`thread-workflow-label ${m.workflowLabelClass ?? ""}`}>
                        {m.workflowLabel}
                      </span>
                    )}
                    {m.fromName && !isWhatsAppAddress(m.fromEmail) && (
                      <span className="thread-message-email">
                        &lt;{m.fromEmail}&gt;
                      </span>
                    )}
                  </span>
                  <span className="thread-message-time">
                    {new Date(m.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {m.subject && (
                  <div className="thread-message-subject">
                    {m.subject}
                  </div>
                )}
                {shownBody && (
                  <div className="thread-message-body">
                    {shownBody}
                    {longBody && !expanded && <>…</>}
                  </div>
                )}
                {longBody && (
                  <button
                    type="button"
                    onClick={() => toggleBody(m.id)}
                    className="thread-message-more"
                  >
                    {expanded ? "Show less" : `Show full email (${m.bodyText?.length.toLocaleString()} chars)`}
                  </button>
                )}
                <AttachmentRow m={m} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
