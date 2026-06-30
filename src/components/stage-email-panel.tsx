"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { draftStageEmail, logOutboundEmail } from "@/lib/job-email";
import { STAGE_TEMPLATES, type StageHint } from "@/lib/job-email-types";
import { Icon } from "@/components/icon";

export type ThreadMsg = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  sentAt: string;
};

export type ThreadView = {
  id: string;
  subject: string;
  lastMessageAt: string;
  messages: ThreadMsg[];
};

type Recipient = { email: string; label: string } | null;

export function StageEmailPanel({
  jobId,
  status,
  hints,
  threads,
  defaultRecipient,
}: {
  jobId: string;
  status: string;
  hints: StageHint[];
  threads: ThreadView[];
  defaultRecipient: Recipient;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeHint, setActiveHint] = useState<StageHint | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmail, setToEmail] = useState(defaultRecipient?.email ?? "");
  const [toLabel, setToLabel] = useState(defaultRecipient?.label ?? "");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const openFromHash = () => {
      if (window.location.hash !== "#job-email") return;
      if (hints.length === 0) return;
      const preferred = hints.find((h) => h.includes("CUSTOMER")) ?? hints[0];
      setActiveHint((current) => current ?? preferred);
      setOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [hints]);

  function pickHint(h: StageHint) {
    setActiveHint(h);
    setOpen(true);
    setSavedMsg(null);
    setDraftError(null);
  }

  async function aiDraft() {
    if (!activeHint) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await draftStageEmail(jobId, activeHint);
      if ("error" in res) {
        setDraftError(res.error);
      } else {
        setSubject(res.subject);
        setBody(res.body);
      }
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setDrafting(false);
    }
  }

  function saveDraft() {
    if (!subject.trim() || !body.trim()) return;
    const fd = new FormData();
    fd.set("subject", subject);
    fd.set("body", body);
    fd.set("toEmail", toEmail);
    fd.set("toLabel", toLabel);
    startSaving(async () => {
      const res = await logOutboundEmail(jobId, fd);
      if ("error" in res) {
        setDraftError(res.error);
      } else {
        setSavedMsg(`Draft saved · ${subject}`);
        setSubject("");
        setBody("");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div id="job-email" className="card stage-email" data-agent-target="email">
      <div className="worktable-section-header split">
        <span>Email · {threads.length} {threads.length === 1 ? "thread" : "threads"} on this job</span>
        <a href="/dashboard/settings/email" className="workbench-link-action">
          Connect inbox
        </a>
      </div>

      {/* Draft-action quick picks (templates for current stage) */}
      <div className="stage-email-template-row">
        {hints.map((h) => (
          <button
            key={h}
            onClick={() => pickHint(h)}
            type="button"
            className={`stage-email-template${activeHint === h ? " active" : ""}`}
          >
            {STAGE_TEMPLATES[h].label}
          </button>
        ))}
        {hints.length === 0 && (
          <span className="stage-email-empty">No email actions for this stage.</span>
        )}
      </div>

      {/* Composer */}
      {open && activeHint && (
        <div className="stage-email-composer">
          <div className="stage-email-row">
            <label>To</label>
            <input
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder={`${STAGE_TEMPLATES[activeHint].toLabel.toLowerCase()}@example.com`}
            />
            <span className="stage-email-side-label">{STAGE_TEMPLATES[activeHint].toLabel}</span>
          </div>
          <div className="stage-email-row">
            <label>Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject…"
            />
          </div>
          <div className="stage-email-textarea-wrap">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your email — or click 'AI Draft' to generate a draft from job context."
              rows={8}
            />
          </div>

          {draftError && (
            <div className="stage-email-error">{draftError}</div>
          )}

          <div className="stage-email-actions">
            <button
              type="button"
              onClick={aiDraft}
              disabled={drafting || saving}
              className="btn btn-secondary btn-sm btn-inline-icon"
            >
              <Icon name="sparkles" size={12} />
              {drafting ? "Drafting..." : "AI Draft"}
            </button>
            <span className="stage-email-action-spacer" />
            <button
              type="button"
              onClick={() => { setOpen(false); setActiveHint(null); }}
              className="btn btn-secondary btn-sm"
              disabled={saving}
            >Cancel</button>
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving || !subject.trim() || !body.trim()}
              className="btn btn-sm"
            >{saving ? "Saving..." : "Save draft"}</button>
          </div>
        </div>
      )}

      {savedMsg && (
        <div className="stage-email-saved">
          {savedMsg}
        </div>
      )}

      {/* Existing threads */}
      {threads.length > 0 && (
        <div className="stage-email-threads">
          {threads.map((t) => (
            <ThreadAccordion key={t.id} thread={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadAccordion({ thread }: { thread: ThreadView }) {
  const [open, setOpen] = useState(false);
  const last = thread.messages[thread.messages.length - 1];
  return (
    <div className="stage-email-thread">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="stage-email-thread-header"
      >
        <div className="stage-email-thread-copy">
          <div className="stage-email-thread-title">
            {thread.subject}
          </div>
          <div className="stage-email-thread-meta">
            {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
            {last ? ` · last from ${last.fromName ?? last.fromEmail}` : ""}
          </div>
        </div>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={13} />
      </button>
      {open && (
        <div className="stage-email-thread-body">
          {thread.messages.map((m) => (
            <div key={m.id} className={`stage-email-msg ${m.direction === "INBOUND" ? "in" : "out"}`}>
              <div className="stage-email-msg-header">
                <span className="stage-email-msg-from">{m.fromName ?? m.fromEmail}</span>
                <span className="stage-email-msg-time">
                  {m.direction} · {new Date(m.sentAt).toLocaleString()}
                </span>
              </div>
              <div className="stage-email-msg-body">{m.bodyText ?? "(no body)"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
