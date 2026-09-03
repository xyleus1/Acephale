import type { CampaignPlan } from "@/lib/procurement-campaign-class";

export type CampaignProgress = {
  goodLeads: number;
  quotesRecorded: number;
  discoveryExhausted: boolean;
};

export type CampaignConvergence =
  | {
    done: true;
    reason: "quote_goal_reached" | "good_lead_target_reached" | "discovery_exhausted";
    remainingGoodLeads: 0;
  }
  | { done: false; reason: "collecting"; remainingGoodLeads: number };

export function campaignConvergence(
  plan: CampaignPlan,
  progress: CampaignProgress,
): CampaignConvergence {
  const remainingGoodLeads = Math.max(0, plan.targetGoodCompanies - progress.goodLeads);
  if (progress.quotesRecorded >= plan.quoteGoal) {
    return { done: true, reason: "quote_goal_reached", remainingGoodLeads: 0 };
  }
  if (progress.goodLeads >= plan.targetGoodCompanies) {
    return { done: true, reason: "good_lead_target_reached", remainingGoodLeads: 0 };
  }
  if (progress.discoveryExhausted) {
    return { done: true, reason: "discovery_exhausted", remainingGoodLeads: 0 };
  }
  return { done: false, reason: "collecting", remainingGoodLeads };
}
