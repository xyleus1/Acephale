export const CAMPAIGN_DESK_SCOPE = "/dashboard/supply-os/outreach";
export const CAMPAIGN_APPLY_COMMAND = /^apply(?:\s+update)?\s+([a-z0-9]+)/i;
export const CAMPAIGN_GREENLIGHT_COMMAND = /^(greenlight|green ?light|send it|approve it|go ahead)\b/i;

export function isCampaignDeskScope(scopePage?: string): boolean {
  if (!scopePage || typeof scopePage !== "string") return false;
  const [rawPath] = scopePage.slice(0, 600).split("?");
  return rawPath.replace(/\/+$/, "") === CAMPAIGN_DESK_SCOPE;
}
