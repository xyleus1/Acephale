export type ManufacturerEvidence = {
  kind: "uk_sic" | "sic" | "nace" | "naics" | "industry_label";
  value: string;
};

const INDUSTRY_LABELS = new Set([
  "machinery",
  "industrial automation",
  "electrical/electronic manufacturing",
  "mechanical or industrial engineering",
  "automotive",
  "aviation & aerospace",
  "chemicals",
  "plastics",
  "textiles",
  "apparel & fashion",
  "food production",
  "food & beverages",
  "building materials",
  "paper & forest products",
  "glass, ceramics & concrete",
  "mining & metals",
  "packaging and containers",
  "furniture",
  "consumer goods",
  "consumer electronics",
  "medical devices",
  "pharmaceuticals",
  "semiconductors",
  "railroad manufacture",
  "shipbuilding",
  "defense & space",
  "dairy",
  "tobacco",
  "wine and spirits",
  "sporting goods",
  "luxury goods & jewelry",
  "cosmetics",
  "printing",
  "renewables & environment",
  "oil & energy",
  "leather",
  "computer hardware",
]);

function sectionC(code: string) {
  const prefix = code.trim().replace(/\D/g, "").slice(0, 2);
  const number = Number(prefix);
  return number >= 10 && number <= 33;
}

function usSicManufacturing(code: string) {
  const prefix = code.trim().replace(/\D/g, "").slice(0, 2);
  const number = Number(prefix);
  return number >= 20 && number <= 39;
}

export function classifyManufacturer(input: {
  ukSic?: string[];
  sic?: string[];
  nace?: string[];
  naics?: string[];
  industryLabels?: string[];
}) {
  const evidence: ManufacturerEvidence[] = [];
  for (const value of input.ukSic ?? []) if (sectionC(value)) evidence.push({ kind: "uk_sic", value });
  for (const value of input.sic ?? []) if (usSicManufacturing(value)) evidence.push({ kind: "sic", value });
  for (const value of input.nace ?? []) if (sectionC(value)) evidence.push({ kind: "nace", value });
  for (const value of input.naics ?? []) {
    const prefix = value.trim().replace(/\D/g, "").slice(0, 2);
    if (["31", "32", "33"].includes(prefix)) evidence.push({ kind: "naics", value });
  }
  for (const value of input.industryLabels ?? []) {
    if (INDUSTRY_LABELS.has(value.trim().toLowerCase())) evidence.push({ kind: "industry_label", value });
  }
  return { isManufacturer: evidence.length > 0, evidence };
}
