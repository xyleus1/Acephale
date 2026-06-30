"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { snoozeThread, unsnoozeThread } from "@/lib/thread-actions";
import { Icon } from "@/components/icon";

const PRESETS: { key: "4h" | "tomorrow" | "monday"; label: string }[] = [
  { key: "4h",       label: "4 hours" },
  { key: "tomorrow", label: "Tomorrow 9am" },
  { key: "monday",   label: "Next Monday" },
];

export function SnoozeThreadButton({ threadId, snoozedUntil }: { threadId: string; snoozedUntil: string | null }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);

  const isSnoozed = !!snoozedUntil && new Date(snoozedUntil) > new Date();

  function pick(key: "4h" | "tomorrow" | "monday") {
    setOpen(false);
    start(async () => {
      await snoozeThread(threadId, key);
      router.refresh();
    });
  }
  function unsnooze(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      await unsnoozeThread(threadId);
      router.refresh();
    });
  }

  if (isSnoozed) {
    const wake = new Date(snoozedUntil!);
    return (
      <button
        type="button"
        onClick={unsnooze}
        disabled={busy}
        title={`Snoozed until ${wake.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
        className="inbox-action-btn soft-brand"
      >
        <Icon name="clock" size={11} />
        {busy ? "…" : `Wakes ${wake.toLocaleString("en-GB", { day: "numeric", month: "short" })}`}
      </button>
    );
  }

  return (
    <div className="inbox-action-popover-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        disabled={busy}
        title="Snooze thread until later"
        className="inbox-action-btn"
      >
        <Icon name="clock" size={11} />
        Snooze
      </button>
      {open && (
        <div className="inbox-popover snooze">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pick(p.key)}
              className="inbox-popover-option"
            >{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
