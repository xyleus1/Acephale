// Customer-specific demand profile that drives query generation and lead
// scoring. Profiles stay deterministic and reviewable so an operator can see
// exactly which keywords produced a target list.

import { normalizeTurkish } from "./extract";

export type LeadGenProfile = {
  slug: string;
  customerName: string;
  /** What the customer sells, in the buyer's language. */
  offering: string;
  /** Buyer segments the customer wants to reach. */
  segments: readonly LeadGenSegment[];
  /** Regions to sweep. Turkish provinces or country names. */
  regions: readonly string[];
  /** Directory-style seed pages that list many companies at once. */
  directorySeeds: readonly LeadGenDirectorySeed[];
  /** Terms that confirm a page belongs to a real steel-consuming buyer. */
  positiveSignals: readonly string[];
  /** Terms that mark a page as the wrong side of the trade or pure noise. */
  negativeSignals: readonly string[];
  /** Brand or company names that reject a lead outright when they appear in the company name or domain. */
  hardExclusions?: readonly string[];
  /** When false, the plan only emits region-scoped queries. */
  globalQueries?: boolean;
  queryLocales?: readonly import("./query-plan").QueryLocale[];
  sitePatterns?: readonly string[];
};

export type LeadGenSegment = {
  key: string;
  label: string;
  /** Native-language keywords used to build search queries. */
  keywords: readonly string[];
  /** Keywords per query locale, so a Spanish query is not built from Turkish terms. */
  keywordsByLocale?: Partial<Record<import("./query-plan").QueryLocale, readonly string[]>>;
  /** Relative value of the segment for prioritizing outreach. */
  weight: number;
};

export type LeadGenDirectorySeed = {
  label: string;
  url: string;
  kind: "member_list" | "cluster" | "registry" | "pdf";
};

export const GENERIC_STEEL_ORE_POSITIVE_SIGNALS = [
  "sanayi",
  "imalat",
  "uretim",
  "fabrika",
  "celik",
  "demir",
  "metal",
  "makine",
  "dokum",
  "profil",
  "sac",
  "konstruksiyon",
  "manufacturing",
  "steel",
  "fabrication",
] as const;

export const GENERIC_STEEL_ORE_NEGATIVE_SIGNALS = [
  "emlak",
  "gayrimenkul",
  "turizm",
  "otel",
  "restoran",
  "kuafor",
  "hukuk burosu",
  "eczane",
  "market",
  "kripto",
  "bahis",
] as const;

export const MULTILINGUAL_INDUSTRIAL_SIGNALS = [
  "steel", "iron", "metal", "mill", "foundry", "smelter", "billet", "slab", "bloom",
  "pig iron", "sponge iron", "hot rolled", "cold rolled", "wire rod", "rebar", "coil",
  "plate", "pipe", "casting", "forging", "fabrication", "manufacturing",
  "manufacturer", "industries", "industrial", "metallurg", "metallurgy", "metalurgia",
  "alloy", "ferro", "ferroalloy", "machinery", "smelting",
  "acero", "siderurg", "siderurgica", "fundicion", "fundicao", "laminado", "metalurg", "maquinaria",
  "celik", "demir", "sanayi", "imalat", "uretim", "fabrika", "dokum", "konstruksiyon",
  "metall", "chugun", "prokat", "zavod",
  "acciaio", "stahl", "stahlwerk", "walzwerk", "giesserei", "acier", "fonderie", "turnatorie",
] as const;

export const GENERIC_NON_INDUSTRIAL_SIGNALS = [
  "real estate", "hotel", "tourism", "restaurant", "casino", "insurance",
  "recruitment", "travel agency", "law firm", "pharmacy",
] as const;

export const GENERIC_INDUSTRIAL_SIGNALS = [
  "manufactur", "factory", "industrial", "industries", "supplier",
  "fabrica", "fabrika", "sanayi", "imalat", "uretim", "usine", "werk",
  "zavod", "planta",
] as const;

const METAL_EXACT_MARKERS = [
  "steel", "iron", "ore", "metal", "metals", "celik", "demir", "cevher",
  "acero", "aco", "billet", "slab", "scrap", "ferro", "ferrous", "ferroalloy",
  "alloy",
] as const;

const METAL_STEM_MARKERS = [
  "siderurg", "metalurg", "metall",
  "ferroman", "ferrochrom", "ferrosilic", "ferronickel", "ferrovanad",
  "steelmak", "steelwork", "ironwork", "ironmak",
] as const;

function containsTokenMarker(
  text: string,
  exactMarkers: readonly string[],
  stemMarkers: readonly string[],
) {
  const tokens = normalizeTurkish(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const hasExactMarker = exactMarkers.some((marker) => {
    const normalizedMarker = normalizeTurkish(marker);
    return tokens.some((token) =>
      token === normalizedMarker
      || (token.endsWith("s") && token.slice(0, -1) === normalizedMarker),
    );
  });
  if (hasExactMarker) return true;
  return stemMarkers.some((marker) => {
    const normalizedMarker = normalizeTurkish(marker);
    return tokens.some((token) => token.startsWith(normalizedMarker));
  });
}

const PRODUCT_FOCUS_STOPWORDS = new Set([
  "and",
  "the",
  "with",
  "from",
  "that",
  "only",
  "such",
  "other",
  "focused",
  "companies",
  "company",
  "exclude",
  "including",
  "relevant",
  "products",
  "product",
  "basic",
  "semi",
  "finished",
  "small",
  "large",
  "supplied",
  "capability",
  "meaningful",
  "export",
  "sector",
  "iron",
  "steel",
  "manufacturer",
  "manufacturing",
  "exporter",
  "importer",
  "supplier",
  "buyer",
  "producer",
  "distributor",
  "trader",
  "trading",
  "wholesale",
  "factory",
  "industry",
  "industrial",
  "business",
  "market",
  "corridor",
  "country",
  "region",
  "global",
  "worldwide",
]);

export function signalsFromProductFocus(input: {
  productFocus: string;
  segments: readonly string[];
}): { positive: readonly string[]; negative: readonly string[] } {
  const focusText = [input.productFocus, ...input.segments].join(" ");
  const hasMetalFocus = containsTokenMarker(
    focusText,
    METAL_EXACT_MARKERS,
    METAL_STEM_MARKERS,
  );
  const derived = [input.productFocus, ...input.segments]
    .flatMap((value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/))
    .filter((token) => {
      const singular = token.endsWith("s") ? token.slice(0, -1) : token;
      return token.length >= 4
        && !PRODUCT_FOCUS_STOPWORDS.has(token)
        && !PRODUCT_FOCUS_STOPWORDS.has(singular);
    })
    .filter((token, index, tokens) => tokens.indexOf(token) === index)
    .slice(0, 40);
  const baseSignals = hasMetalFocus
    ? MULTILINGUAL_INDUSTRIAL_SIGNALS
    : derived.length ? derived : GENERIC_INDUSTRIAL_SIGNALS;
  const positive = [...new Set([...baseSignals, ...derived])];
  const positiveSet = new Set(positive);
  const negative = [...new Set([
    ...GENERIC_STEEL_ORE_NEGATIVE_SIGNALS,
    ...GENERIC_NON_INDUSTRIAL_SIGNALS,
  ])].filter((signal) => !positiveSet.has(signal));
  return { positive, negative };
}

export const MANEKS_PROFILE: LeadGenProfile = {
  slug: "maneks",
  customerName: "Maneks Dis Ticaret",
  offering:
    "Iron and steel supply in smaller, non-bulk lots: long products, flat products, pipe and profile, plus Fe, Cr and Mn ores.",
  segments: [
    {
      key: "steel_service_center",
      label: "Steel service centers and stockholders",
      keywords: [
        "celik servis merkezi",
        "demir celik toptan",
        "sac dilme merkezi",
        "celik stokcu",
        "demir celik ticaret",
      ],
      weight: 1,
    },
    {
      key: "fabricator",
      label: "Steel fabricators and machine shops",
      keywords: [
        "celik konstruksiyon imalat",
        "metal islesme sanayi",
        "talasli imalat",
        "kaynakli imalat",
        "sac metal imalat",
      ],
      weight: 0.95,
    },
    {
      key: "pipe_profile",
      label: "Pipe and profile producers",
      keywords: [
        "boru profil uretimi",
        "celik boru imalat",
        "kutu profil uretici",
      ],
      weight: 0.9,
    },
    {
      key: "machinery",
      label: "Machinery and equipment manufacturers",
      keywords: [
        "makine imalat sanayi",
        "tarim makineleri uretici",
        "is makinesi imalat",
        "vinc imalat",
      ],
      weight: 0.85,
    },
    {
      key: "construction",
      label: "Construction and infrastructure contractors",
      keywords: [
        "insaat taahhut celik",
        "prefabrik celik yapi",
        "insaat demiri kullanan",
      ],
      weight: 0.7,
    },
    {
      key: "foundry",
      label: "Foundries and smelters buying ore and scrap",
      keywords: [
        "dokumhane",
        "demir dokum sanayi",
        "ferroalyaj uretici",
      ],
      weight: 0.8,
    },
  ],
  regions: [
    "Istanbul",
    "Kocaeli",
    "Bursa",
    "Ankara",
    "Izmir",
    "Konya",
    "Gaziantep",
    "Kayseri",
    "Adana",
    "Manisa",
    "Denizli",
    "Sakarya",
    "Eskisehir",
    "Tekirdag",
    "Hatay",
    "Samsun",
    "Trabzon",
    "Mersin",
    "Balikesir",
    "Corum",
  ],
  directorySeeds: [
    { label: "OSBUK organized industrial zone directory", url: "https://www.osbuk.org/osbler/", kind: "cluster" },
    { label: "Istanbul Chamber of Industry member services", url: "https://www.iso.org.tr/", kind: "member_list" },
    { label: "Ankara Chamber of Industry", url: "https://www.aso.org.tr/", kind: "member_list" },
    { label: "Bursa Chamber of Commerce and Industry", url: "https://www.btso.org.tr/", kind: "member_list" },
    { label: "Aegean Region Chamber of Industry", url: "https://www.ebso.org.tr/", kind: "member_list" },
    { label: "Kayseri Chamber of Industry", url: "https://www.kayserioSB.org.tr/", kind: "member_list" },
  ],
  positiveSignals: GENERIC_STEEL_ORE_POSITIVE_SIGNALS,
  negativeSignals: GENERIC_STEEL_ORE_NEGATIVE_SIGNALS,
};

// Same demand profile as MANEKS_PROFILE, swept along the Venezuela to Russia
// trade corridor instead of Turkish provinces. Regions are countries, so
// queries are generated in each country's own language.
export const MANEKS_CORRIDOR_REGIONS = [
  "Venezuela",
  "Colombia",
  "Panama",
  "Peru",
  "Chile",
  "Brazil",
  "Mexico",
  "Dominican Republic",
  "Morocco",
  "Portugal",
  "Spain",
  "Italy",
  "Greece",
  "Egypt",
  "Turkey",
  "Bulgaria",
  "Romania",
  "Poland",
  "Germany",
  "Ukraine",
  "Georgia",
  "Azerbaijan",
  "Armenia",
  "Kazakhstan",
  "Uzbekistan",
  "Iran",
  "Iraq",
  "Jordan",
  "United Arab Emirates",
  "Saudi Arabia",
  "Russia",
] as const;

export const MANEKS_CORRIDOR_SEGMENTS: readonly LeadGenSegment[] = [
  {
    key: "steel_service_center",
    label: "Steel service centers and stockholders",
    weight: 1,
    keywords: ["steel service center", "steel stockholder"],
    keywordsByLocale: {
      en: ["steel service center", "steel stockholder"],
      es: ["centro de servicio de acero", "distribuidor de acero"],
      pt: ["centro de servico de aco", "distribuidora de aco"],
      ru: ["металлосервисный центр", "металлотрейдер"],
      tr: ["celik servis merkezi", "demir celik toptan"],
      ar: ["مركز خدمات الصلب", "موزع الحديد والصلب"],
      it: ["centro servizi acciaio", "commercio acciaio"],
      de: ["Stahl Service Center", "Stahlhandel"],
      pl: ["centrum serwisowe stali", "hurtownia stali"],
      ro: ["centru de servicii oteluri", "depozit de oteluri"],
    },
  },
  {
    key: "fabricator",
    label: "Steel fabricators and machine shops",
    weight: 0.95,
    keywords: ["steel fabrication", "sheet metal fabrication"],
    keywordsByLocale: {
      en: ["steel fabrication", "sheet metal fabrication"],
      es: ["fabricacion metalica", "estructuras metalicas"],
      pt: ["estruturas metalicas", "fabricacao de metal"],
      ru: ["металлообработка", "металлоконструкции"],
      tr: ["celik konstruksiyon imalat", "sac metal imalat"],
      ar: ["تصنيع المعادن", "الهياكل المعدنية"],
      it: ["carpenteria metallica", "lavorazione lamiera"],
      de: ["Stahlbau", "Blechbearbeitung"],
      pl: ["konstrukcje stalowe", "obrobka blachy"],
      ro: ["confectii metalice", "structuri metalice"],
    },
  },
  {
    key: "pipe_profile",
    label: "Pipe and profile producers",
    weight: 0.9,
    keywords: ["steel pipe manufacturer", "steel profile producer"],
    keywordsByLocale: {
      en: ["steel pipe manufacturer", "steel profile producer"],
      es: ["fabricante de tuberia de acero", "fabricante de perfiles de acero"],
      pt: ["fabricante de tubos de aco", "fabricante de perfis de aco"],
      ru: ["производитель стальных труб", "производитель профилей"],
      tr: ["celik boru imalat", "kutu profil uretici"],
      ar: ["مصنع انابيب الصلب", "مصنع مقاطع الصلب"],
      it: ["produttore tubi acciaio", "produttore profilati"],
      de: ["Stahlrohr Hersteller", "Profilhersteller"],
      pl: ["producent rur stalowych", "producent profili stalowych"],
      ro: ["producator tevi oteluri", "producator profile metalice"],
    },
  },
  {
    key: "machinery",
    label: "Machinery and equipment manufacturers",
    weight: 0.85,
    keywords: ["machinery manufacturer", "agricultural machinery manufacturer"],
    keywordsByLocale: {
      en: ["machinery manufacturer", "agricultural machinery manufacturer"],
      es: ["fabricante de maquinaria", "fabricante de maquinaria agricola"],
      pt: ["fabricante de maquinas", "fabricante de maquinas agricolas"],
      ru: ["производитель машин", "производитель сельхозтехники"],
      tr: ["makine imalat sanayi", "tarim makineleri uretici"],
      ar: ["مصنع الالات", "مصنع الالات الزراعية"],
      it: ["costruttore di macchinari", "produttore macchine agricole"],
      de: ["Maschinenbau Hersteller", "Landmaschinen Hersteller"],
      pl: ["producent maszyn", "producent maszyn rolniczych"],
      ro: ["producator de masini", "producator de utilaje agricole"],
    },
  },
  {
    key: "foundry",
    label: "Foundries and smelters buying ore and scrap",
    weight: 0.8,
    keywords: ["foundry", "ferroalloy producer"],
    keywordsByLocale: {
      en: ["foundry", "ferroalloy producer"],
      es: ["fundicion de hierro", "productor de ferroaleaciones"],
      pt: ["fundicao de ferro", "produtor de ferroligas"],
      ru: ["литейный завод", "производитель ферросплавов"],
      tr: ["dokumhane", "ferroalyaj uretici"],
      ar: ["مسبك حديد", "منتج الحديد السبائكي"],
      it: ["fonderia di ghisa", "produttore ferroleghe"],
      de: ["Eisengiesserei", "Ferrolegierungen Hersteller"],
      pl: ["odlewnia zeliwa", "producent zelazostopow"],
      ro: ["turnatorie de fonta", "producator feroaliaje"],
    },
  },
];

export const MANEKS_CORRIDOR_PROFILE: LeadGenProfile = {
  ...MANEKS_PROFILE,
  slug: "maneks-corridor",
  segments: MANEKS_CORRIDOR_SEGMENTS,
  regions: MANEKS_CORRIDOR_REGIONS,
  directorySeeds: [],
  queryLocales: ["en"],
};
