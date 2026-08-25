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
  locale: "tr" | "international";
  build: (keyword: string, region: string | null) => string;
};

const SHAPE_TEMPLATES: readonly ShapeTemplate[] = [
  {
    shape: "company_site",
    locale: "tr",
    build: (keyword, region) => [keyword, region, "firma iletisim"].filter(Boolean).join(" "),
  },
  {
    shape: "member_list",
    locale: "tr",
    build: (keyword, region) => [keyword, region, "sanayi odasi uye listesi"].filter(Boolean).join(" "),
  },
  {
    shape: "cluster",
    locale: "tr",
    build: (keyword, region) => [region, "organize sanayi bolgesi", keyword, "firmalar"].filter(Boolean).join(" "),
  },
  {
    shape: "pdf_directory",
    locale: "tr",
    build: (keyword, region) => [keyword, region, "uye firma rehberi filetype:pdf"].filter(Boolean).join(" "),
  },
  {
    shape: "contact_page",
    locale: "tr",
    build: (keyword, region) => [keyword, region, "\"@\" eposta iletisim"].filter(Boolean).join(" "),
  },
  {
    shape: "company_site",
    locale: "international",
    build: (keyword, region) => [keyword, region, "company contact email"].filter(Boolean).join(" "),
  },
  {
    shape: "member_list",
    locale: "international",
    build: (keyword, region) => [keyword, region, "chamber of commerce member list"].filter(Boolean).join(" "),
  },
  {
    shape: "cluster",
    locale: "international",
    build: (keyword, region) => [region, "industrial zone company directory", keyword].filter(Boolean).join(" "),
  },
  {
    shape: "pdf_directory",
    locale: "international",
    build: (keyword, region) => [keyword, region, "association member directory filetype:pdf"].filter(Boolean).join(" "),
  },
  {
    shape: "contact_page",
    locale: "international",
    build: (keyword, region) => [keyword, region, "buyers distributors"].filter(Boolean).join(" "),
  },
];

const REGION_LOCALES: Readonly<Record<string, "tr">> = {
  adana: "tr",
  ankara: "tr",
  balikesir: "tr",
  bursa: "tr",
  corum: "tr",
  denizli: "tr",
  eskisehir: "tr",
  gaziantep: "tr",
  hatay: "tr",
  istanbul: "tr",
  izmir: "tr",
  kayseri: "tr",
  kocaeli: "tr",
  konya: "tr",
  manisa: "tr",
  mersin: "tr",
  sakarya: "tr",
  samsun: "tr",
  tekirdag: "tr",
  trabzon: "tr",
  turkey: "tr",
  turkiye: "tr",
};

function normalizeRegion(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function regionLocale(region: string | null): "tr" | "international" | "unknown" {
  if (!region?.trim()) return "unknown";
  return REGION_LOCALES[normalizeRegion(region)] ?? "international";
}

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
  const requestedShapes = options.shapes?.length ? new Set(options.shapes) : null;
  const segments = options.segmentKeys?.length
    ? profile.segments.filter((segment) => options.segmentKeys?.includes(segment.key))
    : profile.segments;
  const regionCap = options.maxRegionsPerSegment ?? profile.regions.length;

  const seen = new Set<string>();
  const plan: LeadGenQuery[] = [];

  for (const segment of segments) {
    const regions: (string | null)[] = [null, ...profile.regions.slice(0, regionCap)];
    for (const region of regions) {
      const locale = regionLocale(region);
      const shapes = SHAPE_TEMPLATES.filter((template) =>
        (!requestedShapes || requestedShapes.has(template.shape))
          && (locale === "unknown" || template.locale === locale),
      );
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
