import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MANEKS_PROFILE } from "../src/lib/leadgen/profile";
import { buildQueryPlan } from "../src/lib/leadgen/query-plan";
import { dedupeByDomain, parseSearchResults, searchUrl, type SearchEngine, type SearchHit } from "../src/lib/leadgen/search";
import { defaultFetcher, extractDirectoryTargets, harvestSite, type LeadCandidate } from "../src/lib/leadgen/harvest";
import { verifyEmails, type EmailVerification } from "../src/lib/leadgen/verify";

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
//   npx tsx scripts/leadgen-run.ts plan --limit 400 --out .leadgen/queries.txt
//   npx tsx scripts/leadgen-run.ts harvest --urls .leadgen/urls.txt --out .leadgen/candidates.jsonl
//   npx tsx scripts/leadgen-run.ts verify --in .leadgen/candidates.jsonl --out .leadgen/verified.jsonl
//   npx tsx scripts/leadgen-run.ts load --in .leadgen/verified.jsonl --office-id <id>

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

async function commandPlan(args: Args) {
  const plan = buildQueryPlan(MANEKS_PROFILE, {
    limit: numberArg(args, "limit", 500),
    maxRegionsPerSegment: numberArg(args, "regions", MANEKS_PROFILE.regions.length),
  });
  const out = stringArg(args, "out", ".leadgen/queries.txt");
  await ensureDir(out);
  await writeFile(out, plan.map((entry) => entry.query).join("\n"), "utf8");
  console.log(`queries=${plan.length} out=${out}`);
}

async function commandSearch(args: Args) {
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

async function commandHarvest(args: Args) {
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
      const candidate = await harvestSite(MANEKS_PROFILE, url, { discoveredVia: url });
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

async function commandLoad(args: Args) {
  const { persistLeads } = await import("../src/lib/leadgen/persist");
  const input = stringArg(args, "in", ".leadgen/verified.jsonl");
  const officeId = stringArg(args, "office-id");
  const campaignTag = stringArg(args, "campaign", `leadgen_${MANEKS_PROFILE.slug}`);
  const records = (await readLines(input)).map((line) => JSON.parse(line));
  const result = await persistLeads(records, {
    officeId,
    campaignTag,
    minScore: numberArg(args, "min-score", 50),
    minEmailConfidence: numberArg(args, "min-confidence", 55),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "plan") return commandPlan(args);
  if (command === "search") return commandSearch(args);
  if (command === "directory") return commandDirectory(args);
  if (command === "harvest") return commandHarvest(args);
  if (command === "verify") return commandVerify(args);
  if (command === "load") return commandLoad(args);
  console.log("commands: plan | search | directory | harvest | verify | load");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
