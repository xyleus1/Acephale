"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { subscribe, getSelected, clear } from "./bulk-select-store";
import { proposeBulkHideThreads, bulkSnoozeThreads, bulkLinkThreadsToInquiry } from "@/lib/thread-actions";
import { Icon } from "@/components/icon";

type OpenInquiry = { id: string; subject: string; type: string };

export function BulkActionBar({ inquiries }: { inquiries: OpenInquiry[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [count, setCount] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => subscribe(() => setCount(getSelected().length)), []);

  if (count === 0) return null;

  function done() {
    clear();
    router.refresh();
  }

  function hide() {
    start(async () => {
      const ids = getSelected();
      const result = await proposeBulkHideThreads(ids);
      if ("error" in result) {
        setMsg(result.error);
        return;
      }
      setMsg("Hide proposal created");
      done();
      setTimeout(() => setMsg(null), 5000);
    });
  }
  function snooze(until: "4h" | "tomorrow" | "monday") {
    start(async () => {
      const ids = getSelected();
      await bulkSnoozeThreads(ids, until);
      done();
    });
  }
  function linkTo(inquiryId: string) {
    start(async () => {
      const ids = getSelected();
      await bulkLinkThreadsToInquiry(ids, inquiryId);
      setLinkOpen(false);
      done();
    });
  }

  return (
    <div className="bulk-action-bar">
      <span className="bulk-action-count">{count} selected</span>
      {msg && <span className="bulk-action-status">{msg}</span>}
      <div className="bulk-action-divider" />
      <button onClick={hide} disabled={busy} className="bulk-action-btn">
        <Icon name="x" size={11} /> Propose hide
      </button>
      <BulkDropdown
        label={<><Icon name="clock" size={11} /> Snooze</>}
        options={[
          { label: "4 hours", on: () => snooze("4h") },
          { label: "Tomorrow 9am", on: () => snooze("tomorrow") },
          { label: "Next Monday", on: () => snooze("monday") },
        ]}
        disabled={busy}
      />
      <button
        onClick={() => setLinkOpen((o) => !o)}
        disabled={busy || inquiries.length === 0}
        className="bulk-action-btn"
        title={inquiries.length === 0 ? "No open inquiries to link to" : undefined}
      >
        <Icon name="layers" size={11} /> Link to load
      </button>
      <div className="bulk-action-spacer">
        <button onClick={done} className="bulk-action-btn outline">Clear</button>
      </div>
      {linkOpen && (
        <div className="bulk-action-popover">
          <div className="bulk-action-popover-title">
            Link {count} thread{count === 1 ? "" : "s"} to…
          </div>
          {inquiries.map((i) => (
            <button
              key={i.id}
              onClick={() => linkTo(i.id)}
              className="inbox-popover-option"
            >
              <div className="inbox-popover-option-title">{i.subject}</div>
              <div className="inbox-popover-option-meta">{i.type}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BulkDropdown({ label, options, disabled }: {
  label: React.ReactNode;
  options: { label: string; on: () => void }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bulk-action-dropdown">
      <button onClick={() => setOpen((o) => !o)} disabled={disabled} className="bulk-action-btn">{label}</button>
      {open && (
        <div className="bulk-action-popover narrow">
          {options.map((o) => (
            <button
              key={o.label}
              onClick={() => { setOpen(false); o.on(); }}
              className="inbox-popover-option"
            >{o.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
