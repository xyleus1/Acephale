"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

export function CollapsibleCard({
  title,
  meta,
  defaultOpen = true,
  agentTarget,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  agentTarget?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" data-agent-target={agentTarget}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="collapsible-header"
      >
        <span className="collapsible-title">{title}</span>
        {meta && <span className="collapsible-meta">{meta}</span>}
        <span className="collapsible-spacer" />
        <Icon name={open ? "chevron-up" : "chevron-down"} size={13} strokeWidth={2} />
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
