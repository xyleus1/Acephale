import assert from "node:assert/strict";
import {
  buildQueryPlan,
  LOCALIZED_PHRASES,
  LOCALIZED_URL_TOKENS,
  type QueryLocale,
} from "../src/lib/leadgen/query-plan";
import { MANEKS_CORRIDOR_PROFILE, MANEKS_PROFILE } from "../src/lib/leadgen/profile";
import { WENS_PROFILE } from "../src/lib/leadgen/profile-wens";
import { resolveLeadGenProfile } from "../src/lib/leadgen/registry";
import {
  createSerperSearchProvider,
  dedupeByDomain,
  parseJsonlResults,
  parseSearchResults,
  parseSerperResults,
} from "../src/lib/leadgen/search";
import { parseDirectoryDocument } from "../src/lib/leadgen/directory";
import {
  extractCity,
  extractCompanyName,
  extractEmails,
  extractPhones,
  htmlToText,
  isRoleEmail,
  pickContactLinks,
  registrableDomain,
} from "../src/lib/leadgen/extract";
import { scoreLead } from "../src/lib/leadgen/score";
import { verifyEmail } from "../src/lib/leadgen/verify";
import { extractDirectoryTargets, harvestSite, scoreEmailUsefulness, type FetchedPage } from "../src/lib/leadgen/harvest";
import { runProspectingBatch } from "../src/lib/leadgen/run";
import { checkPublicUrl, guardedRequest, isPrivateAddress } from "../src/lib/leadgen/fetch-guard";
import { createServer } from "node:http";

// Query plan

const plan = buildQueryPlan(MANEKS_PROFILE, { limit: 50 });
assert.equal(plan.length, 50, "the plan must respect the limit");
assert.equal(new Set(plan.map((entry) => entry.query)).size, 50, "queries must be unique");
assert.ok(plan.some((entry) => entry.shape === "pdf_directory"), "pdf directories must be part of the sweep");
assert.ok(plan.some((entry) => entry.shape === "doc_pdf_directory"), "document PDF directories must be part of the sweep");
assert.ok(plan.some((entry) => entry.locale === "tr"), "the Maneks smoke plan keeps Turkish locale queries");
const internationalPlan = buildQueryPlan(
  { ...MANEKS_PROFILE, regions: ["Venezuela"], sitePatterns: ["org", "com.ve"] },
  { limit: 200 },
);
assert.ok(internationalPlan.some((entry) => entry.region === "Venezuela" && entry.locale === "es"), "Venezuela must use Spanish queries");
assert.ok(internationalPlan.some((entry) => entry.region === "Venezuela" && entry.locale === "en"), "international fallback must accompany Spanish queries");
const brazilPlan = buildQueryPlan({ ...MANEKS_PROFILE, regions: ["Brazil"] }, { segmentKeys: [MANEKS_PROFILE.segments[0]!.key] });
assert.ok(brazilPlan.some((entry) => entry.locale === "pt" && entry.query.includes("lista de membros")), "Brazil must use Portuguese directory queries");
assert.ok(internationalPlan.some((entry) => entry.shape === "exhibitor_list" && entry.query.includes("filetype:pdf")), "exhibitor searches must hunt documents");
assert.equal(buildQueryPlan(MANEKS_PROFILE, { limit: 30 }).map((entry) => entry.id).join("|"), buildQueryPlan(MANEKS_PROFILE, { limit: 30 }).map((entry) => entry.id).join("|"), "query ids must be stable");

const scoped = buildQueryPlan(MANEKS_PROFILE, { segmentKeys: ["fabricator"], maxRegionsPerSegment: 2 });
assert.ok(scoped.every((entry) => entry.segmentKey === "fabricator"), "segment filter must hold");
assert.ok(
  scoped.every((entry) => entry.region === null || ["Istanbul", "Kocaeli"].includes(entry.region)),
  "region cap must hold",
);
const corridorPlan = buildQueryPlan(MANEKS_CORRIDOR_PROFILE, {
  segmentKeys: ["steel_service_center"],
  shapes: ["member_list"],
});
assert.ok(
  corridorPlan.some((entry) =>
    entry.region === "Venezuela"
      && entry.locale === "es"
      && entry.query.includes("centro de servicio de acero")
      && entry.query.includes("lista de miembros"),
  ),
  "Venezuela corridor queries must use Spanish segment and directory keywords",
);
assert.ok(
  corridorPlan.some((entry) =>
    entry.region === "Russia"
      && entry.locale === "ru"
      && entry.query.includes("металлосервисный центр")
      && entry.query.includes("список участников"),
  ),
  "Russia corridor queries must use Cyrillic segment and directory keywords",
);
const wensPlan = buildQueryPlan(WENS_PROFILE, { limit: 5_000 });
assert.ok(
  wensPlan.some((entry) =>
    entry.region === "Greece" && entry.locale === "el" && entry.query.includes("βιομηχανια αρτοποιιας"),
  ),
  "Greece must use Greek segment keywords and directory phrases",
);
assert.ok(
  wensPlan.some((entry) =>
    entry.region === "Germany" && entry.locale === "de" && entry.query.includes("Grossbackerei Hersteller"),
  ),
  "Germany must use German segment keywords and directory phrases",
);
assert.ok(
  wensPlan.some((entry) =>
    entry.region === "Italy" && entry.locale === "it" && entry.query.includes("industria da forno produttore"),
  ),
  "Italy must use Italian segment keywords and directory phrases",
);
const queryLocales: readonly QueryLocale[] = [
  "tr", "es", "ru", "en", "de", "it", "pl", "ro", "ar", "fa", "zh", "pt",
  "el", "fr", "nl", "sv", "da", "no", "fi", "cs", "sk", "hu", "bg", "hr", "lt", "et", "lv",
];
const phraseConcepts = [
  "memberList", "companyDirectory", "industrialZone", "chamberIndustry",
  "chamberCommerce", "exhibitorList", "supplierList", "associationMembers", "contactEmail",
] as const;
for (const locale of queryLocales) {
  assert.ok(LOCALIZED_PHRASES[locale], `${locale} must have localized phrases`);
  for (const concept of phraseConcepts) {
    assert.ok(LOCALIZED_PHRASES[locale][concept], `${locale} must define ${concept}`);
  }
  assert.ok(LOCALIZED_URL_TOKENS[locale], `${locale} must have a URL token`);
}
assert.equal(resolveLeadGenProfile("wens").slug, "wens");
assert.throws(() => resolveLeadGenProfile("unknown"), /Unknown leadgen profile "unknown".*Valid slugs:/);
assert.deepEqual(
  wensPlan.map((entry) => entry.id),
  buildQueryPlan(WENS_PROFILE, { limit: 5_000 }).map((entry) => entry.id),
  "Wens query ids must be stable",
);
const legacyKeywordPlan = buildQueryPlan({
  ...MANEKS_CORRIDOR_PROFILE,
  regions: ["Venezuela"],
  segments: [{ key: "legacy", label: "Legacy", keywords: ["legacy buyer"], weight: 1 }],
}, { shapes: ["member_list"] });
assert.ok(legacyKeywordPlan.some((entry) => entry.query.includes("legacy buyer")), "segments without localized keywords must use keywords");

// Search result parsing

const braveHtml = `
  <a href="https://search.brave.com/settings">settings</a>
  <a href="https://www.ornekcelik.com.tr/iletisim">Ornek Celik</a>
  <a href="https://www.ornekcelik.com.tr/hakkimizda">Ornek Celik about</a>
  <a href="https://www.linkedin.com/company/ornekcelik">LinkedIn</a>
  <a href="https://makinaimalat.com/">Makina Imalat</a>
`;
const braveHits = parseSearchResults(braveHtml, "brave");
assert.deepEqual(
  braveHits.map((hit) => hit.domain),
  ["ornekcelik.com.tr", "ornekcelik.com.tr", "makinaimalat.com"],
  "engine chrome and social networks must be dropped",
);
assert.equal(dedupeByDomain(braveHits).length, 2, "hits collapse to one entry per domain");

const ddgHtml = `<a href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.dokumsan.com.tr%2Firtibat&rut=x">Dokumsan</a>`;
assert.equal(parseSearchResults(ddgHtml, "duckduckgo")[0]?.domain, "dokumsan.com.tr", "redirects must be unwrapped");

const serperFixture = {
  organic: [
    { link: "https://www.linkedin.com/company/noise", title: "noise", position: 1 },
    { link: "https://www.buyer-two.com/contact", title: "Buyer Two", position: 4 },
    { link: "https://www.buyer-one.com", title: "Buyer One", position: 2 },
  ],
};
const serperHits = parseSerperResults(serperFixture);
assert.deepEqual(serperHits.map((hit) => [hit.domain, hit.rank]), [["buyer-one.com", 2], ["buyer-two.com", 4]], "Serper parsing must filter non-lead hosts and retain rank order");
const serperWithoutKey = createSerperSearchProvider("");
assert.deepEqual(
  parseJsonlResults(
    '{"query":"steel buyers","url":"https://buyer-b.example","rank":3}\n{"query":"steel buyers","url":"https://www.linkedin.com/company/noise","rank":1}\n',
    "steel buyers",
  ).map((hit) => [hit.domain, hit.rank]),
  [["buyer-b.example", 3]],
  "JSONL results must use the shared lead-host filter",
);

const boundaryHtml = `
  <a href="https://www.teknomax.com/iletisim">Teknomax</a>
  <a href="https://x.com/teknomax">X profile</a>
  <a href="https://tr.linkedin.com/company/teknomax">LinkedIn</a>
`;
assert.deepEqual(
  parseSearchResults(boundaryHtml, "brave").map((hit) => hit.domain),
  ["teknomax.com"],
  "blocked hosts must match on label boundaries, not raw substrings",
);

const directoryPdf: FetchedPage = {
  url: "https://chamber.example/members.pdf",
  status: 200,
  contentType: "application/pdf",
  body: [
    "Chamber Member Directory",
    "Chamber Member Directory",
    "Chamber Member Directory",
    "ALPHA STEEL GmbH | info@alpha-steel.de | https://alpha-steel.de | Berlin",
    "BETA METAL INDUSTRIES | sales@beta-metal.ru | https://beta-metal.ru | Moscow",
    "Footer 2026",
    "Footer 2026",
    "Footer 2026",
  ].join("\n"),
  isPdf: true,
};
const parsedPdf = parseDirectoryDocument(directoryPdf, { regions: ["Berlin", "Moscow"] });
assert.equal(parsedPdf.kind, "pdf");
assert.equal(parsedPdf.rows.length, 2, "PDF-like member lists must emit one row per company");
assert.equal(parsedPdf.rows[0]?.domain, "alpha-steel.de");
assert.equal(parsedPdf.rows[1]?.sourceUrl, directoryPdf.url);
assert.equal(parsedPdf.rows[0]?.rowIndex, 4);
assert.equal(parsedPdf.skipped, 6, "repeating headers, footer, and non-record lines must count as skipped");

const namesOnlyPdf: FetchedPage = {
  ...directoryPdf,
  url: "https://chamber.example/names.pdf",
  body: "1 1 Altra Steel Ankara\n2 2 Canam Group Inc. Moscow\n3 3 12345\n",
};
const parsedNamesOnly = parseDirectoryDocument(namesOnlyPdf, { regions: ["Ankara", "Moscow"] });
assert.equal(parsedNamesOnly.rows.length, 2, "names-only directory rows need no contact datum");
assert.equal(parsedNamesOnly.rows[0]?.needsResolution, true);
assert.equal(parsedNamesOnly.rows[0]?.companyName, "Altra Steel");
const cyrillicNames = parseDirectoryDocument({
  ...namesOnlyPdf,
  url: "https://chamber.example/russian-members.pdf",
  body: "ООО Северный Металл\nЗАО РусСталь\nУрал стали\n",
});
assert.equal(cyrillicNames.looksLikeDirectory, true);
assert.equal(cyrillicNames.rows.length, 3, "distinct domainless Cyrillic names must survive deduplication");
const multipleEmails = parseDirectoryDocument({
  ...namesOnlyPdf,
  url: "https://chamber.example/multiple-emails.pdf",
  body: "4 4 Baltic Steel GmbH First@Baltic-Steel.de second@baltic-steel.de +90 (224) 456-7890 Berlin\n5 5 Delta Steel GmbH info@delta-steel.de Madrid\n",
}, { regions: ["Berlin"] });
assert.equal(multipleEmails.rows[0]?.companyName, "Baltic Steel GmbH");
assert.equal(multipleEmails.rows[0]?.emails.length, 2, "each inline email must be removed from the company name");
assert.doesNotMatch(multipleEmails.rows[0]?.companyName ?? "", /@/);
assert.doesNotMatch(multipleEmails.rows[0]?.companyName ?? "", /224|456|7890/);
assert.equal(extractCity("Buyer Buenos Aires (CABA)", ["Buenos Aires (CABA)"]), "Buenos Aires (CABA)");

const brochure = parseDirectoryDocument({
  ...directoryPdf,
  url: "https://publisher.example/catalog.pdf",
  body: Array.from({ length: 98 }, (_, index) => `Global Iron Steel market overview ${index + 1}`).join("\n"),
});
assert.equal(brochure.looksLikeDirectory, false, "sparse marketing brochures must be classified as non-directories");
assert.equal(brochure.rows.length, 0);

const directoryHtml: FetchedPage = {
  url: "https://association.example/members",
  status: 200,
  contentType: "text/html",
  body: `<table><tr><th>Компания</th><th>Почта</th><th>Телефон</th><th>Город</th><th>Сайт</th></tr><tr><td>Baltic Metal GmbH</td><td>info@baltic-metal.de</td><td>+90 212 555 12 12</td><td>Berlin</td><td>https://baltic-metal.de</td></tr><tr><td>Volga Steel OOO</td><td>sales@volga-steel.ru</td><td>+90 212 555 12 13</td><td>Moscow</td><td>https://volga-steel.ru</td></tr></table>`,
  isPdf: false,
};
const parsedHtml = parseDirectoryDocument(directoryHtml, { regions: ["Berlin"] });
assert.equal(parsedHtml.kind, "html_table");
assert.equal(parsedHtml.rows[0]?.companyName, "Baltic Metal GmbH");
assert.equal(parsedHtml.rows[0]?.emails[0], "info@baltic-metal.de");
const multipleTables = parseDirectoryDocument({
  ...directoryHtml,
  url: "https://association.example/multiple-tables",
  body: "<table><tr><th>Компания</th></tr><tr><td>Северный Металл</td></tr></table><table><tr><th>Компания</th></tr><tr><td>Урал стали</td></tr></table>",
});
assert.equal(multipleTables.looksLikeDirectory, true);
assert.deepEqual(multipleTables.rows.map((row) => row.rowIndex), [1, 2], "HTML row provenance must be monotonic across tables");

const directoryCsv: FetchedPage = {
  url: "https://association.example/members.csv",
  status: 200,
  contentType: "text/csv",
  body: "Empresa;Correo;Ciudad;Website\nDelta Steel Ltd;hello@delta-steel.es;Madrid;https://delta-steel.es\nAcero Norte SRL;ventas@acero-norte.es;Bilbao;https://acero-norte.es\n",
  isPdf: false,
};
const parsedCsv = parseDirectoryDocument(directoryCsv);
assert.equal(parsedCsv.kind, "delimited");
assert.equal(parsedCsv.rows.length, 2);
assert.equal(parsedCsv.rows[0]?.domain, "delta-steel.es");
const headerlessCsv = parseDirectoryDocument({
  ...directoryCsv,
  url: "https://association.example/headerless.csv",
  body: "First Steel,info@first-steel.example,+90 212 000 00 00,Istanbul,first-steel.example\nSecond Steel,info@second-steel.example,+90 212 000 00 01,Ankara,second-steel.example",
});
assert.equal(headerlessCsv.rows.length, 2, "headerless delimited directories must keep the first row");
assert.equal(headerlessCsv.rows[0]?.companyName, "First Steel");
const plainDirectory = parseDirectoryDocument({
  url: "https://association.example/plain.txt",
  status: 200,
  contentType: "text/plain",
  body: "Altra Steel Ankara\nCanam Group Inc. Moscow\n",
  isPdf: false,
}, { regions: ["Ankara", "Moscow"] });
assert.equal(plainDirectory.kind, "delimited");
assert.equal(plainDirectory.rows.length, 2, "plain-text directory documents must expand into rows");

// Extraction

const companyHtml = `
  <html><head><title>Ornek Celik Sanayi ve Ticaret A.S. | Anasayfa</title></head>
  <body>
    <h1>Celik konstruksiyon imalat</h1>
    <p>Bursa Nilufer Organize Sanayi Bolgesi</p>
    <a href="/iletisim">Iletisim</a>
    <a href="/urunler">Urunler</a>
    <a href="https://twitter.com/ornekcelik">Twitter</a>
    <p>satis (at) ornekcelik (dot) com.tr</p>
    <p>info@ornekcelik.com.tr</p>
    <p>Tel: 0224 456 78 90</p>
  </body></html>`;
const companyText = htmlToText(companyHtml);
assert.equal(extractCompanyName(companyHtml, companyText, "ornekcelik.com.tr"), "Ornek Celik Sanayi ve Ticaret A.S.");
assert.deepEqual(
  extractEmails(`${companyHtml}\n${companyText}`).sort(),
  ["info@ornekcelik.com.tr", "satis@ornekcelik.com.tr"],
  "plain and obfuscated addresses must both be recovered",
);
assert.deepEqual(extractPhones(companyText, "90"), ["+90 224 456 78 90"]);
assert.deepEqual(extractPhones("Tel: +58 212 555 1234"), ["+58 212 555 1234"]);
assert.equal(extractPhones("Tel: +58 212 555 1234").some((phone) => phone.includes("+90")), false);
assert.deepEqual(extractPhones("Tel: 0212 555 12 34", "90"), ["+90 212 555 12 34"]);
assert.deepEqual(extractPhones("Tel: 0212 555 12 34"), ["0212 555 12 34"]);
assert.deepEqual(extractPhones("Tax ID: 12345678901234567890"), []);
assert.deepEqual(extractPhones("Short code: 12345"), []);
assert.equal(extractCity(companyText), "Bursa");
assert.deepEqual(
  pickContactLinks(["https://www.ornekcelik.com.tr/iletisim", "https://www.ornekcelik.com.tr/urunler", "https://x.com/a"], "https://www.ornekcelik.com.tr"),
  ["https://www.ornekcelik.com.tr/iletisim"],
);
assert.equal(registrableDomain("https://shop.ornekcelik.com.tr/x"), "ornekcelik.com.tr");
assert.equal(isRoleEmail("info@x.com"), true);
assert.equal(isRoleEmail("mehmet.yilmaz@x.com"), false);
assert.ok(
  scoreEmailUsefulness("satis@ornekcelik.com.tr", "ornekcelik.com.tr") >
    scoreEmailUsefulness("info@gmail.com", "ornekcelik.com.tr"),
  "company-domain sales addresses outrank free inboxes",
);

// Fit scoring

const goodFit = scoreLead(MANEKS_PROFILE, {
  companyName: "Ornek Celik Sanayi",
  domain: "ornekcelik.com.tr",
  pageText: "celik konstruksiyon imalat yapan fabrika, sac ve profil uretim tesisi",
  segmentKey: null,
  emailCount: 2,
  hasPhone: true,
});
assert.equal(goodFit.tier, "A", "a steel fabricator page must land in the top tier");
assert.ok(goodFit.matchedSegments.includes("fabricator"));

const badFit = scoreLead(MANEKS_PROFILE, {
  companyName: "Sahil Emlak",
  domain: "sahilemlak.com",
  pageText: "emlak ve gayrimenkul danismanligi, turizm bolgesinde otel satisi",
  segmentKey: null,
  emailCount: 1,
  hasPhone: true,
});
assert.equal(badFit.tier, "reject", "off-profile pages must be rejected");

async function main() {
// Verification

assert.deepEqual(await serperWithoutKey.search("offline fixture"), [], "Serper without a key must be a no-op");

const withMx = await verifyEmail("satis@ornekcelik.com.tr", {
  companyDomain: "ornekcelik.com.tr",
  resolveMx: async () => [{ exchange: "mail.ornekcelik.com.tr", priority: 10 }],
});
assert.equal(withMx.verdict, "deliverable_likely");
assert.equal(withMx.domainMatchesCompany, true);
assert.equal(withMx.mxHost, "mail.ornekcelik.com.tr");

const noMx = await verifyEmail("info@dead-domain.com", { resolveMx: async () => [] });
assert.equal(noMx.verdict, "undeliverable");

const freeMailbox = await verifyEmail("ahmet1985@gmail.com", {
  companyDomain: "ornekcelik.com.tr",
  resolveMx: async () => [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }],
});
assert.equal(freeMailbox.verdict, "risky", "free provider mailboxes need a second look before sending");
assert.equal((await verifyEmail("not-an-email", { resolveMx: async () => [] })).verdict, "undeliverable");
assert.equal((await verifyEmail("email@ornek.com", { resolveMx: async () => [] })).verdict, "undeliverable");

// Harvest with a stubbed fetcher

const pages: Record<string, FetchedPage> = {
  "https://www.ornekcelik.com.tr": {
    url: "https://www.ornekcelik.com.tr",
    status: 200,
    contentType: "text/html",
    body: companyHtml,
    isPdf: false,
  },
  "https://www.ornekcelik.com.tr/iletisim": {
    url: "https://www.ornekcelik.com.tr/iletisim",
    status: 200,
    contentType: "text/html",
    body: "<html><body><p>ihracat@ornekcelik.com.tr</p><p>Bursa</p></body></html>",
    isPdf: false,
  },
};
const harvested = await harvestSite(MANEKS_PROFILE, "https://www.ornekcelik.com.tr", {
  fetcher: async (url) => pages[url] ?? null,
  now: () => new Date("2026-08-24T00:00:00.000Z"),
});
assert.ok(harvested, "a reachable site must produce a candidate");
assert.equal(harvested?.domain, "ornekcelik.com.tr");
assert.equal(harvested?.city, "Bursa");
assert.ok(harvested?.emails.includes("ihracat@ornekcelik.com.tr"), "contact pages must be crawled");
assert.equal(harvested?.evidence.length, 2, "every fetched page must stay in the evidence trail");
assert.equal(harvested?.fit.tier, "A");

const tableHomepage = await harvestSite(MANEKS_PROFILE, "https://table-homepage.example", {
  directoryMode: true,
  fetcher: async () => ({
    url: "https://table-homepage.example",
    status: 200,
    contentType: "text/html",
    body: "<title>Table Steel</title><table><tr><td>Menu</td><td>Value</td></tr><tr><td>Home</td><td>Welcome</td></tr></table><p>steel manufacturing</p>",
    isPdf: false,
  }),
});
assert.ok(tableHomepage && !Array.isArray(tableHomepage), "layout tables must fall through to single-company harvest");
if (!tableHomepage || Array.isArray(tableHomepage)) throw new Error("layout table was treated as a directory");
assert.equal(tableHomepage.companyName, "Table Steel");

const directoryHarvested = await harvestSite(MANEKS_PROFILE, directoryPdf.url, {
  directoryMode: true,
  fetcher: async () => directoryPdf,
});
assert.equal(directoryHarvested?.length, 2, "directory mode must return many rows without changing default harvest");

const documentUrls: string[] = [];
let directoryMxCalls = 0;
const documentBatch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 3,
  budgetMs: 10_000,
  search: async () => [
    { url: "https://chamber.example/one.pdf", domain: "chamber.example", engine: "brave", rank: 1 },
    { url: "https://chamber.example/two.pdf", domain: "chamber.example", engine: "brave", rank: 2 },
  ],
  fetchPage: async (url) => {
    documentUrls.push(url);
    return {
      url,
      status: 200,
      contentType: "application/pdf",
      body: "Alpha Steel GmbH Berlin\nBeta Steel GmbH Berlin\n",
      isPdf: true,
    };
  },
  resolveMx: async () => {
    directoryMxCalls += 1;
    return [];
  },
});
assert.deepEqual(documentUrls, ["https://chamber.example/one.pdf", "https://chamber.example/two.pdf"]);
assert.equal(documentBatch.stats.pagesFetched, 2);
assert.equal(documentBatch.stats.candidatesFound, 4, "both documents on one host must expand independently");
assert.equal(directoryMxCalls, 0, "names-only directory rows must not trigger email verification");

let deadlineMxCalls = 0;
const deadlineBatch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 2,
  budgetMs: 1_000,
  search: async () => [
    { url: "https://chamber.example/deadline.pdf", domain: "chamber.example", engine: "brave", rank: 1 },
  ],
  fetchPage: async (url) => ({
    url,
    status: 200,
    contentType: "application/pdf",
    body: "Alpha Steel GmbH alpha@alpha-steel.example\nBeta Steel GmbH beta@beta-steel.example\nGamma Steel GmbH gamma@gamma-steel.example\n",
    isPdf: true,
  }),
  resolveMx: async () => {
    deadlineMxCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    return [];
  },
});
assert.equal(deadlineBatch.candidates.length, 1, "directory expansion must stop after the deadline");
assert.equal(deadlineBatch.stats.candidatesFound, 1);
assert.equal(deadlineMxCalls, 1);

assert.equal(
  await harvestSite(MANEKS_PROFILE, "https://missing.example", { fetcher: async () => null }),
  null,
  "unreachable sites must not become leads",
);

assert.deepEqual(
  extractDirectoryTargets(
    `<a href="https://uyefirma1.com.tr/">Firma 1</a><a href="/hakkimizda">self</a><a href="https://uyefirma2.com">Firma 2</a>`,
    "https://www.ornekosb.org.tr/uyeler",
  ),
  ["https://uyefirma1.com.tr", "https://uyefirma2.com"],
  "member lists must yield outbound company domains only",
);

// Egress guard

const publicResolver = async () => ["93.184.216.34"];

assert.ok(isPrivateAddress("127.0.0.1"));
assert.ok(isPrivateAddress("10.4.4.4"));
assert.ok(isPrivateAddress("169.254.169.254"));
assert.ok(isPrivateAddress("::1"));
assert.ok(!isPrivateAddress("93.184.216.34"));

assert.equal(
  (await checkPublicUrl("https://ornekcelik.com.tr/iletisim", publicResolver)).ok,
  true,
  "public company sites must stay fetchable",
);
for (const [target, reason] of [
  ["file:///etc/passwd", "scheme"],
  ["http://user:pass@ornekcelik.com.tr", "credentials"],
  ["http://ornekcelik.com.tr:22/", "port"],
  ["http://localhost:8080/admin", "private_host"],
  ["http://169.254.169.254/latest/meta-data", "private_host"],
  ["http://10.0.0.5/", "private_host"],
  ["http://intranet.internal/", "private_host"],
] as const) {
  const result = await checkPublicUrl(target, publicResolver);
  assert.equal(result.ok, false, `${target} must be blocked`);
  assert.equal(result.ok === false && result.reason, reason);
}
const rebound = await checkPublicUrl("https://evil.example/", async () => ["127.0.0.1"]);
assert.equal(rebound.ok, false, "hosts resolving into loopback space must be blocked");

// The connect-time lookup is the real gate: a host that passes the pre-check
// but points at loopback when dialed must still fail to connect.
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<html>internal</html>");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
await assert.rejects(
  guardedRequest(new URL(`http://localhost:${port}/`)),
  "connecting to a hostname that resolves to loopback must be refused",
);
server.close();

console.log("leadgen: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
