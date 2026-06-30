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
    <div className="job-note-editor">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        rows={3}
        placeholder="Private operating note - internal only. Example: Waiting on packing list from supplier."
        className="job-note-textarea"
      />
      <div className="job-note-actions">
        {busy ? (
          <span className="job-note-status">Saving...</span>
        ) : dirty ? (
          <button type="button" onClick={save} className="btn btn-sm job-note-save">Save note</button>
        ) : savedValue ? (
          <span className="job-note-status">Saved</span>
        ) : null}
      </div>
    </div>
  );
}
