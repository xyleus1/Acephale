// Customer-specific demand profile that drives query generation and lead
// scoring. Profiles stay deterministic and reviewable so an operator can see
// exactly which keywords produced a target list.

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
};

export type LeadGenSegment = {
  key: string;
  label: string;
  /** Native-language keywords used to build search queries. */
  keywords: readonly string[];
  /** Relative value of the segment for prioritizing outreach. */
  weight: number;
};

export type LeadGenDirectorySeed = {
  label: string;
  url: string;
  kind: "member_list" | "cluster" | "registry" | "pdf";
};

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
  positiveSignals: [
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
  ],
  negativeSignals: [
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
  ],
};
