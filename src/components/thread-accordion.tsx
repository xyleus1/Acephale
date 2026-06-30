"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

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

export function ThreadAccordion({
  messageCount, messages,
}: { threadId: string; messageCount: number; messages: Message[] }) {
  const [open, setOpen] = useState(false);
  const [expandedBodies, setExpandedBodies] = useState<Set<string>>(new Set());

  function toggleBody(id: string) {
    setExpandedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="thread-accordion">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="thread-accordion-toggle"
      >
        <Icon name={open ? "chevron-up" : "chevron-down"} size={11} />
        {open ? "Hide" : "Show"} full thread ({messageCount} {messageCount === 1 ? "message" : "messages"})
      </button>
      {open && (
        <div className="thread-accordion-body">
          {messages.map((m) => {
            const expanded = expandedBodies.has(m.id);
            const longBody = (m.bodyText?.length ?? 0) > 1200;
            const shownBody = !longBody || expanded ? m.bodyText : (m.bodyText ?? "").slice(0, 1200);
            return (
              <div key={m.id} className={`thread-message${m.direction === "OUTBOUND" ? " outbound" : ""}`}>
                <div className="thread-message-header">
                  <span className="thread-message-sender">
                    {m.fromName ?? m.fromEmail}
                    <span className="thread-message-direction">
                      {m.direction}
                    </span>
                    {m.workflowLabel && (
                      <span className={`thread-workflow-label ${m.workflowLabelClass ?? ""}`}>
                        {m.workflowLabel}
                      </span>
                    )}
                    {m.fromName && (
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
                {m.attachments.length > 0 && (
                  <div className="record-attachment-row">
                    {m.attachments.map((a) => {
                      const dl = m.gmailMessageId
                        ? `/api/gmail/attachment?messageDbId=${m.id}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}`
                        : null;
                      return dl ? (
                        <a
                          key={a.attachmentId}
                          href={dl}
                          download={a.filename}
                          className="record-attachment"
                        >
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
