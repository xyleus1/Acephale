import assert from "node:assert/strict";
import {
  buildQueryPlan,
  LOCALIZED_PHRASES,
  LOCALIZED_URL_TOKENS,
  type QueryLocale,
} from "../src/lib/leadgen/query-plan";
import {
  MANEKS_CORRIDOR_PROFILE,
  MANEKS_PROFILE,
  signalsFromProductFocus,
} from "../src/lib/leadgen/profile";
import { WENS_PROFILE } from "../src/lib/leadgen/profile-wens";
import { FEAST_PROFILE } from "../src/lib/leadgen/profile-feast";
import {
  COSMICBRAIN_HOSPITALITY_PROFILE,
  COSMICBRAIN_SUPPLIERS_PROFILE,
} from "../src/lib/leadgen/profile-cosmicbrain";
import { OLYMPIAN_PROFILE } from "../src/lib/leadgen/profile-olympian";
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
import { mailboxVerifierFromEnv, verifyEmail, verifyEmails, type MailboxVerifier } from "../src/lib/leadgen/verify";
import { createBouncerVerifier, parseBouncerResponse } from "../src/lib/leadgen/bouncer";
import { createHunterEnricher, parseHunterDomainSearch } from "../src/lib/leadgen/hunter";
import { contactEnricherFromEnv, rankEnrichedContacts, selectPrimaryContact, type EnrichedContact } from "../src/lib/leadgen/enrich";
import { extractDirectoryTargets, harvestSite, scoreEmailUsefulness, type FetchedPage } from "../src/lib/leadgen/harvest";
import { profileFromProspectingDraft, runProspectingBatch } from "../src/lib/leadgen/run";
import { persistLeads } from "../src/lib/leadgen/persist";
import { checkPublicUrl, guardedRequest, isPrivateAddress } from "../src/lib/leadgen/fetch-guard";
import { createServer } from "node:http";

// Paid providers must never be reached from the suite, even on a machine with keys.
delete process.env.BOUNCER_API_KEY;
delete process.env.HUNTER_API_KEY;

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
assert.equal(buildQueryPlan(MANEKS_PROFILE, { limit: 0 }).length, buildQueryPlan(MANEKS_PROFILE).length);
assert.ok(buildQueryPlan(MANEKS_PROFILE, { limit: 0 }).length > 0);
const draftScopedProfile = { ...MANEKS_PROFILE, regions: ["India", "Vietnam"], globalQueries: false };
const draftScopedPlan = buildQueryPlan(draftScopedProfile);
assert.ok(draftScopedPlan.length > 0);
assert.ok(draftScopedPlan.every((entry) => entry.region !== null));
assert.ok(draftScopedPlan.every((entry) => !/firma rehberi|uye listesi/i.test(entry.query)));
const zeroRegionCapPlan = buildQueryPlan(draftScopedProfile, { maxRegionsPerSegment: 0 });
assert.ok(zeroRegionCapPlan.length > 0);
assert.equal(zeroRegionCapPlan[0]?.region, null);
const legacyGlobalPlan = buildQueryPlan({ ...draftScopedProfile, globalQueries: undefined });
assert.ok(legacyGlobalPlan.length > 0);
assert.equal(legacyGlobalPlan[0]?.region, null);
const firstRegionalQuery = legacyGlobalPlan.findIndex((entry) => entry.region !== null);
assert.ok(firstRegionalQuery > 0);
assert.ok(legacyGlobalPlan.slice(0, firstRegionalQuery).every((entry) => entry.region === null));
const emptyRegionDraftPlan = buildQueryPlan({ ...MANEKS_PROFILE, regions: [], globalQueries: false });
assert.ok(emptyRegionDraftPlan.length > 0);
assert.equal(emptyRegionDraftPlan[0]?.region, null);

const feastPlan = buildQueryPlan(FEAST_PROFILE, { limit: 500 });
assert.equal(feastPlan.length, 500);
assert.deepEqual(new Set(feastPlan.map((entry) => entry.segmentKey)), new Set(FEAST_PROFILE.segments.map((segment) => segment.key)));
assert.equal(new Set(feastPlan.map((entry) => entry.shape)).size, 10);
assert.ok(new Set(feastPlan.map((entry) => entry.region)).size >= 10);
assert.deepEqual(new Set(buildQueryPlan(FEAST_PROFILE).map((entry) => entry.region).filter((region): region is string => region !== null)), new Set(FEAST_PROFILE.regions));
assert.equal(new Set(feastPlan.slice(0, 50).map((entry) => entry.segmentKey)).size, 5);

const cosmicbrainSuppliersPlan = buildQueryPlan(COSMICBRAIN_SUPPLIERS_PROFILE);
const cosmicbrainChineseRegions = new Set([
  "China",
  "Shenzhen",
  "Shanghai",
  "Beijing",
  "Hangzhou",
  "Suzhou",
  "Dongguan",
]);
const cosmicbrainGermanRegions = new Set([
  "Germany",
  "Munich",
  "Stuttgart",
  "Switzerland",
  "Luxembourg",
]);
assert.ok(
  cosmicbrainSuppliersPlan.some((entry) => entry.region === "China" && /[\u4e00-\u9fff]/u.test(entry.query)),
  "CosmicBrain supplier China queries must include a Chinese keyword",
);
assert.ok(
  cosmicbrainSuppliersPlan.every((entry) =>
    entry.region === null
      || !/[\u4e00-\u9fff]/u.test(entry.query)
      || cosmicbrainChineseRegions.has(entry.region),
  ),
  "CosmicBrain supplier Chinese queries must stay within Chinese regions",
);
assert.ok(
  cosmicbrainSuppliersPlan.every((entry) =>
    entry.region === null
      || entry.locale !== "de"
      || cosmicbrainGermanRegions.has(entry.region),
  ),
  "CosmicBrain supplier German queries must stay within German regions",
);
assert.ok(
  cosmicbrainSuppliersPlan.some((entry) => entry.region === "China" && entry.locale === "zh"),
  "CosmicBrain supplier China must have zh queries",
);
assert.ok(
  cosmicbrainSuppliersPlan.some((entry) => entry.region === "Shenzhen" && entry.locale === "zh"),
  "CosmicBrain supplier Shenzhen must have zh queries",
);

const excludedCosta = scoreLead(FEAST_PROFILE, {
  companyName: "Costa Coffee Brighton",
  domain: "costa.co.uk",
  pageText: "coffee cake pastries brunch",
  segmentKey: "coffee_shop",
  emailCount: 1,
  hasPhone: true,
});
assert.equal(excludedCosta.tier, "reject");
assert.ok(excludedCosta.rejectionReason?.startsWith("excluded brand"));
const excludedStarbucks = scoreLead(FEAST_PROFILE, {
  companyName: "Starbucks",
  domain: "starbucks.co.uk",
  pageText: "coffee cake pastries brunch",
  segmentKey: "coffee_shop",
  emailCount: 1,
  hasPhone: true,
});
assert.equal(excludedStarbucks.tier, "reject");
assert.ok(excludedStarbucks.rejectionReason?.startsWith("excluded brand"));
for (const [companyName, domain] of [
  ["Black Sheep Coffee Brighton", "blacksheepcoffee.co.uk"],
  ["BTP Exeter", "bostonteaparty.co.uk"],
  ["Caffè Nero", "caffenero.com"],
  ["Caffè Nero", "example-cafe.co.uk"],
  ["Coffee #1 Bath", "coffee1.co.uk"],
] as const) {
  const result = scoreLead(FEAST_PROFILE, {
    companyName,
    domain,
    pageText: "coffee cake pastries brunch",
    segmentKey: "coffee_shop",
    emailCount: 1,
    hasPhone: true,
  });
  assert.equal(result.tier, "reject");
  assert.ok(result.rejectionReason?.startsWith("excluded brand"));
}
assert.notEqual(scoreLead(FEAST_PROFILE, {
  companyName: "Little Bird Cafe",
  domain: "littlebirdcafe.co.uk",
  pageText: "independent coffee shop, brunch, cakes and pastries, opposite Starbucks",
  segmentKey: "coffee_shop",
  emailCount: 1,
  hasPhone: true,
}).tier, "reject");
assert.notEqual(scoreLead(FEAST_PROFILE, {
  companyName: "Acosta Cafe",
  domain: "acostacafe.co.uk",
  pageText: "coffee shop cakes pastries brunch",
  segmentKey: "coffee_shop",
  emailCount: 1,
  hasPhone: true,
}).tier, "reject");

for (const profile of [OLYMPIAN_PROFILE, COSMICBRAIN_HOSPITALITY_PROFILE]) {
  const result = scoreLead(profile, {
    companyName: "Hilton Garden Inn Phoenix",
    domain: "hiltongardeninn.com",
    pageText: "hotel rooms suites guests hospitality",
    segmentKey: "independent_hotel",
    emailCount: 1,
    hasPhone: true,
  });
  assert.equal(result.tier, "reject");
  assert.ok(result.rejectionReason?.startsWith("excluded brand"));
}

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
assert.equal(resolveLeadGenProfile("olympian").slug, "olympian");
assert.equal(resolveLeadGenProfile("cosmicbrain-suppliers").slug, "cosmicbrain-suppliers");
assert.equal(resolveLeadGenProfile("cosmicbrain-hospitality").slug, "cosmicbrain-hospitality");
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

const multilingualDraft = {
  objective: "Find large primary steel producers",
  segments: ["Large primary steel producers"],
  regions: ["India", "Vietnam"],
  productFocus: "Raw materials, semi-finished steel, and basic iron and steel products supplied to Turkiye's iron and steel sector, including relevant slab, billet, bloom, pig iron, DRI or HBI, hot-rolled coil, plate, wire rod, rebar",
  projectName: "",
  listSlug: "india-vietnam-steel-producers",
  notes: "",
  rowTarget: 500,
};
const multilingualSignals = signalsFromProductFocus({
  productFocus: multilingualDraft.productFocus,
  segments: multilingualDraft.segments,
});
assert.ok(multilingualSignals.positive.includes("steel"));
assert.ok(multilingualSignals.positive.includes("billet"));
assert.ok(multilingualSignals.positive.includes("bloom"));
assert.equal(multilingualSignals.positive.includes("producers"), false);
assert.equal(
  multilingualSignals.negative.some((signal) => multilingualSignals.positive.includes(signal)),
  false,
);
const multilingualFit = scoreLead(profileFromProspectingDraft(multilingualDraft), {
  companyName: "Tata Steel Limited",
  domain: "tata.com",
  pageText: "Tata Steel Limited is an integrated steel producer of hot rolled coil, billet and slab",
  segmentKey: null,
  emailCount: 0,
  hasPhone: false,
});
assert.notEqual(multilingualFit.tier, "reject");
const nonIndustrialFit = scoreLead(profileFromProspectingDraft(multilingualDraft), {
  companyName: "Grand Palace Hotel",
  domain: "grandpalace.example",
  pageText: "Grand Palace Hotel offers rooms, a restaurant and a travel agency desk in Mumbai",
  segmentKey: null,
  emailCount: 0,
  hasPhone: false,
});
assert.equal(nonIndustrialFit.tier, "reject");
const nonMetalDraft = {
  ...multilingualDraft,
  objective: "Find corrugated packaging manufacturers",
  segments: ["Corrugated box manufacturers and exporters"],
  productFocus: "Corrugated packaging and folding cartons for food exporters",
  listSlug: "corrugated-packaging-manufacturers",
};
const nonMetalProfile = profileFromProspectingDraft(nonMetalDraft);
const nonMetalSteelFit = scoreLead(nonMetalProfile, {
  companyName: "Tata Steel Limited",
  domain: "tata.com",
  pageText: "Tata Steel Limited is an integrated steel producer of hot rolled coil, billet and slab",
  segmentKey: null,
  emailCount: 0,
  hasPhone: false,
});
assert.equal(nonMetalSteelFit.tier, "reject");
const packagingFit = scoreLead(nonMetalProfile, {
  companyName: "Anadolu Karton",
  domain: "anadolukarton.example",
  pageText: "Anadolu Karton is a corrugated packaging manufacturer producing folding cartons",
  segmentKey: null,
  emailCount: 0,
  hasPhone: false,
});
assert.notEqual(packagingFit.tier, "reject");
const nonMetalCoreProfile = profileFromProspectingDraft({
  ...nonMetalDraft,
  productFocus: "Corrugated packaging with honeycomb core board",
});
assert.equal(scoreLead(nonMetalCoreProfile, {
  companyName: "Tata Steel Limited",
  domain: "tata.com",
  pageText: "Tata Steel Limited is an integrated steel producer of hot rolled coil, billet and slab",
  segmentKey: null,
  emailCount: 0,
  hasPhone: false,
}).tier, "reject");
const nonMetalForestryProfile = profileFromProspectingDraft({
  ...nonMetalDraft,
  productFocus: "Corrugated packaging for forestry exporters",
});
assert.equal(scoreLead(nonMetalForestryProfile, {
  companyName: "Tata Steel Limited",
  domain: "tata.com",
  pageText: "Tata Steel Limited is an integrated steel producer of hot rolled coil, billet and slab",
  segmentKey: null,
  emailCount: 0,
  hasPhone: false,
}).tier, "reject");
for (const productFocus of [
  "Corrugated packaging for Oregon exporters",
  "Corrugated packaging for ironing equipment",
  "Corrugated packaging for acoustic panels",
]) {
  const profile = profileFromProspectingDraft({ ...nonMetalDraft, productFocus });
  assert.equal(scoreLead(profile, {
    companyName: "Tata Steel Limited",
    domain: "tata.com",
    pageText: "Tata Steel Limited is an integrated steel producer of hot rolled coil, billet and slab",
    segmentKey: null,
    emailCount: 0,
    hasPhone: false,
  }).tier, "reject");
}
for (const productFocus of [
  "Siderurgica production",
  "Ferroalloy materials",
]) {
  const fit = scoreLead(profileFromProspectingDraft({
    ...multilingualDraft,
    productFocus,
  }), {
    companyName: "Tata Steel Limited",
    domain: "tata.com",
    pageText: "Tata Steel Limited is an integrated steel producer of hot rolled coil, billet and slab",
    segmentKey: null,
    emailCount: 0,
    hasPhone: false,
  });
  assert.notEqual(fit.tier, "reject");
}
for (const productFocus of [
  "Ferromanganese smelters",
  "Steelmaking raw materials",
  "Ironworks suppliers",
]) {
  const fit = scoreLead(profileFromProspectingDraft({
    ...multilingualDraft,
    productFocus,
    segments: [],
  }), {
    companyName: "Tata Steel Limited",
    domain: "tata.com",
    pageText: "Tata Steel Limited is an integrated steel producer of hot rolled coil, billet and slab",
    segmentKey: null,
    emailCount: 0,
    hasPhone: false,
  });
  assert.notEqual(fit.tier, "reject");
}
assert.equal(scoreLead(nonMetalProfile, {
  companyName: "Aegean Textile Mills",
  domain: "aegean-textile.example",
  pageText: "Aegean Textile Mills is a garment manufacturer and supplier of apparel",
  segmentKey: null,
  emailCount: 0,
  hasPhone: false,
}).tier, "reject");

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

// Bouncer-backed mailbox verification (mocked transport)

const companyMx = async () => [{ exchange: "mail.ornekcelik.com.tr", priority: 10 }];
const bouncerPayload = (status: string, extra: Record<string, unknown> = {}) => ({
  email: "x",
  status,
  reason: status === "deliverable" ? "accepted_email" : status === "undeliverable" ? "rejected_email" : "low_deliverability",
  domain: { name: "ornekcelik.com.tr", acceptAll: "no", disposable: "no", free: "no" },
  account: { role: "yes", disabled: "no", fullMailbox: "no" },
  dns: { type: "MX", record: "mail.ornekcelik.com.tr." },
  provider: "ornekcelik.com.tr",
  score: status === "deliverable" ? 100 : 10,
  ...extra,
});
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const bouncerRequests: Array<{ url: string; headers: Record<string, string> }> = [];
const bouncerByEmail: Record<string, Response | (() => Response)> = {
  "satis@ornekcelik.com.tr": jsonResponse(bouncerPayload("deliverable")),
  "gone@ornekcelik.com.tr": jsonResponse(bouncerPayload("undeliverable")),
  "maybe@ornekcelik.com.tr": jsonResponse(bouncerPayload("risky", { domain: { name: "ornekcelik.com.tr", acceptAll: "yes", disposable: "no", free: "no" } })),
  "shrug@ornekcelik.com.tr": jsonResponse(bouncerPayload("unknown", { reason: "timeout", score: null })),
  "weird@ornekcelik.com.tr": jsonResponse({ nonsense: true }),
  "broke@ornekcelik.com.tr": jsonResponse({ error: "Payment required" }, 402),
};
const bouncer = createBouncerVerifier({
  apiKey: "test-key",
  now: () => new Date("2026-08-31T00:00:00.000Z"),
  fetchImpl: async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    bouncerRequests.push({ url, headers });
    const email = new URL(url).searchParams.get("email") ?? "";
    const stub = bouncerByEmail[email];
    if (!stub) throw new TypeError("fetch failed");
    return typeof stub === "function" ? stub() : stub.clone();
  },
});

const bouncerDeliverable = await verifyEmail("satis@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerDeliverable.verdict, "deliverable_likely");
assert.equal(bouncerDeliverable.provider?.provider, "bouncer");
assert.equal(bouncerDeliverable.provider?.status, "deliverable");
assert.equal(bouncerDeliverable.provider?.score, 100);
assert.equal(bouncerDeliverable.provider?.checkedAt, "2026-08-31T00:00:00.000Z");
assert.ok(bouncerDeliverable.confidence >= 90, "a provider-confirmed mailbox must carry high confidence");
assert.equal(bouncerDeliverable.mxHost, "mail.ornekcelik.com.tr", "heuristic MX evidence must survive the provider verdict");
assert.equal(bouncerRequests[0]!.headers["x-api-key"], "test-key");
assert.ok(!bouncerRequests[0]!.url.includes("test-key"), "the API key must travel in a header, not the URL");

const bouncerUndeliverable = await verifyEmail("gone@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerUndeliverable.verdict, "undeliverable", "a provider rejection must override a heuristic pass");
assert.ok(bouncerUndeliverable.confidence <= 10);

const bouncerRisky = await verifyEmail("maybe@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerRisky.verdict, "risky");
assert.equal(bouncerRisky.provider?.acceptAll, true);

const bouncerUnknown = await verifyEmail("shrug@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerUnknown.verdict, "deliverable_likely", "an unknown provider answer keeps the heuristic verdict");
assert.equal(bouncerUnknown.provider?.status, "unknown");
assert.ok(bouncerUnknown.reasons.some((reason) => reason.includes("unknown")));

const bouncerMalformed = await verifyEmail("weird@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerMalformed.verdict, "deliverable_likely", "a malformed payload falls back to the heuristic verdict");
assert.equal(bouncerMalformed.provider ?? null, null);
assert.ok(bouncerMalformed.reasons.some((reason) => reason.includes("unavailable")));

const bouncerNetwork = await verifyEmail("offline@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerNetwork.verdict, "deliverable_likely", "a transport failure falls back to the heuristic verdict");

const bouncerBroke = await verifyEmail("broke@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerBroke.verdict, "deliverable_likely");
assert.equal(bouncer.usage().exhausted, true, "HTTP 402 must flag exhausted credits");
const callsBeforeExhaustedRetry = bouncer.usage().calls;
await verifyEmail("another@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncer.usage().calls, callsBeforeExhaustedRetry, "no further provider calls once credits are exhausted");

assert.equal(bouncerRequests.filter((request) => request.url.includes("satis%40")).length, 1);
await verifyEmail("SATIS@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: bouncer });
assert.equal(bouncerRequests.filter((request) => request.url.includes("satis%40")).length, 1, "repeat lookups must be served from the memo");
assert.ok(bouncer.usage().cached >= 1);
assert.ok(bouncer.usage().failures >= 3);

assert.throws(() => parseBouncerResponse({ status: "maybe" }, new Date()), /payload/);
assert.equal(parseBouncerResponse({ status: "deliverable" }, new Date()).reason, "unknown");

const withoutProvider = await verifyEmail("satis@ornekcelik.com.tr", { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: null });
assert.equal(withoutProvider.provider ?? null, null, "verifier: null must skip the provider entirely");

let paidCalls = 0;
const countingVerifier: MailboxVerifier = {
  name: "counting",
  usage: () => ({ provider: "counting", calls: paidCalls, cached: 0, failures: 0, exhausted: false }),
  verify: async () => {
    paidCalls += 1;
    return { provider: "counting", status: "deliverable", reason: "accepted_email", score: 100, acceptAll: false, disposable: false, free: false, role: false, disabled: false, fullMailbox: false, checkedAt: "2026-08-31T00:00:00.000Z" };
  },
};
const manyEmails = Array.from({ length: 9 }, (_, index) => `person${index}@ornekcelik.com.tr`);
const capped = await verifyEmails(manyEmails, { companyDomain: "ornekcelik.com.tr", resolveMx: companyMx, verifier: countingVerifier, verifierLimit: 4 });
assert.equal(capped.length, 9);
assert.equal(paidCalls, 4, "paid verification must stop at the per-company limit");
assert.equal(capped.filter((item) => item.provider).length, 4);

// Hunter-backed decision-maker enrichment (mocked transport)

const hunterPerson = (value: string, extra: Record<string, unknown> = {}) => ({
  value,
  type: "personal",
  confidence: 90,
  sources: [{ domain: "ornekcelik.com.tr", uri: "http://ornekcelik.com.tr/ekibimiz", extracted_on: "2026-01-01", last_seen_on: "2026-08-01", still_on_page: true }],
  first_name: "Ayse",
  last_name: "Yilmaz",
  position: "Purchasing Manager",
  seniority: "senior",
  department: "management",
  decision_maker: true,
  linkedin: "https://www.linkedin.com/in/ayse-yilmaz",
  twitter: null,
  phone_number: null,
  verification: { date: "2026-08-01", status: "valid" },
  ...extra,
});
const hunterRequests: string[] = [];
const hunterByDomain: Record<string, () => Response> = {
  "ornekcelik.com.tr": () => jsonResponse({
    data: {
      domain: "ornekcelik.com.tr",
      emails: [
        hunterPerson("stajyer@ornekcelik.com.tr", { first_name: "Can", last_name: "Demir", position: "Intern", seniority: "junior", department: "support", decision_maker: false, confidence: 60 }),
        hunterPerson("ayse.yilmaz@ornekcelik.com.tr"),
        hunterPerson("AYSE.YILMAZ@ornekcelik.com.tr", { confidence: 40 }),
        hunterPerson("info@ornekcelik.com.tr", { type: "generic", first_name: null, last_name: null }),
        hunterPerson("mehmet.kaya@ornekcelik.com.tr", { first_name: "Mehmet", last_name: "Kaya", position: "CEO", seniority: "executive", department: "executive", confidence: 95 }),
      ],
    },
    meta: { results: 5, limit: 10, offset: 0, params: { domain: "ornekcelik.com.tr" } },
  }),
  "empty.example": () => jsonResponse({ data: { domain: "empty.example", emails: [] }, meta: { results: 0 } }),
  "broken.example": () => jsonResponse({ data: { surprise: 1 } }),
  "limited.example": () => jsonResponse({ errors: [{ id: "too_many_requests", code: 429, details: "Too many requests" }] }, 429),
};
const hunter = createHunterEnricher({
  apiKey: "hunter-test-key",
  now: () => new Date("2026-08-31T00:00:00.000Z"),
  fetchImpl: async (url, init) => {
    hunterRequests.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    assert.equal(headers["X-API-KEY"], "hunter-test-key");
    assert.ok(!url.includes("hunter-test-key"), "the Hunter key must travel in a header, not the URL");
    const domain = new URL(url).searchParams.get("domain") ?? "";
    const stub = hunterByDomain[domain];
    if (!stub) throw new TypeError("fetch failed");
    return stub();
  },
});

const enriched = await hunter.enrichDomain("ornekcelik.com.tr");
assert.equal(enriched.length, 4, "generic inboxes are dropped and case-duplicate emails are kept for ranking");
const ranked = rankEnrichedContacts(enriched);
assert.deepEqual(ranked.map((contact) => contact.email), [
  "mehmet.kaya@ornekcelik.com.tr",
  "ayse.yilmaz@ornekcelik.com.tr",
  "stajyer@ornekcelik.com.tr",
], "ranking must dedupe by email, prefer executives and decision makers, and cap the list");
assert.equal(ranked[1]!.fullName, "Ayse Yilmaz");
assert.equal(ranked[1]!.position, "Purchasing Manager");
assert.equal(ranked[1]!.confidence, 90, "duplicates must keep the higher-confidence record");
assert.deepEqual(ranked[1]!.sourceUrls, ["http://ornekcelik.com.tr/ekibimiz"]);
assert.equal(ranked[1]!.enrichedAt, "2026-08-31T00:00:00.000Z");
assert.equal(hunter.usage().billable, 1);

assert.deepEqual(await hunter.enrichDomain("empty.example"), [], "no results is a normal empty answer");
await assert.rejects(hunter.enrichDomain("broken.example"), /payload/);
await assert.rejects(hunter.enrichDomain("offline.example"), /network/);
await assert.rejects(hunter.enrichDomain("limited.example"), /quota/);
assert.equal(hunter.usage().exhausted, true, "HTTP 429 must flag the plan as exhausted");
const hunterCallsAtExhaustion = hunter.usage().calls;
await assert.rejects(hunter.enrichDomain("ornekcelik.example"), /quota/);
assert.equal(hunter.usage().calls, hunterCallsAtExhaustion, "no further Hunter calls once exhausted");
assert.equal(hunterRequests.filter((url) => url.includes("domain=ornekcelik.com.tr")).length, 1);
await hunter.enrichDomain("ornekcelik.com.tr");
assert.equal(hunterRequests.filter((url) => url.includes("domain=ornekcelik.com.tr")).length, 1, "repeat domains must be served from the memo");
assert.equal(hunter.usage().failures, 3, "payload, network and 429 count; the post-exhaustion short-circuit does not");
assert.throws(() => parseHunterDomainSearch({ data: {} }, new Date()), /payload/);

const namedContact: EnrichedContact = ranked[1]!;
const primaryWithNamed = selectPrimaryContact({
  contacts: ranked,
  emails: ["mehmet.kaya@ornekcelik.com.tr", "ayse.yilmaz@ornekcelik.com.tr", "info@ornekcelik.com.tr"],
  verifications: [
    { ...bouncerUndeliverable, email: "mehmet.kaya@ornekcelik.com.tr" },
    { ...bouncerDeliverable, email: "ayse.yilmaz@ornekcelik.com.tr" },
    { ...withoutProvider, email: "info@ornekcelik.com.tr" },
  ],
});
assert.equal(primaryWithNamed.email, namedContact.email, "an undeliverable top contact must yield to the next named person");
assert.equal(primaryWithNamed.name, "Ayse Yilmaz");
assert.equal(primaryWithNamed.title, "Purchasing Manager");
assert.equal(primaryWithNamed.verification?.verdict, "deliverable_likely");
const primaryFallback = selectPrimaryContact({
  contacts: [],
  emails: ["info@ornekcelik.com.tr"],
  verifications: [{ ...withoutProvider, email: "info@ornekcelik.com.tr" }],
});
assert.equal(primaryFallback.email, "info@ornekcelik.com.tr", "without enrichment the public inbox stays the contact");
assert.equal(primaryFallback.name, null);
const primaryAllRejected = selectPrimaryContact({
  contacts: [{ ...namedContact, email: "gone@ornekcelik.com.tr" }],
  emails: ["gone@ornekcelik.com.tr", "dead@ornekcelik.com.tr"],
  verifications: [
    { ...bouncerUndeliverable, email: "gone@ornekcelik.com.tr" },
    { ...bouncerUndeliverable, email: "dead@ornekcelik.com.tr" },
  ],
});
assert.equal(primaryAllRejected.email, null, "a row must never advertise an address known to bounce");
assert.equal(primaryAllRejected.name, null);
assert.equal(primaryAllRejected.verification?.verdict, "undeliverable", "the row still says why it has no email");

// Env-selected providers are built per call, so exhaustion in one batch never
// silences the next one.
process.env.BOUNCER_API_KEY = "test-only";
process.env.HUNTER_API_KEY = "test-only";
assert.notStrictEqual(mailboxVerifierFromEnv(), mailboxVerifierFromEnv(), "each batch gets its own verifier state");
assert.notStrictEqual(contactEnricherFromEnv(), contactEnricherFromEnv(), "each batch gets its own enricher state");
delete process.env.BOUNCER_API_KEY;
delete process.env.HUNTER_API_KEY;
assert.equal(mailboxVerifierFromEnv(), null);
assert.equal(contactEnricherFromEnv(), null);

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

// Enrichment inside a prospecting batch: named people join the candidate, a
// provider failure leaves the public harvest intact, usage lands in stats.
const enrichedDomains: string[] = [];
const batchEnricher = {
  name: "hunter",
  usage: () => ({ provider: "hunter", calls: enrichedDomains.length, billable: 1, contacts: 1, failures: 0, exhausted: false }),
  enrichDomain: async (domain: string) => {
    enrichedDomains.push(domain);
    if (domain !== "ornekcelik.com.tr") throw new Error("boom");
    return [namedContact];
  },
};
const enrichedBatch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 4,
  budgetMs: 10_000,
  search: async () => [
    { url: "https://www.ornekcelik.com.tr", domain: "ornekcelik.com.tr", engine: "brave", rank: 1 },
    { url: "https://table-homepage.example", domain: "table-homepage.example", engine: "brave", rank: 2 },
  ],
  fetchPage: async (url) => pages[url.replace("https://ornekcelik", "https://www.ornekcelik")] ?? (url.includes("table-homepage.example")
    ? { url, status: 200, contentType: "text/html", body: "<title>Table Steel</title><p>celik konstruksiyon imalat fabrika sac profil uretim</p><p>info@table-homepage.example</p>", isPdf: false }
    : null),
  resolveMx: companyMx,
  enricher: batchEnricher,
  verifier: countingVerifier,
});
assert.deepEqual(enrichedDomains, ["ornekcelik.com.tr", "table-homepage.example"], "every fit-qualified company is enriched once");
const enrichedCandidate = enrichedBatch.candidates.find((item) => item.candidate.domain === "ornekcelik.com.tr")!;
assert.equal(enrichedCandidate.candidate.emails[0], namedContact.email, "the named contact leads the candidate's emails");
assert.ok(enrichedCandidate.candidate.emails.includes("ihracat@ornekcelik.com.tr"), "public emails are kept behind the named contact");
assert.deepEqual(enrichedCandidate.candidate.contacts?.map((contact) => contact.email), [namedContact.email]);
assert.ok(enrichedCandidate.verifications.some((item) => item.email === namedContact.email && item.provider?.provider === "counting"));
const unenrichedCandidate = enrichedBatch.candidates.find((item) => item.candidate.domain === "table-homepage.example")!;
assert.equal(unenrichedCandidate.candidate.contacts, undefined, "a provider failure must not drop the company");
assert.deepEqual(unenrichedCandidate.candidate.emails, ["info@table-homepage.example"]);
assert.equal(enrichedBatch.stats.usage?.enrichment?.companiesEnriched, 2);
assert.equal(enrichedBatch.stats.usage?.enrichment?.companiesWithContacts, 1);
assert.equal(enrichedBatch.stats.usage?.enrichment?.skippedByCap, 0);
assert.equal(enrichedBatch.stats.usage?.verification?.provider, "counting");

const cappedBatch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 4,
  budgetMs: 10_000,
  search: async () => [{ url: "https://www.ornekcelik.com.tr", domain: "ornekcelik.com.tr", engine: "brave", rank: 1 }],
  fetchPage: async (url) => pages[url.replace("https://ornekcelik", "https://www.ornekcelik")] ?? null,
  resolveMx: companyMx,
  enricher: batchEnricher,
  verifier: null,
  maxEnrichments: 0,
});
assert.equal(cappedBatch.stats.usage?.enrichment?.skippedByCap, 1, "the per-batch enrichment cap must be honoured");
assert.equal(cappedBatch.stats.usage?.verification, undefined);

// Directory rows with a domain are enriched like harvested sites; rows without
// a domain stay on the deterministic path and spend nothing.
const directoryEnriched: string[] = [];
const directoryBatch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 4,
  budgetMs: 10_000,
  search: async () => [{ url: "https://chamber.example/members.pdf", domain: "chamber.example", engine: "brave", rank: 1 }],
  fetchPage: async (url) => (url === "https://chamber.example/members.pdf"
    ? {
      ...directoryPdf,
      body: [
        "Chamber Member Directory",
        "ALPHA STEEL GmbH celik konstruksiyon sac profil imalat | info@alpha-steel.de | https://alpha-steel.de | Berlin",
        "NAMELESS METAL celik konstruksiyon sac profil imalat | sales@nameless-metal.example | Berlin",
      ].join("\n"),
    }
    : null),
  resolveMx: companyMx,
  enricher: {
    name: "hunter",
    usage: () => ({ provider: "hunter", calls: directoryEnriched.length, billable: 1, contacts: 1, failures: 0, exhausted: false }),
    enrichDomain: async (domain: string) => {
      directoryEnriched.push(domain);
      return [{ ...namedContact, email: "ayse.yilmaz@alpha-steel.de" }];
    },
  },
  verifier: null,
});
const alphaRow = directoryBatch.candidates.find((item) => item.candidate.domain === "alpha-steel.de");
assert.ok(alphaRow?.directoryRow, "the directory document must expand into a directory candidate");
assert.ok(directoryEnriched.includes("alpha-steel.de"), "a fit-qualified directory company with a domain is enriched");
assert.equal(alphaRow?.candidate.emails[0], "ayse.yilmaz@alpha-steel.de", "the named contact leads the directory candidate's emails");
assert.ok(alphaRow?.candidate.emails.includes("info@alpha-steel.de"), "the directory inbox is kept behind the named contact");
assert.ok(alphaRow?.verifications.some((item) => item.email === "ayse.yilmaz@alpha-steel.de"), "enriched directory emails go through verification");
assert.deepEqual(alphaRow?.directoryRow?.emails, ["info@alpha-steel.de"], "the parsed directory row itself stays untouched");
assert.ok(!directoryEnriched.some((domain) => !domain), "rows without a domain must not spend an enrichment call");

// A company listed by several directory documents spends one enrichment slot
// and one provider call; the cap is measured in unique domains.
const repeatedEnriched: string[] = [];
const repeatedDirectories: Record<string, string[]> = {
  "https://chamber-a.example/members.pdf": [
    "ALPHA STEEL GmbH celik konstruksiyon sac profil imalat | info@alpha-steel.de | https://alpha-steel.de | Berlin",
    "BETA STAHL GmbH celik konstruksiyon sac profil imalat | info@beta-stahl.de | https://beta-stahl.de | Berlin",
  ],
  "https://chamber-b.example/members.pdf": [
    "ALPHA STEEL Werk 2 celik konstruksiyon sac profil imalat | werk2@alpha-steel.de | https://www.alpha-steel.de | Berlin",
    "BETA STAHL Vertrieb celik konstruksiyon sac profil imalat | vertrieb@beta-stahl.de | https://www.beta-stahl.de | Berlin",
  ],
};
const repeatedBatch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 4,
  maxEnrichments: 1,
  budgetMs: 10_000,
  search: async () => Object.keys(repeatedDirectories).map((url, index) => ({
    url,
    domain: new URL(url).hostname,
    engine: "brave",
    rank: index + 1,
  })),
  fetchPage: async (url) => (repeatedDirectories[url]
    ? { ...directoryPdf, url, body: ["Chamber Member Directory", ...repeatedDirectories[url]].join("\n") }
    : null),
  resolveMx: companyMx,
  enricher: {
    name: "hunter",
    usage: () => ({ provider: "hunter", calls: repeatedEnriched.length, billable: repeatedEnriched.length, contacts: 1, failures: 0, exhausted: false }),
    enrichDomain: async (domain: string) => {
      repeatedEnriched.push(domain);
      return [{ ...namedContact, email: `ayse.yilmaz@${domain}` }];
    },
  },
  verifier: null,
});
const alphaRows = repeatedBatch.candidates.filter((item) => item.candidate.domain === "alpha-steel.de");
assert.ok(alphaRows.length >= 2, "the repeated domain must expand into several directory candidates");
assert.deepEqual(repeatedEnriched, ["alpha-steel.de"], "a repeated domain must be enriched once and never spend a second slot");
assert.ok(
  alphaRows.every((item) => item.candidate.emails[0] === "ayse.yilmaz@alpha-steel.de"),
  "every candidate of the repeated domain receives the shared enrichment result",
);
assert.equal(repeatedBatch.stats.usage?.enrichment?.companiesEnriched, 1);
assert.equal(repeatedBatch.stats.usage?.enrichment?.companiesWithContacts, 1);
assert.equal(
  repeatedBatch.candidates.filter((item) => item.candidate.domain === "beta-stahl.de").length,
  2,
  "the capped domain is also listed twice",
);
assert.equal(repeatedBatch.stats.usage?.enrichment?.skippedByCap, 1, "a unique domain that missed the cap counts as skipped once");
const offBatch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 4,
  budgetMs: 10_000,
  search: async () => [{ url: "https://www.ornekcelik.com.tr", domain: "ornekcelik.com.tr", engine: "brave", rank: 1 }],
  fetchPage: async (url) => pages[url.replace("https://ornekcelik", "https://www.ornekcelik")] ?? null,
  resolveMx: companyMx,
});
assert.equal(offBatch.stats.usage, undefined, "without keys or injected providers no usage block is reported");

// Persistence keeps the enriched identity and both providers' evidence on the contact.
const createdContacts: Array<Record<string, unknown>> = [];
const fakeClient = {
  company: {
    findUnique: async () => null,
    create: async () => ({ id: "company-persist" }),
    update: async () => ({ id: "company-persist" }),
  },
  contact: {
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createdContacts.push(data);
      return { id: `contact-${createdContacts.length}` };
    },
    update: async () => ({ id: "unused" }),
  },
  leadDiscovery: { create: async ({ data }: { data: Record<string, unknown> }) => data },
} as unknown as Parameters<typeof persistLeads>[1]["client"];
const persistedAt = new Date("2026-09-04T12:00:00Z");
const persistResult = await persistLeads([{
  candidate: enrichedCandidate.candidate,
  verifications: [
    {
      email: namedContact.email,
      verdict: "deliverable_likely",
      confidence: 95,
      isRole: false,
      hasMx: true,
      mxHost: "mx.ornekcelik.com.tr",
      isFreeProvider: false,
      domainMatchesCompany: true,
      reasons: ["bouncer: deliverable"],
      provider: {
        provider: "bouncer",
        status: "deliverable",
        reason: "accepted_email",
        score: 100,
        acceptAll: false,
        disposable: false,
        free: false,
        role: false,
        disabled: false,
        fullMailbox: false,
        checkedAt: "2026-09-04T11:59:00.000Z",
      },
    },
    {
      email: "ihracat@ornekcelik.com.tr",
      verdict: "deliverable_likely",
      confidence: 60,
      isRole: true,
      hasMx: true,
      mxHost: "mx.ornekcelik.com.tr",
      isFreeProvider: false,
      domainMatchesCompany: true,
      reasons: [],
    },
  ],
}], { client: fakeClient, officeId: "office-persist", campaignTag: "persist-test", now: persistedAt });
assert.equal(persistResult.companiesCreated, 1);
assert.equal(persistResult.contactsCreated, 2);
const namedRow = createdContacts.find((row) => row.email === namedContact.email)!;
assert.equal(namedRow.fullName, namedContact.fullName, "the enriched person name is persisted");
assert.equal(namedRow.title, namedContact.position, "the enriched title is persisted");
assert.equal(namedRow.phone, namedContact.phone ?? enrichedCandidate.candidate.phones[0] ?? null);
const namedRefs = namedRow.sourceRefs as Record<string, unknown>;
assert.equal(namedRefs.mailboxProvider, "bouncer");
assert.equal(namedRefs.mailboxStatus, "deliverable");
assert.equal(namedRefs.mailboxReason, "accepted_email");
assert.equal(namedRefs.mailboxScore, 100);
assert.equal(namedRefs.mailboxCheckedAt, "2026-09-04T11:59:00.000Z");
assert.equal(namedRefs.enrichmentProvider, namedContact.provider);
assert.equal(namedRefs.enrichmentConfidence, namedContact.confidence);
assert.equal(namedRefs.enrichmentDecisionMaker, namedContact.decisionMaker);
assert.deepEqual(namedRefs.enrichmentSourceUrls, namedContact.sourceUrls);
assert.equal(namedRefs.enrichedAt, namedContact.enrichedAt);
assert.equal(namedRefs.verifiedAt, persistedAt.toISOString());
const publicRow = createdContacts.find((row) => row.email === "ihracat@ornekcelik.com.tr")!;
assert.equal(publicRow.title, "Company inbox", "a harvested role inbox keeps the generic title");
const publicRefs = publicRow.sourceRefs as Record<string, unknown>;
assert.equal(publicRefs.mailboxProvider, undefined, "no provider evidence is invented for a heuristic-only address");
assert.equal(publicRefs.enrichmentProvider, undefined);

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

const feastDirectoryBatch = await runProspectingBatch({
  profile: FEAST_PROFILE,
  maxQueries: 1,
  maxPages: 1,
  budgetMs: 10_000,
  search: async () => [
    { url: "https://chamber.example/cafes.pdf", domain: "chamber.example", engine: "brave", rank: 1 },
  ],
  fetchPage: async (url) => ({
    url,
    status: 200,
    contentType: "application/pdf",
    body: "Costa Coffee Brighton hello@costa.co.uk\nHarbour Lane Cafe Brighton hello@harbourlanecafe.co.uk\n",
    isPdf: true,
  }),
  resolveMx: async () => [],
});
assert.equal(feastDirectoryBatch.candidates.length, 1);
assert.ok(!feastDirectoryBatch.candidates[0]!.candidate.companyName.includes("Costa"));
assert.equal(feastDirectoryBatch.stats.candidatesFound, 1);

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
