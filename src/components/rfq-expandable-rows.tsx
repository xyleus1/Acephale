"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { RfqLoadReviewButton } from "@/components/rfq-load-review-button";
import {
  deleteInquiryRowAction,
  sendDeskForwardAction,
  sendLeadConfirmationAction,
  updateInquiryRowAction,
  type InquiryRowPatch,
} from "@/app/dashboard/rfq/actions";

export type RfqEmailPreview = {
  to: string | null;
  cc: string[];
  replyTo: string | null;
  subject: string;
  text: string;
  sentAtLabel: string | null;
};

export type RfqRowData = {
  id: string;
  reference: string | null;
  jobId: string | null;
  jobReference: string | null;
  receivedAgo: string;
  receivedFull: string;
  subject: string;
  from: string;
  fromCompany: string | null;
  fromEmail: string | null;
  phone: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  sourceLabel: string;
  sourceDetail: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  status: string;
  target: string;
  targetInput: string;
  targetPlaceholder: string;
  facts: Array<{ label: string; value: string }>;
  leadAnswers: Array<{ label: string; value: string }>;
  notesExcerpt: string | null;
  mailConfigured: boolean;
  forward: RfqEmailPreview;
  confirmation: RfqEmailPreview;
};

export type SheetOption = readonly [string, string];

function EmailPreviewCard({
  title,
  hint,
  preview,
  disabledReason,
  externalError,
  onClearExternalError,
  onSend,
}: {
  title: string;
  hint: string;
  preview: RfqEmailPreview;
  disabledReason: string | null;
  externalError?: string | null;
  onClearExternalError?: () => void;
  onSend: () => Promise<{ ok: true } | { error: string }>;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  const sent = Boolean(preview.sentAtLabel) || justSent;
  const shownError = error ?? externalError ?? null;

  function send() {
    startTransition(async () => {
      setError(null);
      onClearExternalError?.();
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
        setError("Send failed or was interrupted — check with the recipient before retrying.");
      }
    });
  }

  return (
    <div className="rfq-mail-card">
      <div className="rfq-mail-card-head">
        <div>
          <div className="rfq-expand-block-title">{title}</div>
          <div className="rfq-mail-hint">{hint}</div>
        </div>
        <div className="rfq-mail-card-actions">
          {sent && (
            <span className="rfq-mail-sent">
              <Icon name="check" size={11} strokeWidth={2.5} />
              Sent{preview.sentAtLabel ? ` ${preview.sentAtLabel}` : ""}
            </span>
          )}
          <button
            className={`btn btn-sm${sent ? " btn-secondary" : ""}`}
            disabled={busy || Boolean(disabledReason)}
            title={disabledReason ?? undefined}
            onClick={send}
          >
            <Icon name="mail-out" size={12} strokeWidth={2.25} />
            {busy ? "Sending…" : sent ? "Send again" : "Send"}
          </button>
        </div>
      </div>
      <div className="rfq-mail-meta">
        <div><span>To</span><strong>{preview.to ?? "—"}</strong></div>
        {preview.cc.length > 0 && <div><span>Cc</span><strong>{preview.cc.join(", ")}</strong></div>}
        {preview.replyTo && <div><span>Reply-To</span><strong>{preview.replyTo}</strong></div>}
        <div><span>Subject</span><strong>{preview.subject}</strong></div>
      </div>
      <pre className="rfq-mail-body">{preview.text}</pre>
      {shownError && <div className="rfq-mail-error">{shownError}</div>}
    </div>
  );
}

function ExpandedPanel({ row, forwardError, onClearForwardError }: {
  row: RfqRowData;
  forwardError: string | null;
  onClearForwardError: () => void;
}) {
  const mailDisabled = row.mailConfigured ? null : "RFQ mail is not configured (RFQ_MAIL_APP_PASSWORD).";
  return (
    <div className="rfq-expand-panel">
      <div className="rfq-expand-columns">
        <div className="rfq-expand-block">
          <div className="rfq-expand-block-title">Load details</div>
          <div className="record-fact-grid">
            {row.facts.map(({ label, value }) => (
              <div key={label} className="record-fact">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="rfq-expand-block">
          <div className="rfq-expand-block-title">Contact</div>
          <div className="record-fact-grid">
            {row.contactName && (
              <div className="record-fact"><span>Name</span><strong>{row.contactName}</strong></div>
            )}
            {row.companyName && (
              <div className="record-fact"><span>Company</span><strong>{row.companyName}</strong></div>
            )}
            {row.fromEmail && (
              <div className="record-fact">
                <span>Email</span>
                <strong><a href={`mailto:${row.fromEmail}`}>{row.fromEmail}</a></strong>
              </div>
            )}
            {row.phone && (
              <div className="record-fact">
                <span>Phone</span>
                <strong><a href={`tel:${row.phone}`}>{row.phone}</a></strong>
              </div>
            )}
            <div className="record-fact"><span>Received</span><strong>{row.receivedFull}</strong></div>
            <div className="record-fact">
              <span>Source</span>
              <strong>{row.sourceLabel}{row.sourceDetail ? ` · ${row.sourceDetail}` : ""}</strong>
            </div>
          </div>
        </div>

        {row.leadAnswers.length > 0 && (
          <div className="rfq-expand-block">
            <div className="rfq-expand-block-title">Lead form answers</div>
            <div className="record-fact-grid">
              {row.leadAnswers.map(({ label, value }) => (
                <div key={label} className="record-fact">
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {row.notesExcerpt && (
        <div className="rfq-expand-notes">
          <div className="rfq-expand-block-title">Notes</div>
          <pre>{row.notesExcerpt}</pre>
        </div>
      )}

      <div className="rfq-mail-grid">
        <EmailPreviewCard
          title="Forward to desk"
          hint="Relevant load fields from rfq@usederya.com"
          preview={row.forward}
          disabledReason={mailDisabled}
          externalError={forwardError}
          onClearExternalError={onClearForwardError}
          onSend={() => sendDeskForwardAction(row.id)}
        />
        <EmailPreviewCard
          title="Confirmation to lead"
          hint="Booking-received note, replies go to oguzhan@"
          preview={row.confirmation}
          disabledReason={mailDisabled ?? (row.confirmation.to ? null : "No valid single sender email address on this RFQ.")}
          onSend={() => sendLeadConfirmationAction(row.id)}
        />
      </div>

      <div className="rfq-expand-actions">
        {row.jobId ? (
          <Link href={`/dashboard/jobs/${row.jobId}` as never} className="btn btn-sm">
            <Icon name="box" size={12} strokeWidth={2.25} />
            Load {row.jobReference ?? ""}
          </Link>
        ) : (
          <RfqLoadReviewButton inquiryId={row.id} label="Move to loads" className="btn btn-sm" />
        )}
        <Link href={`/dashboard/rfq/${row.id}` as never} className="btn btn-secondary btn-sm">
          Open full RFQ
          <Icon name="arrow-right" size={12} strokeWidth={2.5} />
        </Link>
        {row.companyId && (
          <Link href={`/dashboard/crm/companies/${row.companyId}` as never} className="btn btn-secondary btn-sm">
            Company
          </Link>
        )}
      </div>
    </div>
  );
}

function RowSendCell({ row, onExpand, onError }: {
  row: RfqRowData;
  onExpand: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const sent = Boolean(row.forward.sentAtLabel) || justSent;
  const confirmed = Boolean(row.confirmation.sentAtLabel);

  function send() {
    startTransition(async () => {
      setFailed(false);
      try {
        const res = await sendDeskForwardAction(row.id);
        if ("error" in res) {
          setFailed(true);
          onError(res.error);
          onExpand(); // the expanded forward card displays the error
        } else {
          setJustSent(true);
          router.refresh();
        }
      } catch {
        setFailed(true);
        onError("Send failed or was interrupted — check with the recipient before retrying.");
        onExpand();
      }
    });
  }

  return (
    <div className="rfq-row-send">
      {sent ? (
        <span className="rfq-mail-sent" title={`Forwarded to desk${row.forward.sentAtLabel ? ` · ${row.forward.sentAtLabel}` : ""}`}>
          <Icon name="check" size={11} strokeWidth={2.5} />
          Desk
        </span>
      ) : (
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy || !row.mailConfigured}
          title={row.mailConfigured ? "Forward load details to the desk (expand row to preview)" : "RFQ mail is not configured"}
          onClick={send}
        >
          <Icon name="mail-out" size={12} strokeWidth={2.25} />
          {busy ? "…" : failed ? "Retry" : "Desk"}
        </button>
      )}
      {confirmed && (
        <span className="rfq-mail-sent" title={`Confirmation sent to lead · ${row.confirmation.sentAtLabel}`}>
          <Icon name="check" size={11} strokeWidth={2.5} />
          Lead
        </span>
      )}
    </div>
  );
}

export function RfqExpandableRows({ rows, colSpan, statusOptions, modeOptions }: {
  rows: RfqRowData[];
  colSpan: number;
  statusOptions: ReadonlyArray<SheetOption>;
  modeOptions: ReadonlyArray<SheetOption>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <tbody>
      {rows.map((row) => {
        const open = openId === row.id;
        return (
          <RowPair
            key={row.id}
            row={row}
            open={open}
            colSpan={colSpan}
            statusOptions={statusOptions}
            modeOptions={modeOptions}
            onToggle={() => setOpenId(open ? null : row.id)}
            onExpand={() => setOpenId(row.id)}
          />
        );
      })}
    </tbody>
  );
}

function RowPair({ row, open, colSpan, statusOptions, modeOptions, onToggle, onExpand }: {
  row: RfqRowData;
  open: boolean;
  colSpan: number;
  statusOptions: ReadonlyArray<SheetOption>;
  modeOptions: ReadonlyArray<SheetOption>;
  onToggle: () => void;
  onExpand: () => void;
}) {
  const router = useRouter();
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rev = (field: string) => revisions[field] ?? 0;

  function flash(message: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setEditError(message);
    flashTimer.current = setTimeout(() => setEditError(null), 6000);
  }

  // Cells revert per field on a failed save (key bump remounts to the stored value).
  function revertCells(fields: string[]) {
    setRevisions((prev) => {
      const next = { ...prev };
      for (const field of fields) next[field] = (next[field] ?? 0) + 1;
      return next;
    });
  }

  function commit(patch: InquiryRowPatch) {
    const fields = Object.keys(patch);
    startTransition(async () => {
      try {
        const res = await updateInquiryRowAction(row.id, patch);
        if ("error" in res) {
          flash(res.error);
          revertCells(fields);
          return;
        }
        router.refresh();
      } catch {
        flash("Could not save — check your connection and try again.");
        revertCells(fields);
      }
    });
  }

  function remove() {
    const name = row.reference ?? row.subject;
    if (!window.confirm(`Delete RFQ ${name}? This cannot be undone.\n\nTip: set status to Ignored to archive it instead.`)) return;
    startTransition(async () => {
      try {
        const res = await deleteInquiryRowAction(row.id);
        if ("error" in res) {
          flash(res.error);
          return;
        }
        router.refresh();
      } catch {
        flash("Could not delete — check your connection and try again.");
      }
    });
  }

  return (
    <>
      <tr
        className={`data-row${open ? " rfq-row-open" : ""}${busy ? " sheet-row-busy" : ""}`}
        aria-expanded={open}
        tabIndex={0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button, input, textarea, select, .sheet-select-menu")) return; // inner controls win
          onToggle();
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return; // let inner controls keep their keys
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <td className="data-muted rfq-ro" title={row.receivedFull}>{row.receivedAgo}</td>
        <td className="data-cell-mono rfq-ro">{row.reference ?? <span className="data-muted">—</span>}</td>
        <td>
          <div className="rfq-subject-cell">
            <button
              type="button"
              className="rfq-row-caret"
              aria-expanded={open}
              aria-label={open ? "Collapse load details" : "Expand load details"}
              title={open ? "Collapse load details" : "Expand load details"}
              onClick={onToggle}
            >
              <Icon name="chevron-right" size={12} strokeWidth={2.5} />
            </button>
            <CellInput
              key={`su${rev("subject")}:${row.subject}`}
              value={row.subject}
              placeholder="Subject"
              onCommit={(v) => commit({ subject: v })}
            />
          </div>
        </td>
        <td>
          <div className="rfq-cell-stack">
            <CellInput
              key={`fc${rev("fromCompany")}:${row.fromCompany ?? ""}`}
              value={row.fromCompany}
              placeholder={row.companyName ?? "Company / name"}
              onCommit={(v) => commit({ fromCompany: v })}
            />
            <CellInput
              key={`fe${rev("fromEmail")}:${row.fromEmail ?? ""}`}
              value={row.fromEmail}
              placeholder="Email"
              onCommit={(v) => commit({ fromEmail: v })}
            />
          </div>
        </td>
        <td className="rfq-ro">
          <div>{row.sourceLabel}</div>
          {row.sourceDetail && <div className="data-subline">{row.sourceDetail}</div>}
        </td>
        <td>
          <div className="rfq-cell-lane">
            <CellInput
              key={`or${rev("origin")}:${row.origin ?? ""}`}
              value={row.origin}
              placeholder="Origin"
              onCommit={(v) => commit({ origin: v })}
            />
            <span className="rfq-lane-arrow" aria-hidden>→</span>
            <CellInput
              key={`de${rev("destination")}:${row.destination ?? ""}`}
              value={row.destination}
              placeholder="Destination"
              onCommit={(v) => commit({ destination: v })}
            />
          </div>
        </td>
        <td>
          <CellSelect
            key={`mo${rev("mode")}:${row.mode ?? ""}`}
            value={row.mode}
            options={modeOptions}
            allowEmpty
            allowCreate
            createLabel="Add mode…"
            onCommit={(v) => commit({ mode: v })}
          />
        </td>
        <td>
          <CellSelect
            key={`st${rev("status")}:${row.status}`}
            value={row.status}
            options={statusOptions}
            allowCreate
            createLabel="Add status…"
            onCommit={(v) => commit({ status: v })}
          />
        </td>
        <td className="numeric">
          <CellInput
            key={`ta${rev("target")}:${row.targetInput}`}
            value={row.targetInput}
            placeholder={row.targetPlaceholder}
            title='Target price — e.g. "USD 1200", "no target", or empty for ask'
            onCommit={(v) => commit({ target: v })}
          />
        </td>
        <td className="numeric rfq-ro">
          <RowSendCell row={row} onExpand={onExpand} onError={setForwardError} />
        </td>
        <td className="rfq-ro">
          <button
            type="button"
            className="sheet-del"
            title={`Delete RFQ ${row.reference ?? ""}`.trim()}
            disabled={busy}
            onClick={remove}
          >
            <Icon name="x" size={13} />
          </button>
        </td>
      </tr>
      {editError && (
        <tr className="rfq-expand-row">
          <td colSpan={colSpan}>
            <div className="rfq-mail-error">{editError}</div>
          </td>
        </tr>
      )}
      {open && (
        <tr className="rfq-expand-row">
          <td colSpan={colSpan}>
            <ExpandedPanel
              row={row}
              forwardError={forwardError}
              onClearForwardError={() => setForwardError(null)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
