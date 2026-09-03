// Deterministic query generation. The pipeline never asks a model what to
// search for: queries are the cross product of profile segments, regions,
// locales, and source-shape modifiers.

import { createHash } from "node:crypto";
import type { LeadGenProfile } from "./profile";

// Bump when buildQueryPlan ordering changes so persisted offsets are not reused.
export const QUERY_PLAN_VERSION = 2;

export type QueryLocale =
  | "tr"
  | "es"
  | "ru"
  | "en"
  | "de"
  | "it"
  | "pl"
  | "ro"
  | "ar"
  | "fa"
  | "zh"
  | "pt"
  | "el"
  | "fr"
  | "nl"
  | "sv"
  | "da"
  | "no"
  | "fi"
  | "cs"
  | "sk"
  | "hu"
  | "bg"
  | "hr"
  | "lt"
  | "et"
  | "lv";

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
  el: { memberList: "κατάλογος μελών", companyDirectory: "κατάλογος εταιρειών", industrialZone: "κατάλογος εταιρειών βιομηχανικής περιοχής", chamberIndustry: "βιομηχανικό επιμελητήριο", chamberCommerce: "εμπορικό επιμελητήριο", exhibitorList: "κατάλογος εκθετών", supplierList: "κατάλογος προμηθευτών", associationMembers: "μέλη ένωσης", contactEmail: "εταιρικό email επικοινωνίας" },
  fr: { memberList: "liste des membres", companyDirectory: "annuaire des entreprises", industrialZone: "annuaire des entreprises zone industrielle", chamberIndustry: "chambre de l'industrie", chamberCommerce: "chambre de commerce", exhibitorList: "liste des exposants", supplierList: "liste des fournisseurs", associationMembers: "membres de l'association", contactEmail: "email de contact de l'entreprise" },
  nl: { memberList: "ledenlijst", companyDirectory: "bedrijvengids", industrialZone: "bedrijvengids industrieterrein", chamberIndustry: "kamer van industrie", chamberCommerce: "kamer van koophandel", exhibitorList: "exposantenlijst", supplierList: "leverancierslijst", associationMembers: "leden van de vereniging", contactEmail: "contact e-mail bedrijf" },
  sv: { memberList: "medlemslista", companyDirectory: "företagsregister", industrialZone: "företagsregister industriområde", chamberIndustry: "industrikammare", chamberCommerce: "handelskammare", exhibitorList: "utställarlista", supplierList: "leverantörslista", associationMembers: "föreningsmedlemmar", contactEmail: "företag kontakt e-post" },
  da: { memberList: "medlemsliste", companyDirectory: "virksomhedsregister", industrialZone: "virksomhedsregister industrikvarter", chamberIndustry: "industrikammer", chamberCommerce: "handelskammer", exhibitorList: "udstillerliste", supplierList: "leverandørliste", associationMembers: "foreningsmedlemmer", contactEmail: "virksomhed kontakt e-mail" },
  no: { memberList: "medlemsliste", companyDirectory: "bedriftsregister", industrialZone: "bedriftsregister industriområde", chamberIndustry: "industrikammer", chamberCommerce: "handelskammer", exhibitorList: "utstillerliste", supplierList: "leverandørliste", associationMembers: "foreningsmedlemmer", contactEmail: "bedrift kontakt e-post" },
  fi: { memberList: "jäsenluettelo", companyDirectory: "yrityshakemisto", industrialZone: "yrityshakemisto teollisuusalue", chamberIndustry: "teollisuuskamari", chamberCommerce: "kauppakamari", exhibitorList: "näytteilleasettajien luettelo", supplierList: "toimittajaluettelo", associationMembers: "yhdistyksen jäsenet", contactEmail: "yrityksen yhteyssähköposti" },
  cs: { memberList: "seznam členů", companyDirectory: "firemní katalog", industrialZone: "katalog firem průmyslové zóny", chamberIndustry: "průmyslová komora", chamberCommerce: "obchodní komora", exhibitorList: "seznam vystavovatelů", supplierList: "seznam dodavatelů", associationMembers: "členové sdružení", contactEmail: "kontaktní e-mail firmy" },
  sk: { memberList: "zoznam členov", companyDirectory: "firemný katalóg", industrialZone: "katalóg firiem priemyselnej zóny", chamberIndustry: "priemyselná komora", chamberCommerce: "obchodná komora", exhibitorList: "zoznam vystavovateľov", supplierList: "zoznam dodávateľov", associationMembers: "členovia združenia", contactEmail: "kontaktný e-mail firmy" },
  hu: { memberList: "taglista", companyDirectory: "cégjegyzék", industrialZone: "ipari park cégjegyzéke", chamberIndustry: "iparkamara", chamberCommerce: "kereskedelmi kamara", exhibitorList: "kiállítói lista", supplierList: "beszállítói lista", associationMembers: "egyesületi tagok", contactEmail: "cég kapcsolattartó e-mail" },
  bg: { memberList: "списък на членовете", companyDirectory: "фирмен каталог", industrialZone: "каталог на фирмите в индустриална зона", chamberIndustry: "индустриална камара", chamberCommerce: "търговска камара", exhibitorList: "списък на изложителите", supplierList: "списък на доставчиците", associationMembers: "членове на асоциацията", contactEmail: "служебен имейл за контакт" },
  hr: { memberList: "popis članova", companyDirectory: "direktorij tvrtki", industrialZone: "direktorij tvrtki industrijska zona", chamberIndustry: "industrijska komora", chamberCommerce: "trgovačka komora", exhibitorList: "popis izlagača", supplierList: "popis dobavljača", associationMembers: "članovi udruge", contactEmail: "kontaktni email tvrtke" },
  lt: { memberList: "narių sąrašas", companyDirectory: "įmonių katalogas", industrialZone: "pramonės zonos įmonių katalogas", chamberIndustry: "pramonės rūmai", chamberCommerce: "prekybos rūmai", exhibitorList: "parodos dalyvių sąrašas", supplierList: "tiekėjų sąrašas", associationMembers: "asociacijos nariai", contactEmail: "įmonės kontaktinis el. paštas" },
  et: { memberList: "liikmete nimekiri", companyDirectory: "ettevõtete kataloog", industrialZone: "tööstuspiirkonna ettevõtete kataloog", chamberIndustry: "tööstuskoda", chamberCommerce: "kaubanduskoda", exhibitorList: "eksponentide nimekiri", supplierList: "tarnijate nimekiri", associationMembers: "ühenduse liikmed", contactEmail: "ettevõtte kontakt e-post" },
  lv: { memberList: "biedru saraksts", companyDirectory: "uzņēmumu katalogs", industrialZone: "rūpniecības zonas uzņēmumu katalogs", chamberIndustry: "rūpniecības kamera", chamberCommerce: "tirdzniecības kamera", exhibitorList: "izstādes dalībnieku saraksts", supplierList: "piegādātāju saraksts", associationMembers: "asociācijas biedri", contactEmail: "uzņēmuma kontakta e-pasts" },
};

const COUNTRY_LOCALES: Readonly<Record<string, readonly QueryLocale[]>> = {
  turkey: ["tr", "en"], turkiye: ["tr", "en"], spain: ["es", "en"], venezuela: ["es", "en"],
  colombia: ["es", "en"], brazil: ["pt", "en"], russia: ["ru", "en"], ukraine: ["ru", "en"],
  germany: ["de", "en"], austria: ["de", "en"], italy: ["it", "en"], poland: ["pl", "en"],
  romania: ["ro", "en"], bulgaria: ["bg", "ru", "en"], georgia: ["ru", "en"], egypt: ["ar", "en"],
  "saudi arabia": ["ar", "en"], iran: ["fa", "en"], china: ["zh", "en"],
  peru: ["es", "en"], chile: ["es", "en"], mexico: ["es", "en"], panama: ["es", "en"],
  ecuador: ["es", "en"], argentina: ["es", "en"], "dominican republic": ["es", "en"],
  portugal: ["pt", "en"], morocco: ["ar", "en"], algeria: ["ar", "en"], tunisia: ["ar", "en"],
  "united arab emirates": ["ar", "en"], jordan: ["ar", "en"], iraq: ["ar", "en"],
  kazakhstan: ["ru", "en"], uzbekistan: ["ru", "en"], azerbaijan: ["ru", "en"],
  armenia: ["ru", "en"], belarus: ["ru", "en"], moldova: ["ro", "en"],
  greece: ["el", "en"], france: ["fr", "en"], netherlands: ["nl", "en"],
  belgium: ["nl", "fr", "en"], "united kingdom": ["en"], ireland: ["en"],
  sweden: ["sv", "en"], denmark: ["da", "en"], norway: ["no", "en"], finland: ["fi", "en"],
  "czech republic": ["cs", "en"], slovakia: ["sk", "en"], hungary: ["hu", "en"],
  croatia: ["hr", "en"], slovenia: ["en"], lithuania: ["lt", "en"], estonia: ["et", "en"],
  latvia: ["lv", "en"], luxembourg: ["fr", "de", "en"], switzerland: ["de", "fr", "it", "en"],
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

// One URL token per locale. Stacking several inurl operators next to a filetype
// operator narrows a query to almost nothing, so document shapes lean on the
// filetype operator alone and page shapes on a single localized URL token.
export const LOCALIZED_URL_TOKENS: Readonly<Record<QueryLocale, string>> = {
  tr: "rehber", es: "directorio", pt: "diretorio", ru: "katalog", en: "directory",
  de: "verzeichnis", it: "elenco", pl: "katalog", ro: "director", ar: "members",
  fa: "members", zh: "members",
  el: "katalogos", fr: "annuaire", nl: "gids", sv: "register", da: "register",
  no: "register", fi: "hakemisto", cs: "katalog", sk: "katalog", hu: "cegjegyzek",
  bg: "katalog", hr: "direktorij", lt: "katalogas", et: "kataloog", lv: "katalogs",
};

function buildShape(shape: LeadGenQueryShape, keyword: string, region: string | null, locale: QueryLocale, profile: LeadGenProfile) {
  const base = [keyword, region].filter(Boolean) as string[];
  switch (shape) {
    case "company_site": return [...base, phrase(locale, "contactEmail")].join(" ");
    case "member_list": return [...base, phrase(locale, "chamberIndustry"), phrase(locale, "memberList"), `inurl:${LOCALIZED_URL_TOKENS[locale]}`].join(" ");
    case "cluster": return [region, phrase(locale, "industrialZone"), keyword].filter(Boolean).join(" ");
    case "pdf_directory":
      return locale === "tr"
        ? [...base, "uye firma rehberi", "filetype:pdf"].join(" ")
        : [...base, phrase(locale, "companyDirectory"), phrase(locale, "associationMembers"), "filetype:pdf"].join(" ");
    case "contact_page":
      return locale === "tr"
        ? [...base, phrase(locale, "contactEmail"), "contact page"].join(" ")
        : [...base, "buyers distributors"].join(" ");
    case "doc_pdf_directory": return addSitePatterns([...base, phrase(locale, "companyDirectory"), phrase(locale, "memberList"), "filetype:pdf"], profile).join(" ");
    case "doc_spreadsheet_directory": return addSitePatterns([...base, phrase(locale, "companyDirectory"), phrase(locale, "supplierList"), "(filetype:xls OR filetype:xlsx)"], profile).join(" ");
    case "doc_office_directory": return addSitePatterns([...base, phrase(locale, "companyDirectory"), phrase(locale, "memberList"), "(filetype:doc OR filetype:docx)"], profile).join(" ");
    case "exhibitor_list": return addSitePatterns([...base, phrase(locale, "exhibitorList"), "filetype:pdf"], profile).join(" ");
    case "association_members": return addSitePatterns([...base, phrase(locale, "associationMembers"), "filetype:pdf"], profile).join(" ");
  }
}

const ALL_SHAPES: readonly LeadGenQueryShape[] = [
  "company_site", "member_list", "cluster", "pdf_directory", "contact_page",
  "doc_pdf_directory", "doc_spreadsheet_directory", "doc_office_directory",
  "exhibitor_list", "association_members",
];

// The plan is interleaved so bounded plans stay balanced across segments and regions.
export function buildQueryPlan(profile: LeadGenProfile, options: BuildQueryPlanOptions = {}): LeadGenQuery[] {
  const requestedShapes = options.shapes?.length ? new Set(options.shapes) : null;
  const segments = options.segmentKeys?.length ? profile.segments.filter((segment) => options.segmentKeys?.includes(segment.key)) : profile.segments;
  const regionCap = options.maxRegionsPerSegment ?? profile.regions.length;
  const seen = new Set<string>();
  const entries: Array<{
    query: LeadGenQuery;
    keywordIdx: number;
    regionIdx: number;
    segmentIdx: number;
    localeIdx: number;
    shapeIdx: number;
  }> = [];

  segments.forEach((segment, segmentIdx) => {
    const regions = [null, ...profile.regions.slice(0, regionCap)] as (string | null)[];
    regions.forEach((region, regionIdx) => {
      queryLocalesForRegion(region, profile.queryLocales).forEach((locale, localeIdx) => {
        const shapes = ALL_SHAPES.filter((shape) => !requestedShapes || requestedShapes.has(shape));
        const keywords = segment.keywordsByLocale?.[locale] ?? segment.keywords;
        keywords.forEach((keyword, keywordIdx) => {
          shapes.forEach((shape, shapeIdx) => {
            const query = buildShape(shape, keyword, region, locale, profile).replace(/\s+/g, " ").trim();
            const key = `${shape}:${locale}:${query.toLowerCase()}`;
            if (seen.has(key)) return;
            seen.add(key);
            const input = [profile.slug, segment.key, region ?? "all", locale, keyword, shape, query].join("|");
            const id = `${profile.slug}-${createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
            entries.push({
              query: { id, query, segmentKey: segment.key, region, locale, shape },
              keywordIdx,
              regionIdx,
              segmentIdx,
              localeIdx,
              shapeIdx,
            });
          });
        });
      });
    });
  });
  entries.sort((a, b) =>
    a.keywordIdx - b.keywordIdx
    || a.regionIdx - b.regionIdx
    || a.segmentIdx - b.segmentIdx
    || a.localeIdx - b.localeIdx
    || a.shapeIdx - b.shapeIdx,
  );
  const plan = entries.map((entry) => entry.query);
  if (!options.limit) return plan;
  return plan.slice(0, Math.max(1, Math.ceil(options.limit)));
}
