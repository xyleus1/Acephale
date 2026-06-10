"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobNote } from "@/app/dashboard/jobs/[jobId]/actions";

// Quick personal note on a job — saved on blur or via the Save button.
export function JobNote({ jobId, initial }: { jobId: string; initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);
  const [busy, startTransition] = useTransition();
  const dirty = value !== savedValue;

  function save() {
    if (!dirty) return;
    startTransition(async () => {
      await updateJobNote(jobId, value);
      setSavedValue(value);
      router.refresh();
    });
  }

  return (
    <div style={{ padding: "12px 18px" }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        rows={3}
        placeholder="Add a short note — only you see this. e.g. 'Waiting on packing list from supplier'"
        style={{
          width: "100%", resize: "vertical", fontSize: 13, lineHeight: 1.5,
          padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 4,
          background: "var(--surface)", color: "var(--text)", outline: "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 6, minHeight: 24 }}>
        {busy ? (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Saving…</span>
        ) : dirty ? (
          <button type="button" onClick={save} className="btn btn-sm" style={{ fontSize: 11.5 }}>Save note</button>
        ) : savedValue ? (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Saved</span>
        ) : null}
      </div>
    </div>
  );
}
