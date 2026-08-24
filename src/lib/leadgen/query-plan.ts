// Deterministic query generation. The pipeline never asks a model what to
// search for: queries are the cross product of profile segments, regions, and
// source-shape modifiers, so a run is reproducible and auditable.

import type { LeadGenProfile } from "./profile";

export type LeadGenQuery = {
  id: string;
  query: string;
  segmentKey: string;
  region: string | null;
  shape: LeadGenQueryShape;
};

export type LeadGenQueryShape =
  | "company_site"
  | "member_list"
  | "pdf_directory"
  | "contact_page"
  | "cluster";

type ShapeTemplate = {
  shape: LeadGenQueryShape;
  build: (keyword: string, region: string | null) => string;
};

const SHAPE_TEMPLATES: readonly ShapeTemplate[] = [
  {
    shape: "company_site",
    build: (keyword, region) => [keyword, region, "firma iletisim"].filter(Boolean).join(" "),
  },
  {
    shape: "member_list",
    build: (keyword, region) => [keyword, region, "sanayi odasi uye listesi"].filter(Boolean).join(" "),
  },
  {
    shape: "cluster",
    build: (keyword, region) => [region, "organize sanayi bolgesi", keyword, "firmalar"].filter(Boolean).join(" "),
  },
  {
    shape: "pdf_directory",
    build: (keyword, region) => [keyword, region, "uye firma rehberi filetype:pdf"].filter(Boolean).join(" "),
  },
  {
    shape: "contact_page",
    build: (keyword, region) => [keyword, region, "\"@\" eposta iletisim"].filter(Boolean).join(" "),
  },
];

export type BuildQueryPlanOptions = {
  /** Restrict to these shapes. Defaults to every shape. */
  shapes?: readonly LeadGenQueryShape[];
  /** Restrict to these segment keys. Defaults to every segment. */
  segmentKeys?: readonly string[];
  /** Cap regions per segment so a smoke run stays small. */
  maxRegionsPerSegment?: number;
  /** Hard cap on the produced plan. */
  limit?: number;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildQueryPlan(profile: LeadGenProfile, options: BuildQueryPlanOptions = {}): LeadGenQuery[] {
  const shapes = options.shapes?.length
    ? SHAPE_TEMPLATES.filter((template) => options.shapes?.includes(template.shape))
    : SHAPE_TEMPLATES;
  const segments = options.segmentKeys?.length
    ? profile.segments.filter((segment) => options.segmentKeys?.includes(segment.key))
    : profile.segments;
  const regionCap = options.maxRegionsPerSegment ?? profile.regions.length;

  const seen = new Set<string>();
  const plan: LeadGenQuery[] = [];

  for (const segment of segments) {
    const regions: (string | null)[] = [null, ...profile.regions.slice(0, regionCap)];
    for (const region of regions) {
      for (const keyword of segment.keywords) {
        for (const template of shapes) {
          const query = template.build(keyword, region).replace(/\s+/g, " ").trim();
          const key = `${template.shape}:${query.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          plan.push({
            id: `${profile.slug}-${slugify(segment.key)}-${slugify(region ?? "all")}-${slugify(keyword)}-${template.shape}`,
            query,
            segmentKey: segment.key,
            region,
            shape: template.shape,
          });
          if (options.limit && plan.length >= options.limit) return plan;
        }
      }
    }
  }

  return plan;
}
