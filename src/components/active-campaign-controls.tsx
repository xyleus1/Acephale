"use client";

import { useTransition } from "react";
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
  const run = (action: (campaignId: string) => Promise<void>) => {
    startTransition(() => {
      void action(campaignId);
    });
  };
  return (
    <div className={className}>
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
