"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResearchStatus } from "@/lib/research-lists";
import styles from "./research.module.css";

export function ResearchStatusControl({
  slug,
  recordId,
  status,
  onChanged,
}: {
  slug: string;
  recordId: string;
  status: ResearchStatus;
  onChanged?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function update(nextStatus: ResearchStatus) {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/research/${encodeURIComponent(slug)}/records/${encodeURIComponent(recordId)}/status`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Status could not be updated.");
      }
      if (onChanged) await onChanged();
      else router.refresh();
    } catch {
      if (!onChanged) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className={styles.statusControl}
      value={status}
      disabled={busy}
      onChange={(event) => update(event.target.value as ResearchStatus)}
      aria-label="Record status"
    >
      <option value="new">New</option>
      <option value="reviewed">Reviewed</option>
      <option value="rejected">Rejected</option>
    </select>
  );
}
