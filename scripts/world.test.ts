import { Readable } from "node:stream";
import { buildCompanyPromotion } from "../src/lib/world/promote";
import { readCsvRows } from "../src/lib/world/csv";
import { classifyManufacturer } from "../src/lib/world/manufacturing";
import { normalizeCompanyName, normalizeCountry, normalizeDomain } from "../src/lib/world/normalize";
import { parseCompaniesHouseRow } from "../src/lib/world/sources/companies-house";
import { extractGleifLatestCsvUrl, parseGleifRow } from "../src/lib/world/sources/gleif";
import { parsePdlFreeRow } from "../src/lib/world/sources/pdl-free";

let failures = 0;
function check(name: string, ok: unknown) {
  if (ok) console.log(`ok ${name}`);
  else {
    failures += 1;
    console.error(`not ok ${name}`);
  }
}

async function csvTests() {
  const stream = Readable.from(["\uFEFFname,description\r\nAcme,\"line one\nline two\"\r\n\"B, Ltd\",\"quoted \"\"value\"\"\"\r\n"]);
  const rows = [];
  for await (const row of readCsvRows(stream)) rows.push(row);
  check("CSV parses BOM and trimmed headers", rows[0]?.name === "Acme");
  check("CSV preserves embedded newlines", rows[0]?.description === "line one\nline two");
  check("CSV parses escaped quotes and commas", rows[1]?.name === "B, Ltd" && rows[1]?.description === 'quoted "value"');
}

async function main() {
  await csvTests();
  check("company names remove legal suffixes", normalizeCompanyName("Acme Makina San. ve Tic. Ltd. Şti.") === "acme makina");
  check("product words remain distinct", normalizeCompanyName("Acme Metal Ltd") !== normalizeCompanyName("Acme Steel Ltd"));
  check("all-legal names retain fallback normalization", normalizeCompanyName("Ltd Ltd") === "ltd ltd");
  check("equivalent limited suffixes normalize equally", normalizeCompanyName("ACME Ltd") === normalizeCompanyName("Acme Limited"));
  check("domains normalize to registrable domain", normalizeDomain("https://www.example.co.uk/path") === "example.co.uk");
  check("invalid domains return null", normalizeDomain("not a domain") === null);
  check("countries normalize names and aliases", normalizeCountry("Germany") === "DE"
    && normalizeCountry("united states of america") === "US"
    && normalizeCountry("Viet Nam") === "VN"
    && normalizeCountry("DEU") === "DE"
    && normalizeCountry("Côte d'Ivoire") === "CI");
  check("UK SIC manufacturing", classifyManufacturer({ ukSic: ["25620"] }).isManufacturer);
  check("UK SIC non-manufacturing", !classifyManufacturer({ ukSic: ["62012"] }).isManufacturer);
  check("NAICS manufacturing", classifyManufacturer({ naics: ["332710"] }).isManufacturer);
  check("industry label manufacturing", classifyManufacturer({ industryLabels: ["machinery"] }).isManufacturer);
  check("industry label non-manufacturing", !classifyManufacturer({ industryLabels: ["banking"] }).isManufacturer);

  const gleif = parseGleifRow({
    LEI: "549300TESTLEI",
    "Entity.LegalName": "Acme GmbH",
    "Entity.LegalAddress.FirstAddressLine": "Main Street 1",
    "Entity.LegalAddress.City": "Berlin",
    "Entity.LegalAddress.Region": "BE",
    "Entity.LegalAddress.Country": "DE",
    "Entity.LegalAddress.PostalCode": "10115",
    "Entity.EntityStatus": "ACTIVE",
    "Registration.RegistrationStatus": "ISSUED",
  });
  check("GLEIF parser maps active row", Boolean(gleif?.lei === "549300TESTLEI" && gleif.country === "DE"));
  check("GLEIF parser skips missing LEI", parseGleifRow({ "Entity.LegalName": "Missing" }) === null);

  const companiesHouse = parseCompaniesHouseRow({
    CompanyName: "Acme Manufacturing Ltd",
    CompanyNumber: "01234567",
    "RegAddress.AddressLine1": "Factory Road",
    "RegAddress.PostTown": "Leeds",
    "RegAddress.County": "West Yorkshire",
    "RegAddress.PostCode": "LS1 1AA",
    "CompanyStatus": "Active",
    IncorporationDate: "01/02/2001",
    "SICCode.SicText_1": "25620 - Machining",
    URI: "https://find-and-update.company-information.service.gov.uk/company/01234567",
  });
  check("Companies House parser maps SIC and year", Boolean(companiesHouse?.isManufacturer && companiesHouse.foundedYear === 2001));
  check("Companies House parser skips missing number", parseCompaniesHouseRow({ CompanyName: "Missing" }) === null);

  const pdl = parsePdlFreeRow({
    id: "pdl-1",
    name: "Acme Manufacturing",
    website: "https://www.acme.example.com",
    founded: "1999",
    size: "51-200",
    locality: "Leeds",
    region: "Yorkshire",
    country: "United Kingdom",
    industry: "machinery",
    linkedin_url: "https://linkedin.com/company/acme",
  });
  check("PDL parser maps domain and label", Boolean(pdl?.domain === "example.com" && pdl.isManufacturer));
  check("PDL parser skips missing id", parsePdlFreeRow({ name: "Missing" }) === null);
  const pdlJson = parsePdlFreeRow({
    id: "pdl-json-1",
    name: "Numeric Founded Company",
    founded: 1998,
    website: null,
  });
  check("PDL parser accepts JSON values", pdlJson?.foundedYear === 1998 && pdlJson.website === null);

  check("GLEIF latest URL extraction", extractGleifLatestCsvUrl({
    data: [{ full_file: { csv: { url: "https://example.test/lei.csv.zip" } } }],
  }) === "https://example.test/lei.csv.zip");
  const promotion = buildCompanyPromotion({
    id: "world-1",
    canonicalName: "Acme",
    nameNormalized: "acme",
    domain: "acme.test",
    lei: null,
    country: "GB",
    region: null,
    city: null,
    postalCode: null,
    addressLine: null,
    legalIds: { lei: "x", pdl_id: "y" },
    industryCodes: null,
    isManufacturer: true,
    manufacturerEvidence: null,
    sizeBand: null,
    foundedYear: null,
    linkedinUrl: "https://linkedin.com/company/acme",
    website: "https://acme.test",
    entityStatus: null,
    sourceCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  check("promotion mapper is pure and provenance preserving", promotion.crmSource === "world" && promotion.sourceRefs.sources.length === 2);

  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
