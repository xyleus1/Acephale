import type { WorldCompany } from "../../generated/world-client";

export type CompanyPromotion = {
  name: string;
  domain: string | null;
  website: string | null;
  linkedinUrl: string | null;
  crmSource: "world";
  sourceRefs: {
    worldCompanyId: string;
    sources: string[];
  };
};

/** Build the main CRM company-shaped promotion payload without writing to either database. */
export function buildCompanyPromotion(world: WorldCompany): CompanyPromotion {
  const sourceRefs = world.legalIds && typeof world.legalIds === "object" && !Array.isArray(world.legalIds)
    ? Object.keys(world.legalIds as Record<string, unknown>)
    : [];
  return {
    name: world.canonicalName,
    domain: world.domain,
    website: world.website,
    linkedinUrl: world.linkedinUrl,
    crmSource: "world",
    sourceRefs: {
      worldCompanyId: world.id,
      sources: sourceRefs,
    },
  };
}
