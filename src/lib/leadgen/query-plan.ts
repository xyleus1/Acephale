// Deterministic query generation. The pipeline never asks a model what to
// search for: queries are the cross product of profile segments, regions,
// locales, and source-shape modifiers.

import { createHash } from "node:crypto";
import type { LeadGenProfile } from "./profile";

export type QueryLocale = "tr" | "es" | "ru" | "en" | "de" | "it" | "pl" | "ro" | "ar" | "fa" | "zh" | "pt";

export type LeadGenQuery = {
  id: string;
  query: string;
  segmentKey: string;
  region: string | null;
  locale: QueryLocale;
  shape: LeadGenQueryShape;
};

export type LeadGenQueryShape =
  | "company_site"
  | "member_list"
  | "pdf_directory"
  | "contact_page"
  | "cluster"
  | "doc_pdf_directory"
  | "doc_spreadsheet_directory"
  | "doc_office_directory"
  | "exhibitor_list"
  | "association_members";

type PhraseConcept =
  | "memberList"
  | "companyDirectory"
  | "industrialZone"
  | "chamberIndustry"
  | "chamberCommerce"
  | "exhibitorList"
  | "supplierList"
  | "associationMembers"
  | "contactEmail";

export const LOCALIZED_PHRASES: Readonly<Record<QueryLocale, Readonly<Record<PhraseConcept, string>>>> = {
  tr: { memberList: "uye listesi", companyDirectory: "firma rehberi", industrialZone: "organize sanayi bolgesi", chamberIndustry: "sanayi odasi", chamberCommerce: "ticaret odasi", exhibitorList: "katilimci listesi", supplierList: "tedarikci listesi", associationMembers: "dernek uyeleri", contactEmail: "firma iletisim eposta" },
  es: { memberList: "lista de miembros", companyDirectory: "directorio de empresas", industrialZone: "parque industrial", chamberIndustry: "camara de industria", chamberCommerce: "camara de comercio", exhibitorList: "lista de expositores", supplierList: "lista de proveedores", associationMembers: "miembros de la asociacion", contactEmail: "contacto correo electronico" },
  ru: { memberList: "список участников", companyDirectory: "каталог компаний", industrialZone: "промышленная зона", chamberIndustry: "промышленная палата", chamberCommerce: "торговая палата", exhibitorList: "список участников выставки", supplierList: "список поставщиков", associationMembers: "члены ассоциации", contactEmail: "контакты электронная почта" },
  en: { memberList: "member list", companyDirectory: "company directory", industrialZone: "industrial park company directory", chamberIndustry: "chamber of industry", chamberCommerce: "chamber of commerce", exhibitorList: "exhibitor list", supplierList: "supplier list", associationMembers: "association members", contactEmail: "company contact email" },
  de: { memberList: "Mitgliederliste", companyDirectory: "Unternehmensverzeichnis", industrialZone: "Industriepark Firmenverzeichnis", chamberIndustry: "Industrie- und Handelskammer", chamberCommerce: "Handelskammer", exhibitorList: "Ausstellerliste", supplierList: "Lieferantenliste", associationMembers: "Verbandsmitglieder", contactEmail: "Unternehmenskontakt E-Mail" },
  it: { memberList: "elenco dei membri", companyDirectory: "elenco aziende", industrialZone: "elenco aziende zona industriale", chamberIndustry: "camera dell'industria", chamberCommerce: "camera di commercio", exhibitorList: "elenco espositori", supplierList: "elenco fornitori", associationMembers: "membri dell'associazione", contactEmail: "contatto email aziendale" },
  pl: { memberList: "lista członków", companyDirectory: "katalog firm", industrialZone: "katalog firm parku przemysłowego", chamberIndustry: "izba przemysłowa", chamberCommerce: "izba handlowa", exhibitorList: "lista wystawców", supplierList: "lista dostawców", associationMembers: "członkowie stowarzyszenia", contactEmail: "kontakt email firmy" },
  ro: { memberList: "lista membrilor", companyDirectory: "director companii", industrialZone: "director companii parc industrial", chamberIndustry: "camera de industrie", chamberCommerce: "camera de comert", exhibitorList: "lista expozantilor", supplierList: "lista furnizorilor", associationMembers: "membrii asociatiei", contactEmail: "contact email companie" },
  ar: { memberList: "قائمة الأعضاء", companyDirectory: "دليل الشركات", industrialZone: "دليل شركات المنطقة الصناعية", chamberIndustry: "غرفة الصناعة", chamberCommerce: "غرفة التجارة", exhibitorList: "قائمة العارضين", supplierList: "قائمة الموردين", associationMembers: "أعضاء الجمعية", contactEmail: "تواصل بريد إلكتروني للشركة" },
  fa: { memberList: "فهرست اعضا", companyDirectory: "فهرست شرکت ها", industrialZone: "فهرست شرکت های شهرک صنعتی", chamberIndustry: "اتاق صنایع", chamberCommerce: "اتاق بازرگانی", exhibitorList: "فهرست غرفه داران", supplierList: "فهرست تامین کنندگان", associationMembers: "اعضای انجمن", contactEmail: "تماس ایمیل شرکت" },
  zh: { memberList: "会员名单", companyDirectory: "公司目录", industrialZone: "工业园区公司目录", chamberIndustry: "工业商会", chamberCommerce: "商会会员", exhibitorList: "展商名单", supplierList: "供应商名单", associationMembers: "协会会员", contactEmail: "公司联系方式 电子邮件" },
  pt: { memberList: "lista de membros", companyDirectory: "diretório de empresas", industrialZone: "diretório de empresas do parque industrial", chamberIndustry: "câmara da indústria", chamberCommerce: "câmara de comércio", exhibitorList: "lista de expositores", supplierList: "lista de fornecedores", associationMembers: "membros da associação", contactEmail: "contato e-mail da empresa" },
};

const COUNTRY_LOCALES: Readonly<Record<string, readonly QueryLocale[]>> = {
  turkey: ["tr", "en"], turkiye: ["tr", "en"], spain: ["es", "en"], venezuela: ["es", "en"],
  colombia: ["es", "en"], brazil: ["pt", "en"], russia: ["ru", "en"], ukraine: ["ru", "en"],
  germany: ["de", "en"], austria: ["de", "en"], italy: ["it", "en"], poland: ["pl", "en"],
  romania: ["ro", "en"], bulgaria: ["ru", "en"], georgia: ["ru", "en"], egypt: ["ar", "en"],
  "saudi arabia": ["ar", "en"], iran: ["fa", "en"], china: ["zh", "en"],
};

const TURKISH_REGIONS = new Set([
  "adana", "ankara", "balikesir", "bursa", "corum", "denizli", "eskisehir", "gaziantep",
  "hatay", "istanbul", "izmir", "kayseri", "kocaeli", "konya", "manisa", "mersin",
  "sakarya", "samsun", "tekirdag", "trabzon",
]);

function normalizeRegion(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function queryLocalesForRegion(region: string | null, profileLocales: readonly QueryLocale[] = []): QueryLocale[] {
  if (!region?.trim()) return profileLocales.length ? [...profileLocales] : ["tr", "en"];
  const normalized = normalizeRegion(region);
  if (TURKISH_REGIONS.has(normalized)) return ["tr"] as QueryLocale[];
  return [...(COUNTRY_LOCALES[normalized] ?? (profileLocales.length ? profileLocales : ["en"]))];
}

export function regionLocale(region: string | null): "tr" | "international" | "unknown" {
  if (!region?.trim()) return "unknown";
  return queryLocalesForRegion(region)[0] === "tr" ? "tr" : "international";
}

export type BuildQueryPlanOptions = {
  shapes?: readonly LeadGenQueryShape[];
  segmentKeys?: readonly string[];
  maxRegionsPerSegment?: number;
  limit?: number;
};

type PhraseConceptName = keyof typeof LOCALIZED_PHRASES.en;

function phrase(locale: QueryLocale, concept: PhraseConceptName) {
  return LOCALIZED_PHRASES[locale][concept];
}

function addSitePatterns(parts: string[], profile: LeadGenProfile) {
  return profile.sitePatterns?.length ? [...parts, ...profile.sitePatterns.map((pattern) => `site:${pattern}`)] : parts;
}

function buildShape(shape: LeadGenQueryShape, keyword: string, region: string | null, locale: QueryLocale, profile: LeadGenProfile) {
  const base = [keyword, region].filter(Boolean) as string[];
  switch (shape) {
    case "company_site": return [...base, phrase(locale, "contactEmail")].join(" ");
    case "member_list": return [...base, phrase(locale, "chamberIndustry"), phrase(locale, "memberList")].join(" ");
    case "cluster": return [region, phrase(locale, "industrialZone"), keyword].filter(Boolean).join(" ");
    case "pdf_directory":
      return locale === "tr"
        ? [...base, "uye firma rehberi", "filetype:pdf"].join(" ")
        : [...base, phrase(locale, "companyDirectory"), phrase(locale, "associationMembers"), "filetype:pdf"].join(" ");
    case "contact_page":
      return locale === "tr"
        ? [...base, phrase(locale, "contactEmail"), "contact page"].join(" ")
        : [...base, "buyers distributors"].join(" ");
    case "doc_pdf_directory": return addSitePatterns([...base, phrase(locale, "companyDirectory"), phrase(locale, "memberList"), "filetype:pdf", "inurl:directory", "inurl:rehber"], profile).join(" ");
    case "doc_spreadsheet_directory": return addSitePatterns([...base, phrase(locale, "companyDirectory"), phrase(locale, "supplierList"), "(filetype:xls OR filetype:xlsx)", "inurl:uyeler"], profile).join(" ");
    case "doc_office_directory": return addSitePatterns([...base, phrase(locale, "companyDirectory"), phrase(locale, "memberList"), "(filetype:doc OR filetype:docx)", "inurl:members"], profile).join(" ");
    case "exhibitor_list": return addSitePatterns([...base, phrase(locale, "exhibitorList"), "filetype:pdf", "inurl:catalog"], profile).join(" ");
    case "association_members": return addSitePatterns([...base, phrase(locale, "associationMembers"), "filetype:pdf", "inurl:members"], profile).join(" ");
  }
}

const ALL_SHAPES: readonly LeadGenQueryShape[] = [
  "company_site", "member_list", "cluster", "pdf_directory", "contact_page",
  "doc_pdf_directory", "doc_spreadsheet_directory", "doc_office_directory",
  "exhibitor_list", "association_members",
];

export function buildQueryPlan(profile: LeadGenProfile, options: BuildQueryPlanOptions = {}): LeadGenQuery[] {
  const requestedShapes = options.shapes?.length ? new Set(options.shapes) : null;
  const segments = options.segmentKeys?.length ? profile.segments.filter((segment) => options.segmentKeys?.includes(segment.key)) : profile.segments;
  const regionCap = options.maxRegionsPerSegment ?? profile.regions.length;
  const seen = new Set<string>();
  const plan: LeadGenQuery[] = [];

  for (const segment of segments) {
    for (const region of [null, ...profile.regions.slice(0, regionCap)] as (string | null)[]) {
      for (const locale of queryLocalesForRegion(region, profile.queryLocales)) {
        const shapes = ALL_SHAPES.filter((shape) => !requestedShapes || requestedShapes.has(shape));
        for (const keyword of segment.keywords) {
          for (const shape of shapes) {
            const query = buildShape(shape, keyword, region, locale, profile).replace(/\s+/g, " ").trim();
            const key = `${shape}:${locale}:${query.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const input = [profile.slug, segment.key, region ?? "all", locale, keyword, shape, query].join("|");
            const id = `${profile.slug}-${createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
            plan.push({ id, query, segmentKey: segment.key, region, locale, shape });
            if (options.limit && plan.length >= options.limit) return plan;
          }
        }
      }
    }
  }
  return plan;
}
