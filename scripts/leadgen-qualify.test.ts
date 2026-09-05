import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  classifyByRule,
  cleanCompanyName,
  createOpenAiQualifier,
  qualifyCandidates,
  type QualificationInput,
} from "../src/lib/leadgen/qualify";
import { registrableDomain } from "../src/lib/leadgen/extract";

function input(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    id: "candidate-1",
    companyName: "JSW Steel",
    domain: "jsw.in",
    website: "https://jsw.in",
    country: "India",
    pageExcerpt: "Steel producer",
    evidenceUrls: ["https://jsw.in"],
    ...overrides,
  };
}

const tradeIndia = classifyByRule(input({
  companyName: "TradeIndia",
  domain: "tradeindia.com",
}));
assert(tradeIndia);
assert.equal(tradeIndia.entityType, "media_data");
assert.equal(tradeIndia.isTarget, false);

const eurofer = classifyByRule(input({
  companyName: "EUROFER",
  domain: "www.eurofer.eu",
}));
assert(eurofer);
assert.equal(eurofer.entityType, "association");

const epa = classifyByRule(input({
  companyName: "EPA",
  domain: "epa.gov",
}));
assert(epa);
assert.equal(epa.entityType, "government_academic");

const iit = classifyByRule(input({
  companyName: "IIT Bombay",
  domain: "iitb.ac.in",
}));
assert(iit);
assert.equal(iit.entityType, "government_academic");

const bmra = classifyByRule(input({
  companyName: "BMRA",
  domain: "bmra.org.uk",
}));
assert(bmra);
assert.equal(bmra.entityType, "association");

assert.equal(classifyByRule(input()), null);
assert.equal(registrableDomain("https://www.tatasteel.co.in/x"), "tatasteel.co.in");
assert.equal(cleanCompanyName("Home", "hripley.co.uk"), "Hripley");
assert.equal(
  cleanCompanyName("Scholz Recycling &#8211; Recycling. Resources. Responsibility.", "scholz-recycling.com"),
  "Scholz Recycling",
);
assert.equal(cleanCompanyName("Welcome | ASCOTEC Steel Trading", "ascotec.de"), "ASCOTEC Steel Trading");
assert.equal(cleanCompanyName("Acme &#x110000; Steel", "acme.example"), "Acme &#x110000; Steel");

async function main() {
  const candidates = [
    input({ id: "known", companyName: "TradeIndia", domain: "tradeindia.com" }),
    input({ id: "unknown", companyName: "JSW Steel", domain: "jsw.in" }),
  ];
  const calls: QualificationInput[][] = [];
  const merged = await qualifyCandidates(
    {
      objective: "Find producers",
      segments: ["steel producers"],
      regions: ["India"],
      productFocus: "Steel",
      notes: "",
    },
    candidates,
    async (_brief, remaining) => {
      calls.push(remaining);
      return [{
        id: "unknown",
        entityType: "producer",
        isTarget: true,
        sizeSignal: "large",
        displayName: "JSW Steel",
        reason: "The site identifies a steel producer.",
        confidence: 0.9,
        source: "model",
      }];
    },
  );
  assert.deepEqual(calls.map((call) => call.map((candidate) => candidate.id)), [["unknown"]]);
  assert.equal(merged.get("known")?.source, "rule");
  assert.equal(merged.get("unknown")?.entityType, "producer");

  const fallback = await qualifyCandidates(
    {
      objective: "Find producers",
      segments: ["steel producers"],
      regions: ["India"],
      productFocus: "Steel",
      notes: "",
    },
    [input({ id: "throws", companyName: "Acme - Steel" })],
    async () => {
      throw new Error("fixture failure");
    },
  );
  assert.equal(fallback.get("throws")?.source, "fallback");
  assert.equal(fallback.get("throws")?.isTarget, true);
  assert.equal(fallback.get("throws")?.displayName, "Acme - Steel");

  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "fixture-key";
  let clientCalls = 0;
  const fakeClient = {
    responses: {
      create: async () => {
        clientCalls += 1;
        throw new Error("the fake client must not be called");
      },
    },
  } as unknown as OpenAI;
  const timedOut = await createOpenAiQualifier({ client: fakeClient, batchSize: 1 })(
    {
      objective: "Find companies",
      segments: ["operating businesses"],
      regions: ["India"],
      productFocus: "Steel",
      notes: "",
    },
    [input({ id: "late-1" }), input({ id: "late-2" })],
    { deadlineAt: 100, now: () => 101 },
  );
  assert.equal(clientCalls, 0);
  assert.equal(timedOut.length, 2);
  assert(timedOut.every((result) => result.source === "fallback"));
  assert(timedOut.every((result) => result.reason === "qualification skipped: batch out of time"));
  if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousApiKey;

  console.log("leadgen qualification: all assertions passed");
}

void main();
