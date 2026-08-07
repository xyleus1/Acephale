import assert from "node:assert/strict";
import {
  buildOfficialSiteResearch,
  extractWebsiteFromQuery,
  researchCompany,
  selectCompanyResearchStrategy,
  SupplyCompanyResearchError,
} from "../src/lib/supply-os-company-research";

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
assert.deepEqual(selectCompanyResearchStrategy("AON3D", true), { kind: "public_search" });
assert.deepEqual(selectCompanyResearchStrategy("AON3D", false), { kind: "unavailable" });

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
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      () => researchCompany("Atlas Robotics in Austin"),
      (error: unknown) => error instanceof SupplyCompanyResearchError
        && error.code === "research_unavailable"
        && error.message.includes("Add the company website"),
    );
  } finally {
    if (previousKey) process.env.OPENAI_API_KEY = previousKey;
  }

  console.log("supply OS research progress checks passed");
}

void main();
