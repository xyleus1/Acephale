"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";

export type RfqRowData = {
  id: string;
  receivedAgo: string;
  receivedFull: string;
  subject: string;
  from: string;
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
  statusLabel: string;
  statusCls: string;
  target: string;
  facts: Array<{ label: string; value: string }>;
  leadAnswers: Array<{ label: string; value: string }>;
  notesExcerpt: string | null;
};

function ExpandedPanel({ row }: { row: RfqRowData }) {
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

      <div className="rfq-expand-actions">
        <Link href={`/dashboard/rfq/${row.id}` as never} className="btn btn-sm">
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

export function RfqExpandableRows({ rows, colSpan }: { rows: RfqRowData[]; colSpan: number }) {
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
            onToggle={() => setOpenId(open ? null : row.id)}
          />
        );
      })}
    </tbody>
  );
}

function RowPair({ row, open, colSpan, onToggle }: {
  row: RfqRowData;
  open: boolean;
  colSpan: number;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`data-row${open ? " rfq-row-open" : ""}`}
        aria-expanded={open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) return; // inner links win
          onToggle();
        }}
      >
        <td className="data-muted" title={row.receivedFull}>{row.receivedAgo}</td>
        <td>
          <span className="rfq-row-caret" aria-hidden>
            <Icon name="chevron-right" size={12} strokeWidth={2.5} />
          </span>
          <span className="data-cell-strong">{row.subject}</span>
        </td>
        <td>
          <div>{row.from}</div>
          {row.fromEmail && row.from !== row.fromEmail && (
            <div className="data-subline">{row.fromEmail}</div>
          )}
        </td>
        <td>
          <div>{row.sourceLabel}</div>
          {row.sourceDetail && <div className="data-subline">{row.sourceDetail}</div>}
        </td>
        <td>
          {row.origin || row.destination ? (
            <span>{row.origin ?? "?"} → {row.destination ?? "?"}</span>
          ) : (
            <span className="data-muted">—</span>
          )}
        </td>
        <td>{row.mode ?? <span className="data-muted">—</span>}</td>
        <td><span className={`badge ${row.statusCls}`}>{row.statusLabel}</span></td>
        <td className="numeric">{row.target}</td>
      </tr>
      {open && (
        <tr className="rfq-expand-row">
          <td colSpan={colSpan}>
            <ExpandedPanel row={row} />
          </td>
        </tr>
      )}
    </>
  );
}
