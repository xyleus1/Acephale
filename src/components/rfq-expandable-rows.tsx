"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { RfqLoadReviewButton } from "@/components/rfq-load-review-button";
import {
  bulkUpdateInquiryStatusAction,
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

export type RfqWhatsAppPreview = {
  phoneDisplay: string | null;
  waUrl: string | null;
  text: string;
  missing: string[];
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
  whatsapp: RfqWhatsAppPreview;
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

// Collapsed-by-default drawer for the outbound drafts, so expanding a row
// shows the load first and the generated messages only on demand.
function DraftsDrawer({ title, hint, badges, open, onToggle, children }: {
  title: string;
  hint: string;
  badges?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`rfq-drafts${open ? " rfq-drafts-open" : ""}`}>
      <button type="button" className="rfq-drafts-toggle" aria-expanded={open} onClick={onToggle}>
        <Icon name="chevron-right" size={11} strokeWidth={2.5} className="rfq-drafts-caret" />
        <span className="rfq-drafts-title">{title}</span>
        <span className="rfq-drafts-hint">{hint}</span>
        {badges && <span className="rfq-drafts-badges">{badges}</span>}
      </button>
      {open && children}
    </section>
  );
}

function WhatsAppPreviewCard({ preview }: { preview: RfqWhatsAppPreview }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <div className="rfq-mail-card">
      <div className="rfq-mail-card-head">
        <div>
          <div className="rfq-expand-block-title">WhatsApp inquiry</div>
          <div className="rfq-mail-hint">Sent from your own phone — copy it, or open the chat prefilled</div>
        </div>
        <div className="rfq-mail-card-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={12} strokeWidth={2.25} />
            {copied ? "Copied" : "Copy"}
          </button>
          {preview.waUrl ? (
            <a className="btn btn-sm" href={preview.waUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="message-circle" size={12} strokeWidth={2.25} />
              Open WhatsApp
            </a>
          ) : (
            <button type="button" className="btn btn-sm" disabled title="No usable phone number on this RFQ.">
              <Icon name="message-circle" size={12} strokeWidth={2.25} />
              Open WhatsApp
            </button>
          )}
        </div>
      </div>
      <div className="rfq-mail-meta">
        <div><span>To</span><strong>{preview.phoneDisplay ?? "no phone number on this RFQ"}</strong></div>
        {preview.missing.length > 0 && <div><span>Asks</span><strong>{preview.missing.join(", ")}</strong></div>}
      </div>
      <pre className="rfq-mail-body">{preview.text}</pre>
      {copyError && <div className="rfq-mail-error">Could not copy — select the message text manually.</div>}
    </div>
  );
}

function ExpandedPanel({ row, forwardError, onClearForwardError }: {
  row: RfqRowData;
  forwardError: string | null;
  onClearForwardError: () => void;
}) {
  const mailDisabled = row.mailConfigured ? null : "RFQ mail is not configured (RFQ_MAIL_APP_PASSWORD).";
  const [mailOpen, setMailOpen] = useState(Boolean(forwardError));
  const [waOpen, setWaOpen] = useState(false);

  // A failed row-level "Desk" send surfaces its error on the forward card —
  // the drawer has to open or the message stays hidden.
  useEffect(() => {
    if (forwardError) setMailOpen(true);
  }, [forwardError]);

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

      <DraftsDrawer
        title="Email drafts"
        hint="Forward to desk · confirmation to lead"
        badges={
          <>
            {row.forward.sentAtLabel && (
              <span className="rfq-mail-sent">
                <Icon name="check" size={11} strokeWidth={2.5} />
                Desk
              </span>
            )}
            {row.confirmation.sentAtLabel && (
              <span className="rfq-mail-sent">
                <Icon name="check" size={11} strokeWidth={2.5} />
                Lead
              </span>
            )}
          </>
        }
        open={mailOpen}
        onToggle={() => setMailOpen((v) => !v)}
      >
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
      </DraftsDrawer>

      <DraftsDrawer
        title="WhatsApp draft"
        hint={
          row.whatsapp.missing.length > 0
            ? `Asks for ${row.whatsapp.missing.join(", ")} (in Turkish)`
            : "Nothing missing — tells the lead pricing is underway (in Turkish)"
        }
        open={waOpen}
        onToggle={() => setWaOpen((v) => !v)}
      >
        <div className="rfq-mail-grid">
          <WhatsAppPreviewCard preview={row.whatsapp} />
        </div>
      </DraftsDrawer>

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

// ── Column layout (hide / reorder / resize, saved per user) ─────────────────
//
// The select-checkbox column and the row-actions (delete) column are fixed
// chrome; the 10 data columns between them are customizable. The layout is
// persisted to localStorage keyed by user id — same device-level persistence
// the Loads table uses, but scoped per account so shared machines don't leak
// layouts between users.

type SheetColumnKey =
  | "received" | "ref" | "subject" | "from" | "source"
  | "lane" | "mode" | "status" | "target" | "send";

type SheetColumn = {
  key: SheetColumnKey;
  label: string;
  // null = no fixed width; the column absorbs the remaining table width.
  width: number | null;
  numeric?: boolean;
};

const SHEET_COLUMNS: ReadonlyArray<SheetColumn> = [
  { key: "received", label: "Received", width: 74 },
  { key: "ref", label: "Ref", width: 112 },
  { key: "subject", label: "Subject", width: null },
  { key: "from", label: "From", width: 172 },
  { key: "source", label: "Source", width: 124 },
  { key: "lane", label: "Lane", width: 190 },
  { key: "mode", label: "Mode", width: 104 },
  { key: "status", label: "Status", width: 116 },
  { key: "target", label: "Target Price", width: 112, numeric: true },
  { key: "send", label: "Send", width: 120, numeric: true },
];

const COLUMN_KEYS = SHEET_COLUMNS.map((c) => c.key);
const COLUMN_BY_KEY = Object.fromEntries(SHEET_COLUMNS.map((c) => [c.key, c])) as
  Record<SheetColumnKey, SheetColumn>;
const MIN_COL_WIDTH = 60;
// Generous cap: on first resize every visible column's rendered width is
// snapshotted, and a flexed Subject on a wide screen can legitimately be huge.
const MAX_COL_WIDTH = 1200;
// Fixed chrome columns (select checkbox / row actions).
const SELECT_COL_WIDTH = 36;
const ACTIONS_COL_WIDTH = 32;

type SheetLayout = {
  order: SheetColumnKey[];
  hidden: SheetColumnKey[];
  widths: Partial<Record<SheetColumnKey, number>>;
};

function defaultLayout(): SheetLayout {
  return { order: [...COLUMN_KEYS], hidden: [], widths: {} };
}

// A stored layout may predate columns added since (or reference removed ones):
// unknown keys are dropped, new columns appear at their default position, and
// a layout that would hide everything falls back to all-visible.
function sanitizeLayout(raw: unknown): SheetLayout {
  if (!raw || typeof raw !== "object") return defaultLayout();
  const value = raw as Partial<Record<keyof SheetLayout, unknown>>;
  const known = (arr: unknown): SheetColumnKey[] =>
    Array.isArray(arr)
      ? [...new Set(arr.filter((k): k is SheetColumnKey => COLUMN_KEYS.includes(k as SheetColumnKey)))]
      : [];
  const storedOrder = known(value.order);
  const order = [...storedOrder, ...COLUMN_KEYS.filter((k) => !storedOrder.includes(k))];
  let hidden = known(value.hidden);
  if (hidden.length >= COLUMN_KEYS.length) hidden = [];
  const widths: Partial<Record<SheetColumnKey, number>> = {};
  if (value.widths && typeof value.widths === "object") {
    for (const key of COLUMN_KEYS) {
      const w = (value.widths as Record<string, unknown>)[key];
      if (typeof w === "number" && Number.isFinite(w)) {
        widths[key] = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(w)));
      }
    }
  }
  return { order, hidden, widths };
}

function RfqBulkBar({ ids, statusOptions, onDone }: {
  ids: string[];
  statusOptions: ReadonlyArray<SheetOption>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyStatus(status: string) {
    setMenuOpen(false);
    startTransition(async () => {
      setError(null);
      try {
        const res = await bulkUpdateInquiryStatusAction(ids, status);
        if ("error" in res) {
          setError(res.error);
          return;
        }
        onDone();
        router.refresh();
      } catch {
        setError("Could not update — check your connection and try again.");
      }
    });
  }

  return (
    <div className="bulk-action-bar">
      <span className="bulk-action-count">{ids.length} selected</span>
      {error && <span className="bulk-action-status" title={error}>{error}</span>}
      <div className="bulk-action-divider" />
      <button
        className="bulk-action-btn"
        disabled={busy}
        title="Set the selected RFQs to Ignored"
        onClick={() => applyStatus("IGNORED")}
      >
        <Icon name="x" size={11} /> {busy ? "Saving…" : "Ignore"}
      </button>
      <div className="bulk-action-dropdown">
        <button className="bulk-action-btn" disabled={busy} onClick={() => setMenuOpen((o) => !o)}>
          <Icon name="tag" size={11} /> Set status <Icon name="chevron-down" size={11} />
        </button>
        {menuOpen && (
          <div className="bulk-action-popover narrow">
            {statusOptions.map(([value, label]) => (
              <button
                key={value}
                className="inbox-popover-option"
                onClick={() => applyStatus(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="bulk-action-spacer">
        <button className="bulk-action-btn outline" disabled={busy} onClick={onDone}>Clear</button>
      </div>
    </div>
  );
}

// Debounced URL search: typing rewrites ?q= (keeping whatever else is in the
// URL, like the status tab) so the server re-queries all RFQs, not just the
// 200 rendered rows.
function RfqSearchBar({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [busy, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The query this component last navigated to (or adopted from the URL) —
  // guards against re-navigating when the prop changes underneath.
  const applied = useRef(initialQuery);
  const debounced = useDebouncedValue(value, 350);

  // An external navigation (tab link, sidebar link, back button) changed the
  // URL's q — adopt it, unless the user is mid-typing in this input.
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    applied.current = initialQuery;
    setValue(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const next = debounced.trim().slice(0, 120);
    if (next === applied.current) return;
    applied.current = next;
    // Read the rest of the query string at fire time — props can lag a
    // just-clicked tab whose server render hasn't committed yet.
    const params = new URLSearchParams(window.location.search);
    if (next) params.set("q", next);
    else params.delete("q");
    const qs = params.toString();
    startTransition(() => {
      router.replace(`/dashboard/rfq${qs ? `?${qs}` : ""}` as "/dashboard/rfq", { scroll: false });
    });
  }, [debounced, router]);

  return (
    <div className={`rfq-search${busy ? " rfq-search-busy" : ""}`}>
      <Icon name="search" size={13} strokeWidth={2} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") setValue(""); }}
        placeholder="Search RFQs — subject, ref, company, lane…"
        aria-label="Search RFQs"
      />
      {value && (
        <button
          type="button"
          className="rfq-search-clear"
          aria-label="Clear search"
          onClick={() => setValue("")}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function RfqSheet({ rows, statusOptions, modeOptions, userId, searchQuery }: {
  rows: RfqRowData[];
  statusOptions: ReadonlyArray<SheetOption>;
  modeOptions: ReadonlyArray<SheetOption>;
  userId: string;
  searchQuery: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // ── Column layout, persisted per user ──
  const storageKey = `derya.rfqSheet.layout.${userId}`;
  const [layout, setLayout] = useState<SheetLayout>(defaultLayout);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [dragKey, setDragKey] = useState<SheetColumnKey | null>(null);
  const [dropKey, setDropKey] = useState<SheetColumnKey | null>(null);
  const [resizingKey, setResizingKey] = useState<SheetColumnKey | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setLayout(sanitizeLayout(JSON.parse(raw)));
    } catch {}
    setLayoutLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (layoutLoaded) {
      try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch {}
    }
  }, [layout, layoutLoaded, storageKey]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    if (pickerOpen) document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [pickerOpen]);

  // Stable across width changes so row memoization holds while resizing.
  const columns = useMemo(
    () => layout.order.filter((k) => !layout.hidden.includes(k)).map((k) => COLUMN_BY_KEY[k]),
    [layout.order, layout.hidden],
  );
  const colSpan = columns.length + 2;

  // Two width modes. Untouched layout: table fills the shell and Subject
  // flexes into the leftover space. Once the user has resized anything, every
  // column is a definite px and the table is exactly their sum — otherwise
  // the browser redistributes slack into the flex column, and a drag on one
  // edge visibly moves other columns the opposite way.
  const customized = Object.keys(layout.widths).length > 0;
  const colPx = (c: SheetColumn) => layout.widths[c.key] ?? c.width ?? 300;
  const tableWidth = customized
    ? SELECT_COL_WIDTH + columns.reduce((sum, c) => sum + colPx(c), 0) + ACTIONS_COL_WIDTH
    : null;

  function toggleHidden(key: SheetColumnKey) {
    setLayout((prev) => {
      const hidden = prev.hidden.includes(key)
        ? prev.hidden.filter((k) => k !== key)
        : [...prev.hidden, key];
      if (hidden.length >= COLUMN_KEYS.length) return prev; // keep ≥1 column visible
      return { ...prev, hidden };
    });
  }

  // Classic sortable semantics: the dragged column lands on the target's slot;
  // dragging rightwards inserts after the target so the last slot is reachable.
  function moveColumn(from: SheetColumnKey, to: SheetColumnKey) {
    if (from === to) return;
    setLayout((prev) => {
      const order = [...prev.order];
      const fromIdx = order.indexOf(from);
      const toIdx = order.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;
      order.splice(fromIdx, 1);
      order.splice(order.indexOf(to) + (fromIdx < toIdx ? 1 : 0), 0, from);
      return { ...prev, order };
    });
  }

  function startResize(e: React.PointerEvent, key: SheetColumnKey) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    const startWidth = th?.getBoundingClientRect().width
      ?? layout.widths[key] ?? COLUMN_BY_KEY[key].width ?? 160;
    const startX = e.clientX;
    // Lock every visible column to its current rendered width before tracking
    // the drag. From here on the table is exactly as wide as its columns — no
    // flex slack to redistribute — so the dragged edge follows the pointer
    // instead of the freed space flowing back into the flex column and
    // shoving everything the other way.
    const headerRow = th?.parentElement;
    if (headerRow) {
      const ths = headerRow.querySelectorAll("th.rfq-th");
      setLayout((prev) => {
        const widths = { ...prev.widths };
        columns.forEach((c, i) => {
          const el = ths[i];
          if (el && widths[c.key] == null) {
            widths[c.key] = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(el.getBoundingClientRect().width)));
          }
        });
        return { ...prev, widths };
      });
    }
    setResizingKey(key);
    const onMove = (ev: PointerEvent) => {
      const width = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX)));
      setLayout((prev) => ({ ...prev, widths: { ...prev.widths, [key]: width } }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizingKey(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ── Selection ──
  // Selection can outlive a refresh or a tab switch (this component instance
  // persists across server re-renders), so act only on ids still visible.
  const selectedVisible = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && selectedVisible.length === rows.length;

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleOpen = useCallback((id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  }, []);
  const expandRow = useCallback((id: string) => setOpenId(id), []);

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  const dragIdx = dragKey ? columns.findIndex((c) => c.key === dragKey) : -1;

  return (
    <>
      {selectedVisible.length > 0 && (
        <RfqBulkBar
          ids={selectedVisible}
          statusOptions={statusOptions}
          onDone={() => setSelected(new Set())}
        />
      )}
      <div className="table-toolbar rfq-sheet-toolbar">
        <RfqSearchBar initialQuery={searchQuery} />
        <div ref={pickerRef} className="table-picker">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen((o) => !o)}>
            <Icon name="grid" size={12} />
            Columns ({columns.length})
          </button>
          {pickerOpen && (
            <div className="table-picker-menu">
              {layout.order.map((key) => {
                const def = COLUMN_BY_KEY[key];
                const visible = !layout.hidden.includes(key);
                return (
                  <label key={key} className="table-picker-option">
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={visible && columns.length === 1}
                      onChange={() => toggleHidden(key)}
                    />
                    {def.label}
                  </label>
                );
              })}
              <button
                type="button"
                className="rfq-layout-reset"
                onClick={() => setLayout(defaultLayout())}
              >
                Reset layout
              </button>
            </div>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="card empty-state-card">
          <Icon name={searchQuery ? "search" : "inbox"} size={36} className="empty-state-graphic" />
          <div className="empty-state-title">No RFQs match</div>
          <p className="empty-state-copy">
            {searchQuery
              ? `Nothing in this view matches “${searchQuery}”. Try another term, or clear the search.`
              : "RFQs arrive from linked email threads or manual entry. Try another status filter, or add one manually."}
          </p>
          {!searchQuery && (
            <Link href="/dashboard/rfq/new" className="btn">
              New RFQ
            </Link>
          )}
        </div>
      ) : (
      <div className="card table-shell">
        <table className="data-table sheet-table rfq-sheet" style={tableWidth != null ? { width: tableWidth, minWidth: tableWidth } : undefined}>
          <colgroup>
            <col style={{ width: SELECT_COL_WIDTH }} />
            {columns.map((c) => {
              const width = customized ? colPx(c) : c.width;
              return <col key={c.key} style={width != null ? { width } : undefined} />;
            })}
            <col style={{ width: ACTIONS_COL_WIDTH }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ cursor: "default" }} className="rfq-select-cell">
                <label className="rfq-select-box" title={allSelected ? "Clear selection" : "Select all"}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && selectedVisible.length > 0;
                    }}
                    onChange={toggleSelectAll}
                    aria-label={allSelected ? "Clear selection" : "Select all RFQs"}
                  />
                </label>
              </th>
              {columns.map((c, idx) => {
                const isDrop = dropKey === c.key && dragKey != null && dragKey !== c.key;
                const dropCls = isDrop
                  ? dragIdx !== -1 && dragIdx < idx ? " rfq-th-drop-right" : " rfq-th-drop-left"
                  : "";
                return (
                  <th
                    key={c.key}
                    className={`rfq-th${c.numeric ? " numeric" : ""}${dragKey === c.key ? " rfq-th-dragging" : ""}${resizingKey === c.key ? " rfq-th-resizing" : ""}${dropCls}`}
                    title="Drag to move · drag the right edge to resize"
                    draggable={resizingKey == null}
                    onDragStart={(e) => {
                      setDragKey(c.key);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.key);
                    }}
                    onDragOver={(e) => {
                      if (!dragKey) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dropKey !== c.key) setDropKey(c.key);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey) moveColumn(dragKey, c.key);
                      setDragKey(null);
                      setDropKey(null);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropKey(null);
                    }}
                  >
                    {c.label}
                    <span
                      className="rfq-th-resize"
                      aria-hidden="true"
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => startResize(e, c.key)}
                    />
                  </th>
                );
              })}
              <th style={{ cursor: "default" }} aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <MemoRowPair
                key={row.id}
                row={row}
                open={openId === row.id}
                selected={selected.has(row.id)}
                columns={columns}
                colSpan={colSpan}
                statusOptions={statusOptions}
                modeOptions={modeOptions}
                onToggle={toggleOpen}
                onExpand={expandRow}
                onToggleSelect={toggleSelect}
              />
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}

function RowPair({ row, open, selected, columns, colSpan, statusOptions, modeOptions, onToggle, onExpand, onToggleSelect }: {
  row: RfqRowData;
  open: boolean;
  selected: boolean;
  columns: ReadonlyArray<SheetColumn>;
  colSpan: number;
  statusOptions: ReadonlyArray<SheetOption>;
  modeOptions: ReadonlyArray<SheetOption>;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
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

  function cell(column: SheetColumn) {
    switch (column.key) {
      case "received":
        return (
          <td key="received" className="data-muted rfq-ro" title={row.receivedFull}>{row.receivedAgo}</td>
        );
      case "ref":
        return (
          <td key="ref" className="data-cell-mono rfq-ro">{row.reference ?? <span className="data-muted">—</span>}</td>
        );
      case "subject":
        return (
          <td key="subject">
            <div className="rfq-subject-cell">
              <button
                type="button"
                className="rfq-row-caret"
                aria-expanded={open}
                aria-label={open ? "Collapse load details" : "Expand load details"}
                title={open ? "Collapse load details" : "Expand load details"}
                onClick={() => onToggle(row.id)}
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
        );
      case "from":
        return (
          <td key="from">
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
        );
      case "source":
        return (
          <td key="source" className="rfq-ro">
            <div>{row.sourceLabel}</div>
            {row.sourceDetail && <div className="data-subline">{row.sourceDetail}</div>}
          </td>
        );
      case "lane":
        return (
          <td key="lane">
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
        );
      case "mode":
        return (
          <td key="mode">
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
        );
      case "status":
        return (
          <td key="status">
            <CellSelect
              key={`st${rev("status")}:${row.status}`}
              value={row.status}
              options={statusOptions}
              allowCreate
              createLabel="Add status…"
              onCommit={(v) => commit({ status: v })}
            />
          </td>
        );
      case "target":
        return (
          <td key="target" className="numeric">
            <CellInput
              key={`ta${rev("target")}:${row.targetInput}`}
              value={row.targetInput}
              placeholder={row.targetPlaceholder}
              title='Target price — e.g. "USD 1200", "no target", or empty for ask'
              onCommit={(v) => commit({ target: v })}
            />
          </td>
        );
      case "send":
        return (
          <td key="send" className="numeric rfq-ro">
            <RowSendCell row={row} onExpand={() => onExpand(row.id)} onError={setForwardError} />
          </td>
        );
    }
  }

  return (
    <>
      <tr
        className={`data-row${open ? " rfq-row-open" : ""}${selected ? " rfq-row-selected" : ""}${busy ? " sheet-row-busy" : ""}`}
        aria-expanded={open}
        tabIndex={0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a, button, input, textarea, select, .sheet-select-menu")) return; // inner controls win
          onToggle(row.id);
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return; // let inner controls keep their keys
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(row.id);
          }
        }}
      >
        <td className="rfq-ro rfq-select-cell">
          <label className="rfq-select-box" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(row.id)}
              aria-label={`Select RFQ ${row.reference ?? row.subject}`}
            />
          </label>
        </td>
        {columns.map((c) => cell(c))}
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

// Rows skip re-rendering while headers are dragged/resized (layout width
// changes touch only the colgroup) and when other rows are selected/expanded.
const MemoRowPair = memo(RowPair);
