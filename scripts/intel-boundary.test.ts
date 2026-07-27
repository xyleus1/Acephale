import fs from "node:fs";
import path from "node:path";
import * as canonicalEngine from "../src/lib/intel/preflight/engine";
import * as canonicalEnrich from "../src/lib/intel/preflight/enrich";
import * as canonicalExtract from "../src/lib/intel/preflight/extract";
import * as canonicalIndicators from "../src/lib/intel/market/indicators";
import * as legacyEngine from "../src/lib/load-check";
import * as legacyEnrich from "../src/lib/load-check-enrich";
import * as legacyExtract from "../src/lib/load-check-extract";
import * as legacyIndicators from "../src/lib/market-indicators";
import { classifyIntelLocation } from "../src/lib/intel/location";
import { classifyDomesticLocation } from "../src/lib/domestic-trucking-pricing";

const root = process.cwd();
let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) console.log(`ok - ${name}`);
  else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

function filesUnder(relative: string): string[] {
  const directory = path.join(root, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

const intelLibFiles = filesUnder("src/lib/intel").filter((file) => /\.(ts|tsx)$/.test(file));
const intelRouteFiles = filesUnder("src/app/dashboard/intel").filter((file) => /\.(ts|tsx)$/.test(file));
const sourceFiles = filesUnder("src").filter((file) => /\.(ts|tsx)$/.test(file));

for (const file of intelLibFiles.filter((file) => !file.endsWith("/index.ts"))) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  check(`${file} does not import the Intel barrel`, !source.includes('from "@/lib/intel"') && !source.includes("from '@/lib/intel'"));
  check(`${file} does not import a legacy shim`, !/@\/lib\/(load-check|load-check-extract|load-check-enrich|market-indicators)/.test(source));
  check(`${file} stays separate from market-intelligence`, !source.includes("market-intelligence"));
}

for (const file of [...intelLibFiles, ...intelRouteFiles]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  check(`${file} contains no em dash character`, !source.includes("\u2014"));
}

const compatibilityShims = new Set([
  "src/lib/load-check.ts",
  "src/lib/load-check-extract.ts",
  "src/lib/load-check-enrich.ts",
  "src/lib/market-indicators.ts",
]);
const privateLeafViolations: string[] = [];
const clientServerEntrypointViolations: string[] = [];
for (const file of sourceFiles.filter((file) => !file.startsWith("src/lib/intel/"))) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const importsInternalLeaf = /from\s+["']@\/lib\/intel\/(?!server["'])/.test(source);
  const importsRelativeLeaf = file.startsWith("src/lib/") && /from\s+["'](?:\.\.\/|\.\/)intel\//.test(source);
  if (importsInternalLeaf || (importsRelativeLeaf && !compatibilityShims.has(file))) privateLeafViolations.push(file);
  if (/^["']use client["'];/m.test(source) && /from\s+["']@\/lib\/intel\/server["']/.test(source)) {
    clientServerEntrypointViolations.push(file);
  }
}
check(
  `outside modules use only public Intel entrypoints${privateLeafViolations.length > 0 ? `: ${privateLeafViolations.join(", ")}` : ""}`,
  privateLeafViolations.length === 0
);
check(
  `client modules do not import the Intel server entrypoint${clientServerEntrypointViolations.length > 0 ? `: ${clientServerEntrypointViolations.join(", ")}` : ""}`,
  clientServerEntrypointViolations.length === 0
);
check(
  "the Intel server entrypoint is build-enforced as server-only",
  fs.readFileSync(path.join(root, "src/lib/intel/server.ts"), "utf8").startsWith('import "server-only";')
);

const expectedShims: Record<string, string> = {
  "src/lib/load-check.ts": 'export * from "./intel/preflight/engine";',
  "src/lib/load-check-extract.ts": 'export * from "./intel/preflight/extract";',
  "src/lib/load-check-enrich.ts": 'export * from "./intel/preflight/enrich";',
  "src/lib/market-indicators.ts": 'export * from "./intel/market/indicators";',
};
for (const [file, expected] of Object.entries(expectedShims)) {
  check(`${file} is a one-way compatibility shim`, fs.readFileSync(path.join(root, file), "utf8").trim() === expected);
}

check("legacy engine shim preserves the runtime export", legacyEngine.checkLoadIdea === canonicalEngine.checkLoadIdea);
check("legacy extractor shim preserves the runtime export", legacyExtract.extractLoadIdea === canonicalExtract.extractLoadIdea);
check("legacy enricher shim preserves the runtime export", legacyEnrich.enrichLoadCheck === canonicalEnrich.enrichLoadCheck);
check("legacy indicator shim preserves the runtime export", legacyIndicators.fetchMarketBaseline === canonicalIndicators.fetchMarketBaseline);

for (const location of [null, "USA", "Fremont, CA", "Austin, Texas", "94105", "Istanbul, Turkey", "Unknown Place"]) {
  check(
    `domestic location compatibility matches Intel for ${location ?? "missing"}`,
    JSON.stringify(classifyDomesticLocation(location)) === JSON.stringify(classifyIntelLocation(location))
  );
}

const marketPage = fs.readFileSync(path.join(root, "src/app/dashboard/market/page.tsx"), "utf8");
check("the old market route redirects to Intel", marketPage.includes('redirect("/dashboard/intel")'));
check("the new Intel route exists", fs.existsSync(path.join(root, "src/app/dashboard/intel/page.tsx")));
const intelligenceFiles = filesUnder("src/app/dashboard/intelligence");
check(
  "the separate intelligence route does not redirect to Intel",
  intelligenceFiles.every((file) => !fs.readFileSync(path.join(root, file), "utf8").includes('redirect("/dashboard/intel")'))
);
const navLink = fs.readFileSync(path.join(root, "src/components/nav-link.tsx"), "utf8");
check("nav active matching uses a segment boundary", navLink.includes("pathname.startsWith(`${href}/`)"));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Intel boundary checks passed");
