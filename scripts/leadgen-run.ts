import "dotenv/config";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildQueryPlan, type LeadGenQueryShape } from "../src/lib/leadgen/query-plan";
import { dedupeByDomain, parseSearchResults, searchUrl, selectSearchProvider, type SearchEngine, type SearchHit } from "../src/lib/leadgen/search";
import { defaultFetcher, extractDirectoryTargets, harvestSite, type LeadCandidate } from "../src/lib/leadgen/harvest";
import { verifyEmails, type EmailVerification } from "../src/lib/leadgen/verify";
import { runProspectingBatch, type ProspectingBatchCandidate } from "../src/lib/leadgen/run";
import { resolveLeadGenProfile } from "../src/lib/leadgen/registry";
import type { LeadGenProfile } from "../src/lib/leadgen/profile";

// Lead generation pipeline runner.
//
//   plan     write the deterministic query plan
//   search   run the query plan against public search result pages
//   directory expand chamber, OSB and member-list pages into company URLs
//   harvest  crawl candidate sites and extract contact evidence
//   verify   screen every extracted address
//   load     upsert qualified leads into an office (requires DATABASE_URL)
//
// Example:
//   npx tsx scripts/leadgen-run.ts plan --profile wens --limit 400 --out .leadgen/queries.txt
//   npx tsx scripts/leadgen-run.ts corridor-plan --profile maneks-corridor --out .leadgen/corridor-queries.txt
//   npx tsx scripts/leadgen-run.ts corridor-harvest --profile maneks-corridor --jsonl .leadgen/serps.jsonl
//   npx tsx scripts/leadgen-run.ts harvest --profile wens --urls .leadgen/urls.txt --out .leadgen/candidates.jsonl
//   npx tsx scripts/leadgen-run.ts verify --in .leadgen/candidates.jsonl --out .leadgen/verified.jsonl
//   npx tsx scripts/leadgen-run.ts load --profile wens --in .leadgen/verified.jsonl --office-id <id>
//
// Profiles: maneks, maneks-corridor, wens. The default is maneks, except
// corridor-plan and corridor-harvest default to maneks-corridor.

type Args = Record<string, string | boolean>;

function parseArgs(argv: readonly string[]): { command: string; args: Args } {
  const [command = "help", ...rest] = argv;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

function stringArg(args: Args, key: string, fallback?: string) {
  const value = args[key];
  if (typeof value === "string") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`--${key} is required`);
}

function numberArg(args: Args, key: string, fallback: number) {
  const value = args[key];
  return typeof value === "string" ? Number(value) : fallback;
}

async function ensureDir(filePath: string) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
}

async function readLines(filePath: string) {
  const raw = await readFile(filePath, "utf8");
  return raw.split("\n").map((line) => line.trim()).filter(Boolean);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commandPlan(profile: LeadGenProfile, args: Args) {
  const plan = buildQueryPlan(profile, {
    limit: numberArg(args, "limit", 500),
    maxRegionsPerSegment: numberArg(args, "regions", profile.regions.length),
  });
  const out = stringArg(args, "out", ".leadgen/queries.txt");
  await ensureDir(out);
  await writeFile(out, plan.map((entry) => entry.query).join("\n"), "utf8");
  console.log(`queries=${plan.length} out=${out}`);
}

function shapeArgs(args: Args): LeadGenQueryShape[] | undefined {
  const value = args.shapes;
  if (typeof value !== "string") return undefined;
  return value.split(",").map((shape) => shape.trim()).filter(Boolean) as LeadGenQueryShape[];
}

async function commandCorridorPlan(profile: LeadGenProfile, args: Args) {
  const out = stringArg(args, "out", ".leadgen/corridor-queries.txt");
  const plan = buildQueryPlan(profile, {
    limit: numberArg(args, "limit", 0),
    maxRegionsPerSegment: numberArg(args, "regions", profile.regions.length),
    shapes: shapeArgs(args),
  });
  await ensureDir(out);
  await writeFile(out, plan.map((entry) => entry.query).join("\n"), "utf8");
  await writeFile(`${out}.jsonl`, plan.map((entry) => JSON.stringify(entry)).join("\n"), "utf8");
  const byLocale = Object.fromEntries(
    [...new Set(plan.map((entry) => entry.locale))].map((locale) => [locale, plan.filter((entry) => entry.locale === locale).length]),
  );
  const byShape = Object.fromEntries(
    [...new Set(plan.map((entry) => entry.shape))].map((shape) => [shape, plan.filter((entry) => entry.shape === shape).length]),
  );
  console.log(JSON.stringify({ queries: plan.length, byLocale, byShape, out, jsonl: `${out}.jsonl` }, null, 2));
}

function corridorCandidateRecord(record: ProspectingBatchCandidate) {
  const { candidate, directoryRow } = record;
  return {
    companyName: candidate.companyName,
    domain: candidate.domain || null,
    emails: candidate.emails,
    phones: candidate.phones,
    city: candidate.city,
    region: record.region,
    segmentKey: candidate.segmentKey,
    fitScore: candidate.fit.score,
    fitTier: candidate.fit.tier,
    evidenceUrls: candidate.evidence.map((item) => item.url),
    discoveredVia: candidate.discoveredVia,
    ...(directoryRow ? {
      directoryRow: {
        sourceUrl: directoryRow.sourceUrl,
        rowIndex: directoryRow.rowIndex,
        rawLine: directoryRow.rawLine,
        needsResolution: directoryRow.needsResolution,
      },
    } : {}),
    verifications: record.verifications,
  };
}

async function commandCorridorHarvest(profile: LeadGenProfile, args: Args) {
  const jsonlPath = stringArg(args, "jsonl");
  const out = stringArg(args, "out", ".leadgen/corridor-rows.jsonl");
  await ensureDir(out);
  const provider = selectSearchProvider({ providerName: "jsonl", jsonlPath });
  const result = await runProspectingBatch({
    profile,
    queryOffset: numberArg(args, "query-offset", 0),
    maxQueries: numberArg(args, "max-queries", 24),
    maxPages: numberArg(args, "max-pages", 60),
    budgetMs: numberArg(args, "budget-ms", 240_000),
    maxDirectoryRowsPerDocument: numberArg(args, "max-rows-per-doc", 500),
    search: async (query) => ({
      hits: await provider.search(query.query),
      pagesFetched: 0,
    }),
    fetchPage: defaultFetcher,
  });
  const lines = result.candidates.map((record) => `${JSON.stringify(corridorCandidateRecord(record))}\n`).join("");
  await appendFile(out, lines, "utf8");
  const domains = new Set(result.candidates.map(({ candidate }) => candidate.domain).filter(Boolean));
  const sourceDocuments = new Set(
    result.candidates.flatMap(({ directoryRow }) => directoryRow ? [directoryRow.sourceUrl] : []),
  );
  const documentRows = result.candidates.filter((record) => record.directoryRow).length;
  console.log(JSON.stringify({
    stats: result.stats,
    rowCount: result.candidates.length,
    distinctDomains: domains.size,
    distinctSourceDocuments: sourceDocuments.size,
    documentRows,
    singleCompanyRows: result.candidates.length - documentRows,
    nextQueryOffset: result.nextQueryOffset,
    exhausted: result.exhausted,
    out,
  }, null, 2));
}

async function commandSearch(_profile: LeadGenProfile, args: Args) {
  const engine = stringArg(args, "engine", "brave") as SearchEngine;
  const queries = await readLines(stringArg(args, "queries", ".leadgen/queries.txt"));
  const out = stringArg(args, "out", ".leadgen/urls.txt");
  const delayMs = numberArg(args, "delay", 4_000);
  await ensureDir(out);

  const hits: SearchHit[] = [];
  for (const [index, query] of queries.entries()) {
    const page = await defaultFetcher(searchUrl(engine, query));
    if (page?.body) hits.push(...parseSearchResults(page.body, engine));
    console.log(`[${index + 1}/${queries.length}] ${hits.length} hits after "${query}"`);
    await sleep(delayMs);
  }

  const urls = dedupeByDomain(hits).map((hit) => `https://${hit.domain}`);
  await writeFile(out, urls.join("\n"), "utf8");
  console.log(`domains=${urls.length} out=${out}`);
}

async function commandDirectory(args: Args) {
  const urls = await readLines(stringArg(args, "urls", ".leadgen/directories.txt"));
  const out = stringArg(args, "out", ".leadgen/directory-targets.txt");
  const concurrency = numberArg(args, "concurrency", 6);
  await ensureDir(out);

  const queue = [...urls];
  const targets = new Set<string>();
  let processed = 0;

  async function worker() {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const page = await defaultFetcher(url);
      processed += 1;
      if (page && !page.isPdf) {
        for (const target of extractDirectoryTargets(page.body, page.url)) targets.add(target);
      }
      if (processed % 25 === 0) console.log(`directories=${processed}/${urls.length} targets=${targets.size}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
  await writeFile(out, [...targets].join("\n"), "utf8");
  console.log(`targets=${targets.size} out=${out}`);
}

async function commandHarvest(profile: LeadGenProfile, args: Args) {
  const urls = await readLines(stringArg(args, "urls", ".leadgen/urls.txt"));
  const out = stringArg(args, "out", ".leadgen/candidates.jsonl");
  const concurrency = numberArg(args, "concurrency", 6);
  await ensureDir(out);

  const queue = [...urls];
  const sink = createWriteStream(path.resolve(out), { flags: "a" });
  let processed = 0;
  let kept = 0;

  async function worker() {
    for (;;) {
      const url = queue.shift();
      if (!url) return;
      const candidate = await harvestSite(profile, url, { discoveredVia: url });
      processed += 1;
      if (candidate && candidate.emails.length > 0 && candidate.fit.tier !== "reject") {
        kept += 1;
        sink.write(`${JSON.stringify(candidate)}\n`);
      }
      if (processed % 25 === 0) console.log(`harvested=${processed}/${urls.length} kept=${kept}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
  await new Promise((resolve) => sink.end(resolve));
  console.log(`candidates=${kept} out=${out}`);
}

async function commandVerify(args: Args) {
  const input = stringArg(args, "in", ".leadgen/candidates.jsonl");
  const out = stringArg(args, "out", ".leadgen/verified.jsonl");
  await ensureDir(out);

  const lines = await readLines(input);
  const results: string[] = [];
  for (const line of lines) {
    const candidate = JSON.parse(line) as LeadCandidate;
    const verifications: EmailVerification[] = await verifyEmails(candidate.emails, {
      companyDomain: candidate.domain,
    });
    results.push(JSON.stringify({ candidate, verifications }));
  }
  await writeFile(out, results.join("\n"), "utf8");
  const deliverable = results
    .map((line) => JSON.parse(line) as { verifications: EmailVerification[] })
    .reduce((count, record) => count + record.verifications.filter((item) => item.verdict === "deliverable_likely").length, 0);
  console.log(`records=${results.length} deliverable=${deliverable} out=${out}`);
}

async function commandLoad(profile: LeadGenProfile, args: Args) {
  const { persistLeads } = await import("../src/lib/leadgen/persist");
  const input = stringArg(args, "in", ".leadgen/verified.jsonl");
  const officeId = stringArg(args, "office-id");
  const campaignTag = stringArg(args, "campaign", `leadgen_${profile.slug}`);
  const records = (await readLines(input)).map((line) => JSON.parse(line));
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient();
  const result = await persistLeads(records, {
    officeId,
    campaignTag,
    client,
    minScore: numberArg(args, "min-score", 50),
    minEmailConfidence: numberArg(args, "min-confidence", 55),
  });
  await client.$disconnect();
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  const defaultProfile = command === "corridor-plan" || command === "corridor-harvest" ? "maneks-corridor" : "maneks";
  const profile = resolveLeadGenProfile(stringArg(args, "profile", defaultProfile));
  if (command === "plan") return commandPlan(profile, args);
  if (command === "corridor-plan") return commandCorridorPlan(profile, args);
  if (command === "corridor-harvest") return commandCorridorHarvest(profile, args);
  if (command === "search") return commandSearch(profile, args);
  if (command === "directory") return commandDirectory(args);
  if (command === "harvest") return commandHarvest(profile, args);
  if (command === "verify") return commandVerify(args);
  if (command === "load") return commandLoad(profile, args);
  console.log("commands: plan | corridor-plan | corridor-harvest | search | directory | harvest | verify | load; option: --profile <slug>");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
