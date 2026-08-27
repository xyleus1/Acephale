// Category rules for a supplier sourcing wave. Everything here is pure so the
// gate that decides whether a crawled site is a real producer is testable and
// reproducible, and never depends on a model's opinion.
//
// The first foam campaign is the reason this file exists: "memory foam
// manufacturer" reaches bedding retailers and foam converters, so a wave that
// only matched the words contacted shops that cut blocks instead of shops that
// mold them. A category now states the capability evidence a site must publish
// before it can be mailed.

export type SupplierCapabilityRule = {
  label: string;
  pattern: RegExp;
};

export type SupplierSourcingCategoryKey = "pcba" | "molded-foam";

export type SupplierSourcingCategory = {
  key: SupplierSourcingCategoryKey;
  label: string;
  /** Matched against the request material, specification, and notes. */
  request: RegExp;
  /** Search phrases, cycled and combined with regions to widen a wave. */
  queries: readonly string[];
  regions: readonly string[];
  /** Evidence the site must publish. Every rule has to hit. */
  requiredAll: readonly SupplierCapabilityRule[];
  /** Supporting evidence. At least `requiredAnyHits` of these have to hit. */
  requiredAny: readonly SupplierCapabilityRule[];
  requiredAnyHits: number;
  /** Evidence that the site is the wrong kind of business. */
  disqualifiers: readonly SupplierCapabilityRule[];
};

const RETAIL_DISQUALIFIERS: readonly SupplierCapabilityRule[] = [
  { label: "shopping cart", pattern: /\badd to (?:cart|basket)\b|\bshop now\b|\bmy cart\b|\bcheckout securely\b/i },
  { label: "consumer storefront", pattern: /\bfree shipping on (?:all )?orders\b|\b(?:sale|clearance) ends\b|\bcustomer reviews?\b\s*\(/i },
  { label: "directory listing", pattern: /\bsupplier directory\b|\bfind suppliers?\b|\bbusiness listings?\b|\brequest quotes? from multiple\b/i },
  { label: "job board", pattern: /\bjob (?:board|alerts?)\b|\bapply now for\b/i },
];

export const SUPPLIER_SOURCING_CATEGORIES: readonly SupplierSourcingCategory[] = [
  {
    key: "pcba",
    label: "Printed circuit board assembly",
    request: /\b(pcb|pcba|printed circuit|circuit board|board assembly|smt|electronics? (?:assembly|manufactur))/i,
    queries: [
      "printed circuit board assembly contract manufacturer request a quote",
      "turnkey PCBA assembly low volume prototype quote",
      "electronics manufacturing services SMT assembly company",
      "4 layer PCB fabrication and assembly quote",
      "PCB assembly house fine pitch QFN 0402 capability",
      "box build electronics contract manufacturer RFQ",
      "quick turn circuit board assembly service",
      "EMS provider SMT stencil pick and place capability",
    ],
    regions: [
      "United States",
      "California",
      "Texas",
      "Midwest United States",
      "Canada",
      "United Kingdom",
      "Germany",
      "Poland",
      "Mexico",
      "Taiwan",
    ],
    requiredAll: [
      {
        label: "circuit board work",
        pattern: /\b(pcb|pcba|printed circuit board|circuit board|electronics manufacturing services)\b/i,
      },
      {
        label: "assembly or fabrication capability",
        pattern: /\b(assembl(?:y|ies|ing)|smt|surface mount|through hole|fabricat(?:ion|e|ing)|turnkey|box build|contract manufactur)/i,
      },
    ],
    requiredAny: [
      { label: "quoting process", pattern: /\b(request a quote|rfq|get a quote|quote request|upload (?:your )?(?:gerber|files))\b/i },
      { label: "process detail", pattern: /\b(reflow|pick and place|stencil|solder paste|aoi|x-ray inspection|wave solder|selective solder)\b/i },
      { label: "capability detail", pattern: /\b(layer count|multilayer|impedance|bga|qfn|fine pitch|0402|0201|hasl|enig|solder mask)\b/i },
      { label: "quality system", pattern: /\b(iso ?9001|as9100|itar|ipc[- ]a[- ]610|ipc class 3|j-std-001)\b/i },
      { label: "production scale", pattern: /\b(prototype|low volume|high mix|production run|volume production)\b/i },
    ],
    requiredAnyHits: 2,
    disqualifiers: [
      ...RETAIL_DISQUALIFIERS,
      { label: "component reseller only", pattern: /\bauthorized distributor of (?:electronic )?components\b|\bbuy excess inventory\b/i },
      { label: "design services only", pattern: /\bwe do not (?:manufacture|assemble)\b/i },
    ],
  },
  {
    key: "molded-foam",
    label: "Molded polyurethane and viscoelastic foam",
    request: /\b(foam|viscoelastic|memory foam|polyurethane|pu foam|mold(?:ed|ing)? (?:foam|cushion)|cast(?:ing)? (?:foam|urethane))/i,
    queries: [
      "molded polyurethane foam manufacturer tooling in house",
      "poured in place foam molding manufacturer quote",
      "custom molded viscoelastic foam producer",
      "foam molding company aluminum molds cavities",
      "molded memory foam cushion manufacturer OEM",
      "cast urethane foam molder custom tooling",
      "molded foam contract manufacturer prototype tooling",
      "polyurethane foam pour molding production capability",
    ],
    regions: [
      "United States",
      "North Carolina",
      "California",
      "Midwest United States",
      "Canada",
      "United Kingdom",
      "Germany",
      "Poland",
      "Mexico",
      "Turkey",
    ],
    requiredAll: [
      { label: "foam material", pattern: /\bfoam\b|\bpolyurethane\b|\bviscoelastic\b|\burethane\b/i },
      {
        label: "molding or tooling capability",
        pattern: /\b(mold(?:ed|ing|s)?|mould(?:ed|ing|s)?|toolin(?:g)|cavit(?:y|ies)|poured in place|pour(?:ing|ed)? in place|cast(?:ing)? (?:in|into) (?:a )?mold)\b/i,
      },
    ],
    requiredAny: [
      { label: "molded foam language", pattern: /\bmolded (?:foam|polyurethane|urethane|cushion|part)/i },
      { label: "tooling ownership", pattern: /\b(in[- ]house tooling|tool (?:design|build|shop)|aluminum molds?|mold (?:design|making|build))\b/i },
      { label: "foam chemistry", pattern: /\b(polyol|isocyanate|two part|2k|density (?:of )?\d|ild|viscoelastic|memory foam|hr foam|integral skin)\b/i },
      { label: "quoting process", pattern: /\b(request a quote|rfq|get a quote|quote request|send (?:us )?your (?:drawing|cad|stl))\b/i },
      { label: "manufacturing identity", pattern: /\b(oem|contract manufactur|manufacturing (?:facility|plant)|production (?:line|capacity))\b/i },
    ],
    requiredAnyHits: 2,
    disqualifiers: [
      ...RETAIL_DISQUALIFIERS,
      { label: "mattress retailer", pattern: /\b(mattress (?:store|sale|in a box)|bed frames?|sleep trial|shop mattresses)\b/i },
      { label: "fabrication only", pattern: /\bwe (?:only )?(?:cut|fabricate) foam\b|\bfoam cut to size only\b|\bno molding\b/i },
    ],
  },
];

export function classifySupplierSourcingCategory(input: {
  material: string;
  specification?: string | null;
  notes?: string | null;
}): SupplierSourcingCategory | null {
  // The material carries the intent, so it decides first. Specification and
  // notes only break a tie when the material alone matches nothing.
  const material = input.material ?? "";
  const byMaterial = SUPPLIER_SOURCING_CATEGORIES.filter((category) => category.request.test(material));
  if (byMaterial.length === 1) return byMaterial[0]!;
  const haystack = [material, input.specification ?? "", input.notes ?? ""].join("\n");
  const candidates = (byMaterial.length ? byMaterial : SUPPLIER_SOURCING_CATEGORIES)
    .map((category) => {
      const matches = haystack.match(new RegExp(category.request.source, "gi"));
      return { category, hits: matches?.length ?? 0 };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0]!.hits === candidates[1]!.hits) return null;
  return candidates[0]!.category;
}

export function supplierSourcingQueries(category: SupplierSourcingCategory, cycle: number, count: number) {
  const queries: string[] = [];
  const start = Math.max(0, Math.trunc(cycle));
  for (let index = 0; queries.length < count && index < category.queries.length * category.regions.length; index += 1) {
    // Stride by how many phrases a round consumes, so later rounds reach the
    // rest of the curated phrases instead of repeating the first ones.
    const offset = start * count + index;
    const query = category.queries[offset % category.queries.length]!;
    const region = category.regions[Math.floor(offset / category.queries.length) % category.regions.length]!;
    const phrase = `${query} ${region}`;
    if (!queries.includes(phrase)) queries.push(phrase);
  }
  return queries;
}

export type SupplierSiteQualification =
  | { state: "QUALIFIED"; matched: string[] }
  | { state: "REJECTED"; reason: string };

const MIN_QUALIFYING_TEXT = 400;

export function qualifySupplierSite(
  category: SupplierSourcingCategory,
  site: { text: string; emails: readonly string[] },
): SupplierSiteQualification {
  const text = site.text ?? "";
  if (text.trim().length < MIN_QUALIFYING_TEXT) {
    return { state: "REJECTED", reason: "the public pages carried too little text to judge capability" };
  }
  if (!site.emails.length) {
    return { state: "REJECTED", reason: "no published business email address was found" };
  }
  const blocked = category.disqualifiers.find((rule) => rule.pattern.test(text));
  if (blocked) {
    return { state: "REJECTED", reason: `the site reads as ${blocked.label}` };
  }
  const missing = category.requiredAll.find((rule) => !rule.pattern.test(text));
  if (missing) {
    return { state: "REJECTED", reason: `no published evidence of ${missing.label}` };
  }
  const matched = category.requiredAny.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
  if (matched.length < category.requiredAnyHits) {
    return {
      state: "REJECTED",
      reason: `only ${matched.length} of ${category.requiredAnyHits} supporting capability signals were published`,
    };
  }
  return { state: "QUALIFIED", matched: [...category.requiredAll.map((rule) => rule.label), ...matched] };
}
