"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideThread, unhideThread } from "@/lib/thread-actions";
import { Icon } from "@/components/icon";

export function HideThreadButton({ threadId, hidden }: { threadId: string; hidden: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  function go(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      if (hidden) await unhideThread(threadId);
      else await hideThread(threadId);
      router.refresh();
    });
  }
  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      title={hidden ? "Restore to active inbox" : "Hide - not freight-related"}
      className="inbox-action-btn"
    >
      <Icon name={hidden ? "check" : "x"} size={11} />
      {busy ? "…" : hidden ? "Restore" : "Hide"}
    </button>
  );
}
