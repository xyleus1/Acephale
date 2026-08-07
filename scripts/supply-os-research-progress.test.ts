import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildOfficialSiteResearch,
  companyNameHint,
  discoverOfficialWebsite,
  extractWebsiteFromQuery,
  officialSiteIdentityScore,
  officialWebsiteCandidates,
  selectCompanyResearchStrategy,
} from "../src/lib/supply-os-company-research";

const root = process.cwd();
const researchClientSource = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-research-client.ts"), "utf8");
const generatorSource = readFileSync(join(root, "src/app/dashboard/supply-os/supply-os-generator.tsx"), "utf8");
assert.match(researchClientSource, /RESEARCH_REQUEST_TIMEOUT_MS = 12_000/, "the browser must stop waiting before a hosted stream can strand the generator");
assert.match(generatorSource, /setState\("fallback"\)[\s\S]*buildWithoutResearch\(\)/, "research cutoff must continue into a usable draft instead of a dead error state");

assert.equal(
  extractWebsiteFromQuery("Research Atlas Robotics at atlasrobotics.com before building the dashboard"),
  "https://atlasrobotics.com/",
);
assert.equal(
  extractWebsiteFromQuery("Website: https://www.example.com/products. Company builds hardware."),
  "https://www.example.com/products",
);
assert.equal(extractWebsiteFromQuery("Atlas Robotics in Austin, Texas"), null);
assert.deepEqual(
  selectCompanyResearchStrategy("AON3D website: https://www.aon3d.com", true),
  { kind: "official_site", website: "https://www.aon3d.com/" },
  "an explicit website must bypass the slower public-search provider",
);
assert.deepEqual(selectCompanyResearchStrategy("AON3D", true), { kind: "name_discovery", publicSearchConfigured: true });
assert.deepEqual(selectCompanyResearchStrategy("AON3D", false), { kind: "name_discovery", publicSearchConfigured: false });
assert.equal(companyNameHint("do nox metals"), "Nox Metals");
assert.equal(companyNameHint("Atlas Robotics in Austin, Texas"), "Atlas Robotics");
assert.ok(officialWebsiteCandidates("do nox metals").includes("https://noxmetals.co/"));

const noxHomepage = `
  <html>
    <head>
      <title>NOX METALS | Aluminum Plate Cut to Size</title>
      <meta property="og:site_name" content="NOX METALS">
      <meta property="og:description" content="Nox Metals cuts aluminum plate to size from Detroit, MI.">
      <script type="application/ld+json">
        {"@type":"Organization","name":"NOX METALS","url":"https://noxmetals.co/"}
      </script>
    </head>
  </html>
`;
assert.ok(
  officialSiteIdentityScore("do nox metals", { url: "https://noxmetals.co/", html: noxHomepage }) > 0,
  "the official Nox identity must match the terse customer input",
);
assert.equal(
  officialSiteIdentityScore("do nox metals", { url: "https://noxmetals.com/", html: "<title>This domain is for sale</title>" }),
  0,
  "parked domains must never be accepted as the official company site",
);
const noxResearch = buildOfficialSiteResearch({
  query: "do nox metals",
  website: "https://noxmetals.co/",
  documents: [{ url: "https://noxmetals.co/", html: noxHomepage }],
  researchedAt: "2026-08-07T12:00:00.000Z",
});
assert.equal(noxResearch.company.industry.value, "Metals processing and distribution");
assert.ok(noxResearch.company.likelyInputs.some((item) => item.value === "mill-sourced aluminum plate / block"));
assert.equal(noxResearch.company.likelyInputs.some((item) => item.value === "precision machined parts"), false);

const homepage = `
  <html>
    <head>
      <title>Atlas Robotics | Warehouse Automation</title>
      <meta property="og:site_name" content="Atlas Robotics">
      <meta property="og:description" content="Atlas Robotics builds autonomous warehouse robots for industrial manufacturers.">
      <link rel="icon" href="/favicon.svg">
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "name": "Atlas Robotics",
              "url": "https://atlasrobotics.com/",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Austin",
                "addressRegion": "Texas",
                "addressCountry": "United States"
              }
            },
            { "@type": "Product", "name": "Atlas PickCell" }
          ]
        }
      </script>
    </head>
    <body><h1>Autonomous warehouse robots</h1></body>
  </html>
`;

const research = buildOfficialSiteResearch({
  query: "Atlas Robotics, atlasrobotics.com",
  website: "https://atlasrobotics.com/",
  documents: [
    { url: "https://atlasrobotics.com/", html: homepage },
    {
      url: "https://atlasrobotics.com/products/pickcell",
      html: "<title>Atlas Robotics PickCell | Warehouse picking</title><h1>Pick more orders</h1><h2>Trusted by 300 customers</h2>",
    },
  ],
  researchedAt: "2026-08-07T12:00:00.000Z",
});

assert.equal(research.status, "partial");
assert.equal(research.company.name.value, "Atlas Robotics");
assert.equal(research.company.description.basis, "official");
assert.equal(research.company.locations[0]?.value, "Austin, Texas, United States");
assert.equal(research.company.products[0]?.value, "Atlas PickCell");
assert.ok(research.company.products.some((item) => item.value === "PickCell"));
assert.equal(research.company.products.some((item) => item.value.includes("Trusted by")), false);
assert.equal(research.company.likelyInputs[0]?.basis, "inferred");
assert.ok(research.company.likelyInputs.some((item) => item.value === "motors and actuators"));
assert.equal(research.evidence[0]?.sourceType, "official_website");
assert.ok(research.warnings.some((warning) => warning.includes("official company website only")));

const promptLocationResearch = buildOfficialSiteResearch({
  query: "AON3D builds industrial printers in Montreal and serves customers globally. Website: aon3d.com",
  website: "https://aon3d.com/",
  documents: [{
    url: "https://aon3d.com/",
    html: '<title>AON3D | Industrial 3D Printing</title><meta property="og:site_name" content="AON3D"><meta property="og:description" content="Industrial additive manufacturing systems">',
  }],
  researchedAt: "2026-08-07T12:00:00.000Z",
});
assert.equal(promptLocationResearch.company.locations[0]?.value, "Montreal");
assert.equal(promptLocationResearch.company.locations[0]?.basis, "inferred");
assert.equal(promptLocationResearch.company.locations[0]?.role, "unknown");

async function main() {
  const progressEvents: string[] = [];
  const discovered = await discoverOfficialWebsite(
    "do nox metals",
    (event) => progressEvents.push(`${event.status}:${event.label}`),
    async (url) => {
      if (url === "https://noxmetals.co/") return { url, html: noxHomepage };
      if (url === "https://noxmetals.com/") {
        return {
          url,
          html: "<title>Nox Metals | Custom Metal Fabrication</title><p>Nox Metals is a welding shop in Montana.</p><p>Copyright 2012</p>",
        };
      }
      throw new Error("candidate not found");
    },
  );
  assert.equal(discovered, "https://noxmetals.co/");
  assert.deepEqual(progressEvents, [
    "active:Finding the official website",
    "complete:Official website found",
  ]);

  console.log("supply OS research progress checks passed");
}

void main();
