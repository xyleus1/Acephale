import { MANEKS_CORRIDOR_PROFILE, MANEKS_PROFILE } from "./profile";
import { FEAST_PROFILE } from "./profile-feast";
import { WENS_PROFILE } from "./profile-wens";
import type { LeadGenProfile } from "./profile";

export const LEADGEN_PROFILES: Readonly<Record<string, LeadGenProfile>> = {
  maneks: MANEKS_PROFILE,
  "maneks-corridor": MANEKS_CORRIDOR_PROFILE,
  wens: WENS_PROFILE,
  feast: FEAST_PROFILE,
};

export function resolveLeadGenProfile(slug: string): LeadGenProfile {
  const profile = LEADGEN_PROFILES[slug];
  if (profile) return profile;
  const validSlugs = Object.keys(LEADGEN_PROFILES).join(", ");
  throw new Error(`Unknown leadgen profile "${slug}". Valid slugs: ${validSlugs}`);
}
