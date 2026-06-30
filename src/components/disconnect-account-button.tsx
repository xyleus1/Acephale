"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectEmailAccount } from "@/lib/gmail-sync";

export function DisconnectAccountButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  function disconnect() {
    if (!confirm("Pause this inbox? Sync stops and its emails are hidden from the Inbox — nothing is deleted. You can resume any time.")) return;
    startTransition(async () => {
      await disconnectEmailAccount(accountId);
      router.refresh();
    });
  }

  return (
    <button
      onClick={disconnect}
      disabled={busy}
      className="btn btn-secondary btn-sm"
      style={{ fontSize: 12 }}
    >
      {busy ? "…" : "Pause"}
    </button>
  );
}
