import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createGetleadClient, deliverCompaniesGuarded, deliverContactsGuarded, GetleadApiError, type GetleadClient } from "../src/lib/world/getlead/client";
import { classifyMailbox } from "../src/lib/world/getlead/contacts";
import { normalizeGetleadCompany, normalizeGetleadContactCompany } from "../src/lib/world/sources/getlead";
import { getGetleadContactRows, getGetleadJobId } from "../src/lib/world/getlead/raw";
import { buildCompanyPromotion } from "../src/lib/world/promote";

async function main() {
  const fixture = JSON.parse(await readFile("scripts/fixtures/getlead.json", "utf8")) as {
    manufacturerCompany: Record<string, unknown>;
    serviceCompany: Record<string, unknown>;
    contactCompany: Record<string, unknown>;
    steelSignsCompany: Record<string, unknown>;
    industrialAutomationCompany: Record<string, unknown>;
  };
  const calls: string[] = [];
  const fakeFetch = async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/search/count")) {
      return new Response(JSON.stringify({
        people: 2,
        companies: 1,
        with_email: 2,
        unsupported: [],
      }), { status: 200 });
    }
    if (url.endsWith("/search/deliver")) {
      return new Response(JSON.stringify({
        job_id: "job-1",
        status: "queued",
        requested: 2,
        estimated_cents: 2,
      }), { status: 200 });
    }
    if (url.includes("/jobs/job-1")) {
      const parsed = new URL(url);
      const offset = parsed.searchParams.get("offset");
      if (calls.filter((call) => call.includes("/jobs/job-1")).length === 1) {
        return new Response(JSON.stringify({
          status: "queued",
          requested: 2,
          drawn: 0,
          probed: 0,
          delivered: 0,
          charged_cents: 0,
          rows: [],
          total_rows: 2,
        }), { status: 200 });
      }
      if (offset === "0") {
        return new Response(JSON.stringify({
          status: "done",
          requested: 2,
          drawn: 2,
          probed: 2,
          delivered: 2,
          charged_cents: 2,
          rows: [{ email: "one@example.com" }],
          total_rows: 2,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        status: "done",
        requested: 2,
        drawn: 2,
        probed: 2,
        delivered: 2,
        charged_cents: 2,
        rows: [{ email: "two@example.com" }],
        total_rows: 2,
      }), { status: 200 });
    }
    if (url.endsWith("/companies/count")) {
      return new Response(JSON.stringify({ companies: 2, with_email: 2 }), { status: 200 });
    }
    if (url.endsWith("/companies/deliver")) {
      return new Response(JSON.stringify({
        job_id: "company-job",
        rows: [],
        delivered: 2,
        charged_cents: 1,
      }), { status: 200 });
    }
    throw new Error(`Unexpected fake URL ${url} ${init?.method ?? "GET"}`);
  };
  const client = createGetleadClient({
    apiKey: "test-key",
    baseUrl: "https://fake.getlead.test",
    fetch: fakeFetch,
  });
  const delivery = await client.searchDeliver({}, 2);
  assert.equal(delivery.job_id, "job-1");
  const queued = await client.waitForJob("job-1", { pollMs: 0, sleep: async () => undefined });
  assert.equal(queued.status, "done");
  const rows = await client.fetchJobRows("job-1");
  assert.deepEqual(rows.map((row) => row.email), ["one@example.com", "two@example.com"]);
  const companyDelivery = await client.companiesDeliver({}, 2);
  assert.equal(companyDelivery.delivered, 2);
  assert.ok(calls.every((call) => !call.includes("test-key")));

  let deliverCalls = 0;
  const guardedClient = {
    ...client,
    searchCount: async () => ({ with_email: 10, unsupported: ["unknown_filter"] }),
    searchDeliver: async () => {
      deliverCalls += 1;
      return delivery;
    },
  } satisfies GetleadClient;
  await assert.rejects(
    deliverContactsGuarded({ client: guardedClient, filters: {}, limit: 10, maxCents: 100 }),
    /Unsupported Getlead filters/,
  );
  assert.equal(deliverCalls, 0);

  const budgetClient = {
    ...client,
    searchCount: async () => ({ with_email: 10, unsupported: [] }),
    searchDeliver: async () => {
      deliverCalls += 1;
      return delivery;
    },
  } satisfies GetleadClient;
  await assert.rejects(
    deliverContactsGuarded({ client: budgetClient, filters: {}, limit: 10, maxCents: 1 }),
    /exceeds the configured budget/,
  );
  assert.equal(deliverCalls, 0);

  const companyBudgetClient = {
    ...client,
    companiesCount: async () => ({ companies: 100, with_email: 0, unsupported: [] }),
    companiesDeliver: async () => {
      deliverCalls += 1;
      return companyDelivery;
    },
  } satisfies GetleadClient;
  await assert.rejects(
    deliverCompaniesGuarded({ client: companyBudgetClient, filters: {}, limit: 100, maxCents: 1 }),
    /exceeds the configured budget/,
  );
  assert.equal(deliverCalls, 0);

  const api402 = createGetleadClient({
    apiKey: "test-key",
    fetch: async () => new Response(JSON.stringify({ message: "payment required" }), { status: 402 }),
  });
  await assert.rejects(api402.usage(), (error: unknown) => (
    error instanceof GetleadApiError && error.status === 402 && error.message === "payment required"
  ));

  const manufacturer = normalizeGetleadCompany(fixture.manufacturerCompany);
  const service = normalizeGetleadCompany(fixture.serviceCompany);
  const contactCompany = normalizeGetleadContactCompany(fixture.contactCompany);
  assert.equal(manufacturer?.source, "getlead");
  assert.equal(manufacturer?.domain, "yunming-metal.com");
  assert.equal(manufacturer?.isManufacturer, true);
  assert.equal(
    Array.isArray(manufacturer?.manufacturerEvidence)
      && (manufacturer.manufacturerEvidence[0] as { source?: string }).source === "getlead",
    true,
  );
  assert.equal(service?.isManufacturer, false);
  assert.equal(contactCompany?.domain, "bluefinrobotics.com");
  assert.equal(contactCompany?.country, "US");
  assert.equal(contactCompany?.isManufacturer, true);
  assert.equal(normalizeGetleadCompany(fixture.steelSignsCompany)?.isManufacturer, false);
  assert.equal(normalizeGetleadContactCompany(fixture.industrialAutomationCompany)?.isManufacturer, true);
  assert.equal(classifyMailbox("a@gmail.com", "example.com"), "freemail");
  assert.equal(classifyMailbox("a@example.com", "example.com"), "company");
  assert.equal(classifyMailbox("a@other.com", "example.com"), "other_domain");
  const harnessRaw = {
    project: "dreamz-robotics-automation-cnc",
    job: {
      job_id: "harness-job",
      rows: [{ email: "one@example.com" }],
    },
  };
  assert.deepEqual(getGetleadContactRows(harnessRaw), harnessRaw.job.rows);
  assert.equal(getGetleadJobId(harnessRaw), "harness-job");

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
    legalIds: { getlead: "acme.test" },
    industryCodes: null,
    isManufacturer: false,
    manufacturerEvidence: null,
    sizeBand: null,
    foundedYear: null,
    linkedinUrl: null,
    website: "https://acme.test",
    entityStatus: null,
    sourceCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assert.deepEqual(promotion.sourceRefs.sources, ["getlead"]);
  console.log("world getlead unit tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
