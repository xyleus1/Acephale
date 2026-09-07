"use client";

import { useState, useTransition } from "react";
import {
  cancelOutreachCampaign,
  pauseOutreachCampaign,
  resumeOutreachCampaign,
} from "@/app/dashboard/outreach-campaign-actions";

export function ActiveCampaignControls({
  campaignId,
  status,
  className,
}: {
  campaignId: string;
  status: "ACTIVE" | "PAUSED";
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: (campaignId: string) => Promise<void>) => {
    setError(null);
    startTransition(() => {
      void action(campaignId).catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Campaign action failed.");
      });
    });
  };
  return (
    <div className={className}>
      {error ? <div role="alert">{error}</div> : null}
      {status === "ACTIVE" ? (
        <button type="button" disabled={pending} onClick={() => run(pauseOutreachCampaign)}>
          Pause
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={() => run(resumeOutreachCampaign)}>
          Resume
        </button>
      )}
      <button type="button" disabled={pending} onClick={() => run(cancelOutreachCampaign)}>
        Stop
      </button>
    </div>
  );
}
