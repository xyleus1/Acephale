import { Readable } from "node:stream";
import { buildCompanyPromotion } from "../src/lib/world/promote";
import { readCsvRows } from "../src/lib/world/csv";
import { classifyManufacturer } from "../src/lib/world/manufacturing";
import { normalizeCompanyName, normalizeCountry, normalizeDomain } from "../src/lib/world/normalize";
import { parseCompaniesHouseRow } from "../src/lib/world/sources/companies-house";
import { parseEpaFrsRow } from "../src/lib/world/sources/epa-frs";
import { parseEuIndustrialEmissionsRow } from "../src/lib/world/sources/eu-industrial-emissions";
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
  check("Companies House parser permits name matching", companiesHouse?.nameMatchable === true);
  check("Companies House parser skips missing number", parseCompaniesHouseRow({ CompanyName: "Missing" }) === null);

  const epa = parseEpaFrsRow({
    REGISTRY_ID: "110071337641",
    PRIMARY_NAME: "Acme Industrial Plant",
    LOCATION_ADDRESS: "Factory Road 1",
    CITY_NAME: "Birmingham",
    STATE_CODE: "AL",
    POSTAL_CODE: "35005",
    NAICS_CODES: "332710",
    SIC_CODES: "3469",
  });
  check("EPA FRS parser maps registry and address", Boolean(
    epa?.sourceRecordId === "110071337641"
      && epa.country === "US"
      && epa.nameNormalized === "acme industrial plant"
      && epa.region === "AL"
      && epa.city === "Birmingham"
      && epa.postalCode === "35005"
      && epa.addressLine === "Factory Road 1",
  ));
  check("EPA FRS facility names are not name-matchable", epa?.nameMatchable === false);
  check("EPA FRS parser classifies manufacturer with source evidence", Boolean(
    epa?.isManufacturer
      && Array.isArray(epa.manufacturerEvidence)
      && epa.manufacturerEvidence.some((entry) => (
        typeof entry === "object"
        && entry !== null
        && "source" in entry
        && entry.source === "epa_frs"
      )),
  ));
  check("EPA FRS parser retains payload and skips missing registry", Boolean(
    typeof epa?.payload === "object"
      && epa.payload !== null
      && "REGISTRY_ID" in epa.payload
  ) && parseEpaFrsRow({ PRIMARY_NAME: "Missing registry" }) === null);
  check("EPA FRS parser keeps non-manufacturing codes false", !parseEpaFrsRow({
    REGISTRY_ID: "110071337642",
    PRIMARY_NAME: "Acme Services",
    NAICS_CODES: "541110",
    SIC_CODES: "8742",
  })?.isManufacturer);

  const euIndustrialEmissions = parseEuIndustrialEmissionsRow({
    FacilityInspireId: "DE.example.facility-1",
    facilityName: "Acme Chemie GmbH",
    CountryName: "Germany",
    City: "Berlin",
    PostalCode: "10115",
    Street: "Industriestrasse 1",
    NACECode: "20.16",
    website: "",
  });
  check("EU industrial emissions parser maps facility identity and address", Boolean(
    euIndustrialEmissions?.sourceRecordId === "DE.example.facility-1"
      && euIndustrialEmissions.nameNormalized === "acme chemie"
      && euIndustrialEmissions.country === "DE"
      && euIndustrialEmissions.city === "Berlin"
      && euIndustrialEmissions.postalCode === "10115"
      && euIndustrialEmissions.addressLine === "Industriestrasse 1",
  ));
  check("EU facility names are not name-matchable", euIndustrialEmissions?.nameMatchable === false);
  check("EU industrial emissions parser classifies NACE activity", Boolean(
    euIndustrialEmissions?.isManufacturer
      && Array.isArray(euIndustrialEmissions.manufacturerEvidence)
      && euIndustrialEmissions.manufacturerEvidence.some((entry) => (
        typeof entry === "object"
        && entry !== null
        && "source" in entry
        && entry.source === "eu_industrial_emissions"
        && "kind" in entry
        && entry.kind === "activity"
      )),
  ));
  const eprtrFacility = parseEuIndustrialEmissionsRow({
    FacilityInspireId: "DE.example.facility-chemicals",
    facilityName: "Acme Chemicals",
    EPRTRAnnexIMainActivity: "4(a)",
    EPRTR_SectorName: "Chemical industry",
  });
  check("EU industrial emissions maps E-PRTR chemical activity", Boolean(
    eprtrFacility?.isManufacturer
      && Array.isArray(eprtrFacility.manufacturerEvidence)
      && eprtrFacility.manufacturerEvidence.some((entry) => (
        typeof entry === "object"
        && entry !== null
        && "kind" in entry
        && entry.kind === "eprtr_sector"
        && "value" in entry
        && entry.value === "4 Chemical industry"
      )),
  ));
  const wasteInstallation = parseEuIndustrialEmissionsRow({
    InstallationInspireId: "DE.example.installation-waste",
    installationName: "Acme Waste Facility",
    IEDAnnexIMainActivity: "5.1",
  });
  check("EU industrial emissions keeps IED waste activity non-manufacturing", !wasteInstallation?.isManufacturer);
  check("EU industrial emissions parser keeps website null and skips missing name", Boolean(
    euIndustrialEmissions?.website === null
      && typeof euIndustrialEmissions.payload === "object"
      && euIndustrialEmissions.payload !== null
      && "FacilityInspireId" in euIndustrialEmissions.payload
  ) && parseEuIndustrialEmissionsRow({ FacilityInspireId: "missing-name" }) === null);
  check("EU industrial emissions parser skips missing facility id", parseEuIndustrialEmissionsRow({
    facilityName: "Missing facility id",
  }) === null);

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
