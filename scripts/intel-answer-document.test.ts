import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  answerSourceKey,
  composeAnswerDocument,
  dedupeAnswerSources,
  type AnswerFact,
} from "../src/lib/intel/answers/document";
import type { IntelSourceUse } from "../src/lib/intel/sources";

const census: IntelSourceUse = {
  sourceId: "census_trade",
  sourceUrl: "https://api.census.gov/data/timeseries/intltrade/imports/hs?get=VES_VAL_MO",
  asOf: "2026-05",
  fetchedAt: "2026-07-22T12:00:00.000Z",
  reviewedAt: null,
};
const censusOtherQuery: IntelSourceUse = {
  ...census,
  sourceUrl: "https://api.census.gov/data/timeseries/intltrade/imports/hs?get=AIR_VAL_MO",
};
const rule: IntelSourceUse = {
  sourceId: "usitc_hts",
  sourceUrl: "https://hts.usitc.gov/",
  asOf: "2026",
  fetchedAt: null,
  reviewedAt: "2026-07-22T12:00:00.000Z",
};

assert.equal(answerSourceKey(census), `census_trade|${census.sourceUrl}`);
assert.deepEqual(
  dedupeAnswerSources([census, census, censusOtherQuery]).map(answerSourceKey),
  [answerSourceKey(census), answerSourceKey(censusOtherQuery)],
  "source dedupe keeps distinct deep links and preserves first-seen order"
);

const facts: AnswerFact[] = [
  {
    id: "vessel_value",
    label: "Vessel value",
    value: 125_000_000,
    displayValue: "$125M",
    unit: "USD",
    period: "2021-2025",
    detail: "Five complete years.",
    confidence: "high",
    sources: [census, census],
  },
];

const document = composeAnswerDocument({
  question: "What hardware is imported through the West Coast?",
  intent: "ocean_hardware_research",
  status: "partial",
  title: "West Coast hardware imports",
  scope: {
    geographicBasis: "west_coast_gateway",
    geographyLabel: "West Coast customs gateways",
    fromMonth: "2021-01",
    throughMonth: "2026-05",
    transportModes: ["vessel", "air"],
    commodityBasket: "startup_production_hardware_v1",
    notes: ["Gateway geography does not establish final destination."],
  },
  summary: "Partial answer with exact aggregate sources.",
  facts,
  findings: [
    {
      id: "opportunity",
      kind: "opportunity",
      severity: "important",
      title: "Prioritize recurring flows",
      detail: "Repeated flows provide the best process-learning surface.",
      action: "Review repeat lanes.",
      sources: [censusOtherQuery],
    },
  ],
  limitations: [
    {
      id: "company_gap",
      title: "No complete company census",
      detail: "Aggregate data does not name importers.",
      impact: "Company examples remain partial.",
      sources: [rule],
    },
  ],
  sections: [
    {
      id: "metrics",
      title: "Metrics",
      description: null,
      kind: "metrics",
      factIds: ["vessel_value"],
      findingIds: ["opportunity"],
      limitationIds: [],
    },
    {
      id: "limits",
      title: "Limits",
      description: null,
      kind: "limitations",
      factIds: [],
      findingIds: [],
      limitationIds: ["company_gap"],
    },
  ],
  generatedAt: "2026-07-22T13:00:00.000Z",
  sources: [rule, census],
});

assert.equal(document.version, 1);
assert.equal(document.status, "partial");
assert.equal(document.facts[0].sources.length, 1, "nested sources are deduplicated");
assert.deepEqual(
  document.sources.map(answerSourceKey),
  [answerSourceKey(rule), answerSourceKey(census), answerSourceKey(censusOtherQuery)],
  "document aggregates explicit, fact, finding, and limitation sources deterministically"
);
assert.deepEqual(JSON.parse(JSON.stringify(document)), document, "AnswerDocument survives a JSON round trip");

assert.throws(
  () => composeAnswerDocument({ ...document, sections: [{ ...document.sections[0], factIds: ["missing"] }] }),
  /unknown fact/,
  "section references fail closed"
);
assert.throws(
  () => composeAnswerDocument({ ...document, facts: [...document.facts, document.facts[0]] }),
  /Duplicate fact id/,
  "duplicate ids fail closed"
);
assert.throws(
  () => composeAnswerDocument({ ...document, generatedAt: "not-a-date" }),
  /generatedAt/,
  "invalid generation dates fail closed"
);

for (const file of [
  "src/lib/intel/answers/document.ts",
  "scripts/intel-answer-document.test.ts",
]) {
  assert.equal(
    fs.readFileSync(path.join(process.cwd(), file), "utf8").includes("\u2014"),
    false,
    `${file} contains no em dash character`
  );
}

console.log("All Intel AnswerDocument checks passed");
