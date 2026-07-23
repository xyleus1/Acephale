"use client";

// Card view for the US Meta leads (?view=us on /dashboard/rfq) - replaces
// the spreadsheet there per Mert (2026-07-22, "make it drastic"). One card
// per lead, built around the outreach sequence: where the lead is in the
// 4-email cadence, what it answered, and what happens next. The Türkiye
// view keeps the RfqSheet table.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CellSelect } from "@/components/sheet-cells";
import { LEAD_QUALITY_LABELS } from "@/lib/lead-quality";
import {
  EmailPreviewCard,
  RfqSearchBar,
  type RfqOutreachDisplay,
  type RfqRowData,
  type SheetOption,
} from "@/components/rfq-expandable-rows";
import { WhatsAppPreviewCard } from "@/components/whatsapp-preview-card";
import {
  sendDeskForwardAction,
  sendNextOutreachAction,
  sendWhatsAppInquiryAction,
  toggleLeadSequenceAction,
  updateInquiryRowAction,
} from "@/app/dashboard/rfq/actions";

const STAGE_CLASS: Record<RfqOutreachDisplay["key"], string> = {
  replied: "lead-stage--replied",
  awaiting: "lead-stage--waiting",
  final_sent: "lead-stage--final",
  not_started: "lead-stage--new",
  excluded: "lead-stage--muted",
  desk: "lead-stage--waiting",
  stopped: "lead-stage--paused",
  dropped: "lead-stage--muted",
  closed: "lead-stage--muted",
};

const TIER_BADGE: Record<"GOOD" | "REVIEW" | "WEAK", string> = {
  GOOD: "badge-good",
  REVIEW: "badge-warn",
  WEAK: "badge-neutral",
};

function StepTracker({ outreach }: { outreach: RfqOutreachDisplay }) {
  return (
    <ol className="lead-steps" aria-label={`Outreach: ${outreach.step} of ${outreach.total} emails sent`}>
      {outreach.touches.map((touch) => {
        const done = touch.atLabel != null;
        const isNext = !done && touch.step === outreach.step + 1
          && (outreach.key === "awaiting" || outreach.key === "not_started" || outreach.key === "stopped");
        return (
          <li
            key={touch.step}
            className={`lead-step${done ? " lead-step--done" : ""}${isNext ? " lead-step--next" : ""}`}
            title={done ? `${touch.label} · sent ${touch.atLabel}` : touch.label}
          >
            <span className="lead-step-dot">
              {done ? <Icon name="check" size={10} strokeWidth={3} /> : touch.step}
            </span>
            <span className="lead-step-text">
              <span className="lead-step-label">{touch.label}</span>
              <span className="lead-step-date">{done ? touch.atLabel : isNext ? "next" : "·"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function LeadCard({ row, statusOptions }: {
  row: RfqRowData;
  statusOptions: ReadonlyArray<SheetOption>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const outreach = row.outreach;

  function run(action: () => Promise<{ ok: true } | { error: string }>) {
    startTransition(async () => {
      setError(null);
      try {
        const res = await action();
        if ("error" in res) setError(res.error);
        else router.refresh();
      } catch {
        setError("Action failed or was interrupted - reload before retrying.");
      }
    });
  }

  const sequenceActive = outreach
    && (outreach.key === "not_started" || outreach.key === "awaiting" || outreach.key === "final_sent" || outreach.key === "stopped");
  const target = row.target && row.target !== "Ask" ? row.target : null;

  return (
    <article className={`lead-card${outreach?.key === "replied" ? " lead-card--replied" : ""}${busy ? " lead-card--busy" : ""}`}>
      <header className="lead-card-head">
        <div className="lead-card-idline">
          {row.leadQuality && (
            <span
              className={`badge rfq-quality-badge ${TIER_BADGE[row.leadQuality.tier]}`}
              title={`Lead quality: ${LEAD_QUALITY_LABELS[row.leadQuality.tier]} (score ${row.leadQuality.score})${row.leadQuality.reasons.length ? ` - ${row.leadQuality.reasons.join(", ")}` : ""}`}
            >
              {LEAD_QUALITY_LABELS[row.leadQuality.tier]}
            </span>
          )}
          {row.reference && <span className="lead-card-ref">{row.reference}</span>}
          <span className="lead-card-ago" title={row.receivedFull}>
            {row.receivedAgo} · {row.sourceLabel}
          </span>
        </div>
        <div className="lead-card-status" onClick={(e) => e.stopPropagation()}>
          <CellSelect
            key={`st:${row.status}`}
            value={row.status}
            options={statusOptions}
            allowCreate
            createLabel="Add status…"
            onCommit={(v) => run(() => updateInquiryRowAction(row.id, { status: v }))}
          />
        </div>
      </header>

      <div className="lead-card-lane">
        <span className="lead-card-place">{row.origin ?? "?"}</span>
        <Icon name="arrow-right" size={15} strokeWidth={2.5} className="lead-card-lane-arrow" />
        <span className="lead-card-place">{row.destination ?? "?"}</span>
        {row.mode && <span className="badge badge-neutral lead-card-chip">{row.mode}</span>}
        {target && <span className="lead-card-target">{target}</span>}
      </div>
      {row.subject && <div className="lead-card-subject">{row.subject}</div>}

      <div className="lead-card-contact">
        {row.contactName && <span><Icon name="user" size={11} strokeWidth={2.25} /> {row.contactName}</span>}
        {row.companyName && <span><Icon name="building" size={11} strokeWidth={2.25} /> {row.companyName}</span>}
        {row.fromEmail && (
          <a href={`mailto:${row.fromEmail}`}><Icon name="mail" size={11} strokeWidth={2.25} /> {row.fromEmail}</a>
        )}
        {row.phone && (
          <a href={`tel:${row.phone}`}><Icon name="phone" size={11} strokeWidth={2.25} /> {row.phone}</a>
        )}
      </div>

      {outreach && (
        <div className="lead-card-outreach">
          <div className="lead-card-stageline">
            <span className={`lead-stage ${STAGE_CLASS[outreach.key]}`}>{outreach.label}</span>
            {outreach.detail && <span className="lead-stage-detail">{outreach.detail}</span>}
          </div>
          <StepTracker outreach={outreach} />
          {outreach.key === "replied" && (
            <div className="lead-reply">
              <div className="lead-reply-head">
                <Icon name="mail" size={12} strokeWidth={2.25} />
                Lead replied{outreach.repliedAtLabel ? ` · ${outreach.repliedAtLabel}` : ""} - waiting in the {row.confirmation.replyTo ?? "rfq@usederya.com"} inbox
              </div>
              {outreach.replyExcerpt && <blockquote className="lead-reply-quote">{outreach.replyExcerpt}</blockquote>}
            </div>
          )}
        </div>
      )}

      <footer className="lead-card-actions">
        {outreach?.nextSend && outreach.key !== "stopped" && (
          <button
            className="btn btn-sm"
            disabled={busy || !row.mailConfigured || !row.confirmation.to}
            title={!row.mailConfigured
              ? "RFQ mail is not configured"
              : !row.confirmation.to
                ? "No valid single email address on this lead"
                : `${outreach.nextSend.label} · expand for the preview`}
            onClick={() => run(() => sendNextOutreachAction(row.id))}
          >
            <Icon name="mail-out" size={12} strokeWidth={2.25} />
            {busy ? "Sending…" : outreach.nextSend.label}
          </button>
        )}
        {sequenceActive && (
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            title={outreach!.key === "stopped"
              ? "Resume the automated follow-ups for this lead"
              : "Pause the automated follow-ups for this lead (reply detection stays on)"}
            onClick={() => run(() => toggleLeadSequenceAction(row.id, outreach!.key !== "stopped"))}
          >
            <Icon name={outreach!.key === "stopped" ? "play" : "pause"} size={12} strokeWidth={2.25} />
            {outreach!.key === "stopped" ? "Resume" : "Pause"}
          </button>
        )}
        {row.whatsapp.waUrl && (
          <a href={row.whatsapp.waUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" title="Open the WhatsApp draft in wa.me">
            <Icon name="whatsapp" size={12} strokeWidth={2.25} />
            WhatsApp
          </a>
        )}
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Icon name="chevron-right" size={11} strokeWidth={2.5} className={`lead-card-caret${open ? " lead-card-caret--open" : ""}`} />
          {open ? "Hide details" : "Details"}
        </button>
        <Link href={`/dashboard/rfq/${row.id}` as never} className="btn btn-secondary btn-sm lead-card-openlink">
          Open RFQ
          <Icon name="arrow-right" size={12} strokeWidth={2.5} />
        </Link>
      </footer>
      {error && <div className="rfq-mail-error">{error}</div>}

      {open && (
        <div className="lead-card-details">
          <div className="rfq-expand-columns">
            {row.leadAnswers.length > 0 && (
              <div className="rfq-expand-block">
                <div className="rfq-expand-block-title">Lead form answers</div>
                <div className="record-fact-grid">
                  {row.leadAnswers.map(({ label, value }) => (
                    <div key={label} className="record-fact"><span>{label}</span><strong>{value}</strong></div>
                  ))}
                </div>
              </div>
            )}
            {row.facts.length > 0 && (
              <div className="rfq-expand-block">
                <div className="rfq-expand-block-title">Load details</div>
                <div className="record-fact-grid">
                  {row.facts.map(({ label, value }) => (
                    <div key={label} className="record-fact"><span>{label}</span><strong>{value}</strong></div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="rfq-mail-grid">
            {outreach?.nextSend && (
              <EmailPreviewCard
                title={outreach.nextSend.label}
                hint={`Next email of the sequence - replies go to ${row.confirmation.replyTo ?? "the rfq@ desk"}`}
                preview={{
                  to: row.confirmation.to,
                  cc: row.confirmation.cc,
                  replyTo: row.confirmation.replyTo,
                  subject: outreach.nextSend.subject,
                  text: outreach.nextSend.text,
                  sentAtLabel: null,
                }}
                disabledReason={row.mailConfigured
                  ? (row.confirmation.to ? null : "No valid single email address on this lead.")
                  : "RFQ mail is not configured (RFQ_MAIL_APP_PASSWORD)."}
                onSend={() => sendNextOutreachAction(row.id)}
              />
            )}
            <EmailPreviewCard
              title="Forward to desk"
              hint="Relevant load fields from rfq@usederya.com"
              preview={row.forward}
              disabledReason={row.mailConfigured ? null : "RFQ mail is not configured (RFQ_MAIL_APP_PASSWORD)."}
              onSend={() => sendDeskForwardAction(row.id)}
            />
            <WhatsAppPreviewCard preview={row.whatsapp} onSend={() => sendWhatsAppInquiryAction(row.id)} />
          </div>
        </div>
      )}
    </article>
  );
}

export function UsLeadCards({ rows, statusOptions, searchQuery, emptyHint }: {
  rows: RfqRowData[];
  statusOptions: ReadonlyArray<SheetOption>;
  searchQuery: string;
  emptyHint: string;
}) {
  return (
    <>
      <div className="table-toolbar rfq-sheet-toolbar">
        <RfqSearchBar initialQuery={searchQuery} />
      </div>
      {rows.length === 0 ? (
        <div className="card empty-state-card">
          <Icon name={searchQuery ? "search" : "inbox"} size={36} className="empty-state-graphic" />
          <div className="empty-state-title">No leads match</div>
          <p className="empty-state-copy">
            {searchQuery
              ? `Nothing in this view matches “${searchQuery}”. Try another term, or clear the search.`
              : emptyHint}
          </p>
        </div>
      ) : (
        <div className="lead-cards">
          {rows.map((row) => (
            <LeadCard key={row.id} row={row} statusOptions={statusOptions} />
          ))}
        </div>
      )}
    </>
  );
}
