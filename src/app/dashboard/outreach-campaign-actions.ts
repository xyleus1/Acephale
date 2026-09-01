"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { cancelCampaign, pauseCampaign, resumeCampaign } from "@/lib/outreach-campaigns";

async function officeCampaignAction(
  action: typeof pauseCampaign,
  campaignId: string,
): Promise<void> {
  const session = await requireSession();
  if (session.accessKind === "customer" || session.role === "EMPLOYEE") {
    throw new Error("Only operator accounts can manage outreach campaigns.");
  }
  await action({ officeId: session.officeId, campaignId });
  revalidatePath("/dashboard", "layout");
}

export async function pauseOutreachCampaign(campaignId: string) {
  return officeCampaignAction(pauseCampaign, campaignId);
}

export async function resumeOutreachCampaign(campaignId: string) {
  return officeCampaignAction(resumeCampaign, campaignId);
}

export async function cancelOutreachCampaign(campaignId: string) {
  return officeCampaignAction(cancelCampaign, campaignId);
}
