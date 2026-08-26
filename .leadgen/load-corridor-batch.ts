import { readFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
type ResearchField = { key: string; label: string; type: "text" | "number" };

// Mirrors buildResearchSearchText, which cannot be imported here because the
// research-lists module pulls in server-only Prisma wiring.
function buildResearchSearchText(data: Record<string, string | number | null>): string {
  return Object.values(data)
    .filter((value): value is string | number => value !== null)
    .map(String)
    .join(" ")
    .toLowerCase()
    .slice(0, 8000);
}

const OFFICE_ID = "cmt7r9u7g0000qhis751x6khz";
const TARGET_SLUG = "maneks-prospects";
const CAMPAIGN = "corridor-doc-20260826";
const HARVESTED_AT = "2026-08-26";
const INPUT = "/home/ubuntu/leadgen-work/corridor-load.json";

const ADDED_FIELDS: ResearchField[] = [
  { key: "search_region", label: "Search region", type: "text" },
  { key: "source_document", label: "Source document", type: "text" },
];

// Only ccTLDs give a defensible country. Anything else stays blank so the
// search region is never mistaken for a confirmed location.
const CC_TLD_COUNTRIES: Record<string, string> = {
  tr: "Turkey", es: "Spain", pt: "Portugal", br: "Brazil", ru: "Russia", ua: "Ukraine",
  de: "Germany", at: "Austria", it: "Italy", pl: "Poland", ro: "Romania", bg: "Bulgaria",
  ge: "Georgia", eg: "Egypt", sa: "Saudi Arabia", ir: "Iran", cn: "China", pe: "Peru",
  cl: "Chile", mx: "Mexico", pa: "Panama", ec: "Ecuador", ar: "Argentina", do: "Dominican Republic",
  ma: "Morocco", dz: "Algeria", tn: "Tunisia", ae: "United Arab Emirates", jo: "Jordan",
  iq: "Iraq", kz: "Kazakhstan", uz: "Uzbekistan", az: "Azerbaijan", am: "Armenia",
  by: "Belarus", md: "Moldova", gr: "Greece", ve: "Venezuela", co: "Colombia", in: "India",
};

type HarvestRow = {
  companyName: string;
  domain: string | null;
  emails: string[];
  phones: string[];
  city: string | null;
  region: string | null;
  segmentKey: string;
  fitScore: number;
  fitTier: string;
  evidenceUrls: string[];
  discoveredVia: string;
  directoryRow?: { sourceUrl: string; rowIndex: number; rawLine: string; needsResolution: boolean };
  verifications?: Array<{ email: string; verdict: string; confidence?: number }>;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 2000) : "";
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, "");
}

function countryFor(domain: string): string {
  const tld = domain.split(".").pop() ?? "";
  return CC_TLD_COUNTRIES[tld] ?? "";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DERYA_PROD_DATABASE_URL } } });

  const target = await prisma.researchList.findUnique({
    where: { officeId_slug: { officeId: OFFICE_ID, slug: TARGET_SLUG } },
    select: { id: true, fields: true },
  });
  if (!target) throw new Error("Research list missing.");
  const targetFields = target.fields as unknown as ResearchField[];

  const rows = JSON.parse(readFileSync(INPUT, "utf8")) as HarvestRow[];
  const existing = await prisma.researchRecord.findMany({
    where: { listId: target.id },
    select: { dedupeKey: true, data: true },
  });
  const existingDomains = new Set(
    existing.map((row) => normalizeDomain(text((row.data as Record<string, unknown>).domain))).filter(Boolean),
  );
  const existingKeys = new Set(existing.map((row) => row.dedupeKey).filter(Boolean) as string[]);

  const seen = new Set<string>();
  const inserts: Array<{ dedupeKey: string; data: Record<string, string | number | null> }> = [];
  let skippedExisting = 0;
  let skippedDuplicate = 0;
  let skippedNoDomain = 0;

  for (const row of rows) {
    const domain = normalizeDomain(text(row.domain));
    if (!domain) {
      skippedNoDomain += 1;
      continue;
    }
    if (existingDomains.has(domain) || existingKeys.has(domain)) {
      skippedExisting += 1;
      continue;
    }
    if (seen.has(domain)) {
      skippedDuplicate += 1;
      continue;
    }
    seen.add(domain);
    const verification = row.verifications?.find((item) => item.email === row.emails[0]);
    inserts.push({
      dedupeKey: domain,
      data: {
        company: text(row.companyName),
        domain,
        website: `https://${domain}`,
        city: text(row.city),
        country: countryFor(domain),
        search_region: text(row.region),
        segments: text(row.segmentKey),
        email: text(row.emails[0] ?? ""),
        general_email: text(row.emails[1] ?? ""),
        // Phones from this batch are dropped: the extractor stamped a Turkish
        // country code on every number, so the values are not trustworthy.
        phone: "",
        evidence_urls: row.evidenceUrls.slice(0, 4).join(" "),
        source_query: text(row.discoveredVia),
        source_document: text(row.directoryRow?.sourceUrl ?? ""),
        notes: row.directoryRow ? `Document row ${row.directoryRow.rowIndex}: ${text(row.directoryRow.rawLine).slice(0, 300)}` : "",
        fit_score: typeof row.fitScore === "number" ? row.fitScore : null,
        fit_tier: text(row.fitTier),
        email_verdict: text(verification?.verdict ?? ""),
        email_confidence: typeof verification?.confidence === "number" ? verification.confidence : null,
        campaign: CAMPAIGN,
        harvested_at: HARVESTED_AT,
      },
    });
  }

  console.log({
    input: rows.length,
    toInsert: inserts.length,
    skippedExisting,
    skippedDuplicate,
    skippedNoDomain,
    withEmail: inserts.filter((item) => item.data.email).length,
    documentSourced: inserts.filter((item) => item.data.source_document).length,
    countries: new Set(inserts.map((item) => item.data.country).filter(Boolean)).size,
  });
  console.log("sample:", JSON.stringify(inserts.slice(0, 2), null, 2));

  const missingFields = ADDED_FIELDS.filter((field) => !targetFields.some((item) => item.key === field.key));
  if (!apply) {
    console.log("dry run, nothing written", { fieldsToAdd: missingFields.map((field) => field.key) });
    await prisma.$disconnect();
    return;
  }

  if (missingFields.length) {
    await prisma.researchList.update({
      where: { id: target.id },
      data: { fields: [...targetFields, ...missingFields] as unknown as Prisma.InputJsonValue },
    });
  }

  let created = 0;
  for (const item of inserts) {
    await prisma.researchRecord.create({
      data: {
        officeId: OFFICE_ID,
        listId: target.id,
        dedupeKey: item.dedupeKey,
        status: "new",
        data: item.data as Prisma.InputJsonValue,
        searchText: buildResearchSearchText(item.data),
        sourceRefs: { campaign: CAMPAIGN, source: "leadgen-corridor-doc" } as Prisma.InputJsonValue,
      },
    });
    created += 1;
  }
  const total = await prisma.researchRecord.count({ where: { listId: target.id } });
  console.log({ created, total });
  await prisma.$disconnect();
}

void main();
