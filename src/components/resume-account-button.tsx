"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { resumeEmailAccount } from "@/lib/gmail-sync";

export function ResumeAccountButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  function resume() {
    startTransition(async () => {
      await resumeEmailAccount(accountId);
      router.refresh();
    });
  }

  return (
    <button
      onClick={resume}
      disabled={busy}
      className="btn btn-sm"
      style={{ fontSize: 12 }}
    >
      {busy ? "…" : "Resume"}
    </button>
  );
}
