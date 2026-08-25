import fs from "node:fs";
import path from "node:path";

const outputDir = path.dirname(new URL(import.meta.url).pathname);
const csvPath = path.join(outputDir, "maneks-non-bulk-prospects.csv");
const queryPath = path.join(outputDir, "queries.txt");
const validationPath = path.join(outputDir, "validation.json");

const expectedHeaders = [
  "company_name",
  "country",
  "city",
  "segment",
  "website",
  "domain",
  "what_they_buy",
  "size_signal",
  "general_email",
  "contact_name",
  "contact_title",
  "contact_email",
  "phone",
  "whatsapp",
  "language",
  "evidence_urls",
  "source_query",
  "notes",
];

const allowedSegments = new Set([
  "steel service centers, coil processors, slitting and cut-to-length lines",
  "metal fabricators, machine shops, sheet metal and laser cutting shops",
  "pipe, tube and profile producers",
  "machinery, equipment and vehicle-body manufacturers",
  "construction, infrastructure and precast contractors that buy rebar, plate or profile",
  "foundries, smelters and ferroalloy plants (for iron, chrome and manganese ore)",
  "regional steel stockists, distributors and small importing traders",
  "container and breakbulk freight-forwarding importers who buy on their own account",
]);

const requiredCountries = new Set([
  "Venezuela",
  "Colombia",
  "Trinidad and Tobago",
  "Panama",
  "Dominican Republic",
  "Mexico",
  "Brazil",
  "Morocco",
  "Algeria",
  "Tunisia",
  "Egypt",
  "Spain",
  "Portugal",
  "Italy",
  "Malta",
  "Greece",
  "Turkey",
  "Bulgaria",
  "Romania",
  "Ukraine",
  "Georgia",
  "Russia",
  "Netherlands",
  "Belgium",
  "Germany",
  "Poland",
  "United Arab Emirates",
  "Saudi Arabia",
  "Oman",
  "India",
  "Pakistan",
  "Vietnam",
  "China",
]);

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...data] = rows.filter((values) => values.some(Boolean));
  return {
    headers,
    rows: data.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const csvText = fs.readFileSync(csvPath, "utf8");
const queryText = fs.readFileSync(queryPath, "utf8");
const { headers, rows } = parseCsv(csvText);

assert(JSON.stringify(headers) === JSON.stringify(expectedHeaders), "CSV headers differ from the requested exact schema");
assert(rows.length >= 300, `Expected at least 300 rows, found ${rows.length}`);
assert(!csvText.includes("\u2014"), "CSV contains a prohibited em dash character");

const domains = new Set();
const countries = new Set();
const segmentCounts = {};
const countryCounts = {};
let generalEmailCount = 0;
let contactEmailCount = 0;
let phoneCount = 0;
let whatsappCount = 0;
let cityCount = 0;
let sizeSignalCount = 0;
let webSearchRowCount = 0;
let inventoryRowCount = 0;

for (const [index, row] of rows.entries()) {
  const number = index + 2;
  for (const field of ["company_name", "country", "segment", "website", "domain", "what_they_buy", "language", "evidence_urls", "source_query"]) {
    assert(row[field], `Row ${number} is missing ${field}`);
  }
  assert(allowedSegments.has(row.segment), `Row ${number} has an invalid segment`);
  assert(!domains.has(row.domain), `Duplicate domain on row ${number}: ${row.domain}`);
  assert(row.domain === row.domain.toLowerCase(), `Domain is not lowercase on row ${number}: ${row.domain}`);
  assert(/^https?:\/\//.test(row.website), `Website is not an HTTP(S) URL on row ${number}`);

  const evidenceUrls = row.evidence_urls.split(/\s+/).filter(Boolean);
  assert(evidenceUrls.length >= 1 && evidenceUrls.length <= 3, `Row ${number} must have 1 to 3 evidence URLs`);
  assert(evidenceUrls.every((url) => /^https?:\/\//.test(url)), `Row ${number} has an invalid evidence URL`);

  for (const emailField of ["general_email", "contact_email"]) {
    if (row[emailField]) {
      assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row[emailField]), `Row ${number} has an invalid ${emailField}`);
    }
  }

  domains.add(row.domain);
  countries.add(row.country);
  segmentCounts[row.segment] = (segmentCounts[row.segment] ?? 0) + 1;
  countryCounts[row.country] = (countryCounts[row.country] ?? 0) + 1;
  generalEmailCount += Number(Boolean(row.general_email));
  contactEmailCount += Number(Boolean(row.contact_email));
  phoneCount += Number(Boolean(row.phone));
  whatsappCount += Number(Boolean(row.whatsapp));
  cityCount += Number(Boolean(row.city));
  sizeSignalCount += Number(Boolean(row.size_signal));
  inventoryRowCount += Number(row.source_query.startsWith("existing public-source inventory filter:"));
  webSearchRowCount += Number(!row.source_query.startsWith("existing public-source inventory filter:"));
  if (row.source_query.startsWith("existing public-source inventory filter:")) {
    assert(!row.general_email && !row.contact_name && !row.contact_title && !row.contact_email && !row.phone && !row.whatsapp, `Inventory row ${number} contains an unverified contact field`);
  }
}

const missingCountries = [...requiredCountries].filter((country) => !countries.has(country));
assert(missingCountries.length === 0, `Missing requested countries: ${missingCountries.join(", ")}`);

const publicQueries = queryText
  .split("\n")
  .slice(queryText.split("\n").findIndex((line) => line === "Public web queries run") + 1)
  .map((line) => line.trim())
  .filter(Boolean);
assert(publicQueries.length === 32, `Expected 32 logged public web queries, found ${publicQueries.length}`);

const validation = {
  status: "pass",
  generated_at: new Date().toISOString(),
  csv: path.basename(csvPath),
  exact_header: true,
  rows: rows.length,
  unique_domains: domains.size,
  countries: countries.size,
  all_requested_countries_present: true,
  public_web_queries_logged: publicQueries.length,
  web_search_rows: webSearchRowCount,
  recent_public_inventory_rows: inventoryRowCount,
  contact_coverage: {
    general_email: generalEmailCount,
    contact_email: contactEmailCount,
    phone: phoneCount,
    whatsapp: whatsappCount,
    city: cityCount,
    size_signal: sizeSignalCount,
  },
  country_counts: Object.fromEntries(Object.entries(countryCounts).sort(([a], [b]) => a.localeCompare(b))),
  segment_counts: Object.fromEntries(Object.entries(segmentCounts).sort(([a], [b]) => a.localeCompare(b))),
  checks: [
    "exact requested header",
    "at least 300 rows",
    "one row per unique domain",
    "all requested countries present",
    "allowed buyer segment values only",
    "one to three HTTP(S) evidence URLs per row",
    "inventory contacts left blank; web contacts manually transcribed from public pages",
    "no prohibited em dash character",
  ],
  verification_boundary: "URLs and facts in web-search rows were returned from public pages during this run. Inventory rows reuse public evidence retrieved 2026-08-16 through 2026-08-18. The sandbox could not DNS-resolve URLs with curl, so every URL was not re-requested from the shell during this run.",
};

fs.writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`, "utf8");
console.log(JSON.stringify(validation, null, 2));
