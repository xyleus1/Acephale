"use client";

import { Icon } from "@/components/icon";

// Friendly boundary for anything that throws inside the dashboard segment.
// The sidebar and topbar stay up; only the page area swaps to this.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="boundary">
      <div className="boundary-icon">
        <Icon name="alert" size={22} />
      </div>
      <h1>This page hit an error</h1>
      <p>The rest of the desk is fine. Try again; if it keeps failing, share the reference code below.</p>
      {error.digest && <code className="boundary-digest">ref {error.digest}</code>}
      <div className="boundary-actions">
        <button type="button" className="boundary-btn" onClick={reset}>
          Try again
        </button>
        <a href="/dashboard" className="boundary-link">
          Back to Deal Desk
        </a>
      </div>
    </div>
  );
}
