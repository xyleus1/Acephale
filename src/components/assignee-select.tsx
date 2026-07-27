"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { CellSelect } from "@/components/sheet-cells";
import { updateInquiryRowAction } from "@/app/dashboard/rfq/actions";

export type AssigneeOption = readonly [string, string]; // [userId, fullName]

// Who owns this RFQ. Anyone can assign anyone (small desk); "" = Unassigned.
// Self-contained (action + refresh inside) so it drops into the US card and
// the detail hero without plumbing; the TR sheet column uses its own commit
// path through the shared row patch instead.
export function AssigneeSelect({ inquiryId, value, options, compact }: {
  inquiryId: string;
  value: string | null;
  options: ReadonlyArray<AssigneeOption>;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  function commit(next: string) {
    startTransition(async () => {
      setError(null);
      try {
        const res = await updateInquiryRowAction(inquiryId, { assignedToUserId: next });
        if ("error" in res) {
          setError(res.error);
          setRev((r) => r + 1); // remount back to the stored value
          return;
        }
        router.refresh();
      } catch {
        setError("Could not save the assignment - try again.");
        setRev((r) => r + 1);
      }
    });
  }

  return (
    <div
      className={`assignee-select${value ? "" : " assignee-select--empty"}${compact ? " assignee-select--compact" : ""}${busy ? " assignee-select--busy" : ""}`}
      title={error ?? (value ? undefined : "Unassigned - pick an owner")}
      onClick={(e) => e.stopPropagation()}
    >
      <Icon name="user" size={12} strokeWidth={2.25} />
      <CellSelect
        key={`as:${rev}:${value ?? ""}`}
        value={value}
        options={[["", "Unassigned"], ...options]}
        onCommit={commit}
      />
    </div>
  );
}
