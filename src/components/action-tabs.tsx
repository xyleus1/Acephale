"use client";
import { useState } from "react";

type Tab = { label: string; icon: string };

export function ActionTabs({
  tabs,
  children,
}: {
  tabs: Tab[];
  children: React.ReactNode[];
}) {
  const [active, setActive] = useState(0);

  return (
    <div className="action-tabs-panel">
      <div className="action-tabs-header">
        {tabs.map((tab, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={`action-tab-btn${active === i ? " active" : ""}`}
          >
            <span className="action-tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="action-tabs-body">
        {(children as React.ReactNode[]).map((child, i) => (
          <div key={i} style={{ display: i === active ? "block" : "none" }}>
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
