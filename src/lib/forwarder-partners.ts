// Partner forwarders the desk hands RFQs to (Mert, 2026-07-24). Tracked per
// RFQ in Inquiry.forwardedTo as a JSON string[] - the chips on the RFQ detail
// page toggle membership.

export const FORWARDER_PARTNERS = ["KINAY", "ORIGIN", "ANDELOG", "CTT"] as const;

export function parseForwardedTo(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json);
    return Array.isArray(value)
      ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.trim().length > 0))]
      : [];
  } catch {
    return [];
  }
}
