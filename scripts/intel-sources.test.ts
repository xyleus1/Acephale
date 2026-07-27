import {
  INTEL_SOURCES,
  dedupeIntelSourceUses,
  formatCacheAge,
  formatReviewAge,
  formatSourcesFooter,
  getIntelSource,
  isSecretFreeSourceUrl,
  resolveIntelSourceUse,
  reviewedSourceUse,
  type IntelSourceDefinition,
  type IntelSourceId,
} from "../src/lib/intel/sources";

let failures = 0;

function check(name: string, ok: boolean) {
  if (ok) console.log(`ok - ${name}`);
  else {
    failures += 1;
    console.error(`FAIL - ${name}`);
  }
}

const requiredKeys: Array<keyof IntelSourceDefinition> = [
  "id",
  "name",
  "publisher",
  "homepage",
  "access",
  "cadence",
  "cacheSeconds",
  "reachableFromVercel",
  "notes",
];

for (const [key, source] of Object.entries(INTEL_SOURCES)) {
  check(`${key} id matches its registry key`, source.id === key);
  check(`${key} has the complete source contract`, requiredKeys.every((field) => field in source));
  check(`${key} homepage is a secret-free HTTPS URL`, source.homepage.startsWith("https://") && isSecretFreeSourceUrl(source.homepage));
  check(`${key} has a positive cache policy`, source.cacheSeconds > 0);
  let homepageResolves = true;
  try {
    resolveIntelSourceUse(reviewedSourceUse(key as IntelSourceId));
  } catch {
    homepageResolves = false;
  }
  check(`${key} homepage is registered for that source`, homepageResolves);
}

let unknownRejected = false;
try {
  getIntelSource("not_registered" as IntelSourceId);
} catch {
  unknownRejected = true;
}
check("unknown source ids fail closed", unknownRejected);

check("api keys are rejected from citation URLs", !isSecretFreeSourceUrl("https://api.eia.gov/v2/data?api_key=secret"));
check("Census keys are rejected from citation URLs", !isSecretFreeSourceUrl("https://api.census.gov/data?key=secret"));
check("client secrets are rejected from citation URLs", !isSecretFreeSourceUrl("https://api.eia.gov/v2/data?client_secret=secret"));
check("signed URLs are rejected from citation URLs", !isSecretFreeSourceUrl("https://api.eia.gov/v2/data?signature=secret"));
check("URL credentials are rejected from citation URLs", !isSecretFreeSourceUrl("https://user:pass@api.eia.gov/v2/data"));
check("ordinary query parameters remain valid", isSecretFreeSourceUrl("https://hts.usitc.gov/reststop/search?keyword=8471"));
check(
  "Schedule C dictionary is registered",
  resolveIntelSourceUse(
    reviewedSourceUse(
      "census_schedule_c",
      "https://www.census.gov/foreign-trade/schedules/c/country3.txt",
      "2026-07-22"
    )
  ).publisher === "U.S. Census Bureau"
);
check(
  "official USITC revision pages are registered",
  resolveIntelSourceUse(
    reviewedSourceUse(
      "usitc_hts",
      "https://www.usitc.gov/press_room/archive/featured_news/update_2022_hts_basic_edition",
      "2026-07-22"
    )
  ).publisher === "U.S. International Trade Commission"
);
check(
  "official ImportGenius pricing pages are registered",
  resolveIntelSourceUse(
    reviewedSourceUse(
      "importgenius",
      "https://w3.importgenius.com/pricing",
      "2026-07-23"
    )
  ).publisher === "ImportGenius"
);

const usitc = reviewedSourceUse("usitc_hts", "https://hts.usitc.gov/reststop/search?keyword=8471", "2026-07-21");
const duplicate = dedupeIntelSourceUses([usitc, usitc]);
check("identical source and deep-link pairs dedupe", duplicate.length === 1);
check("resolved uses contain publisher metadata", resolveIntelSourceUse(usitc).publisher === "U.S. International Trade Commission");
const liveUsitc = { ...usitc, fetchedAt: "2026-07-21T00:00:00.000Z", reviewedAt: null };
check("cache age is deterministic for a supplied clock", formatCacheAge(liveUsitc, new Date("2026-07-21T02:30:00.000Z")) === "2h old");
check("manual rules are not mislabeled as cached fetches", formatCacheAge(usitc) === "not cached");
check("manual rule review age is explicit", formatReviewAge(usitc, new Date("2026-07-22T00:00:00.000Z")) === "1d since review");

const footer = formatSourcesFooter([usitc]);
check("plain-text footer includes the exact source", footer.includes("Harmonized Tariff Schedule, U.S. International Trade Commission"));
check(
  "plain-text footer preserves a claim-specific source label",
  formatSourcesFooter([{ ...usitc, displayName: "HS 2022 revision notice" }]).includes(
    "HS 2022 revision notice, U.S. International Trade Commission"
  )
);
check("plain-text footer distinguishes reviewed rules from fetched data", footer.includes("as of 2026-07-21") && footer.includes("reviewed 2026-07-21T00:00:00.000Z"));
check("plain-text footer includes the deep link", footer.includes("https://hts.usitc.gov/reststop/search?keyword=8471"));

let secretUseRejected = false;
try {
  resolveIntelSourceUse({ ...usitc, sourceUrl: "https://hts.usitc.gov/?token=secret" });
} catch {
  secretUseRejected = true;
}
check("source resolution rejects secret-bearing links", secretUseRejected);

let wrongHostRejected = false;
try {
  resolveIntelSourceUse({ ...usitc, sourceUrl: "https://example.com/hts" });
} catch {
  wrongHostRejected = true;
}
check("source resolution rejects unregistered citation hosts", wrongHostRejected);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll Intel source registry checks passed");
