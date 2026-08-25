import assert from "node:assert/strict";
import { buildQueryPlan } from "../src/lib/leadgen/query-plan";
import { MANEKS_PROFILE } from "../src/lib/leadgen/profile";
import { dedupeByDomain, parseSearchResults } from "../src/lib/leadgen/search";
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
import { checkPublicUrl, guardedRequest, isPrivateAddress } from "../src/lib/leadgen/fetch-guard";
import { createServer } from "node:http";

// Query plan

const plan = buildQueryPlan(MANEKS_PROFILE, { limit: 50 });
assert.equal(plan.length, 50, "the plan must respect the limit");
assert.equal(new Set(plan.map((entry) => entry.query)).size, 50, "queries must be unique");
assert.ok(plan.some((entry) => entry.shape === "pdf_directory"), "pdf directories must be part of the sweep");

const scoped = buildQueryPlan(MANEKS_PROFILE, { segmentKeys: ["fabricator"], maxRegionsPerSegment: 2 });
assert.ok(scoped.every((entry) => entry.segmentKey === "fabricator"), "segment filter must hold");
assert.ok(
  scoped.every((entry) => entry.region === null || ["Istanbul", "Kocaeli"].includes(entry.region)),
  "region cap must hold",
);

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
assert.deepEqual(extractPhones(companyText), ["+90 224 456 78 90"]);
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
