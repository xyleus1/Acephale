import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test?sslmode=require";

type FakePage = { url: string; status: number; body: string; isPdf: boolean };

function page(url: string, body: string): FakePage {
  return { url, status: 200, body, isPdf: false };
}

const MOLDER_HOME = `
  <html><head><title>Polymer Laboratories | Molded Foam</title></head><body>
  <a href="/capabilities">Capabilities</a>
  <a href="/contact">Contact</a>
  <a href="/blog/2026/news">News</a>
  <p>Polymer Laboratories molds polyurethane and viscoelastic foam components for OEM customers.</p>
  </body></html>
`;
const MOLDER_CAPABILITIES = `
  <html><body>
  <p>Molded foam production runs on our own in house tooling. We build aluminum molds in our tool shop, run
  poured in place foam cells, and formulate polyol and isocyanate chemistry to a target density and ILD for
  memory foam parts. Send a CAD or STL file to request a quote. We are a contract manufacturer with two
  production lines and cavity tooling for cast viscoelastic parts.</p>
  </body></html>
`;
const MOLDER_CONTACT = `
  <html><body><p>Request a quote: <a href="mailto:rfq@polymerlabs.example">rfq@polymerlabs.example</a>,
  or sales@polymerlabs.example. Molded foam tooling questions welcome.</p></body></html>
`;
const CONVERTER_HOME = `
  <html><head><title>Dallas Foam Fabricators</title></head><body>
  <p>We cut, laminate, and CNC route polyurethane foam blocks and sheets. Foam fabrication and packaging
  inserts cut to size. No molding is done in house. Email quotes@dallasfoam.example for a fabrication quote,
  we convert foam rolls, sheets, and blocks for industrial customers across Texas every day.</p>
  </body></html>
`;

const MULTI_CONTACT_HOME = [
  "Hydraulic Fittings Factory manufactures stainless steel hydraulic fittings and tube adapters.",
  "Our OEM production facility is an ISO 9001 certified contract manufacturer.",
  "Request a quote for prototypes, production runs, capacity planning, and lead time.",
  "We support export documentation and worldwide shipping for industrial customers.",
  "Contact sales@hydraulic.example, rfq@hydraulic.example, info@hydraulic.example, and ops@hydraulic.example.",
].join(" ").padEnd(600, " ");
const TOP_UP_CONTACT_HOME = MULTI_CONTACT_HOME.replace(
  "sales@hydraulic.example, rfq@hydraulic.example, info@hydraulic.example, and ops@hydraulic.example",
  "quotes@topup.example, sales@topup.example, info@topup.example, ops@topup.example, and engineering@topup.example",
).replace("Hydraulic Fittings Factory", "Top Up Fittings Factory");

async function main() {
  const sourcingSource = readFileSync(
    new URL("../src/lib/procurement-supplier-sourcing.ts", import.meta.url),
    "utf8",
  );
  assert.match(sourcingSource, /lower\(coalesce\(existing\.contact_email, existing\.email, ''\)\) = lower\(\$6\)/);
  assert.match(sourcingSource, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.match(sourcingSource, /SELECT count\(\*\)[\s\S]*e2\.website ~\* \('\(\^\|\[\.\/@\]\)' \|\| \$8 \|\| '\(\[\/:\?#\]\|\$\)'\)[\s\S]*< \$9::int/);
  assert.match(sourcingSource, /registrableDomain\(args\.site\.domain\)/);

  const { runProcurementSupplierSourcingWave, crawlSupplierSite, SupplierSourcingError } = await import(
    "../src/lib/procurement-supplier-sourcing"
  );

  const pages = new Map<string, FakePage>([
    ["https://polymerlabs.example/", page("https://polymerlabs.example/", MOLDER_HOME)],
    ["https://polymerlabs.example/capabilities", page("https://polymerlabs.example/capabilities", MOLDER_CAPABILITIES)],
    ["https://polymerlabs.example/contact", page("https://polymerlabs.example/contact", MOLDER_CONTACT)],
    ["https://dallasfoam.example/", page("https://dallasfoam.example/", CONVERTER_HOME)],
    ["https://hydraulic.example/", page("https://hydraulic.example/", MULTI_CONTACT_HOME)],
  ]);
  const fetched: string[] = [];
  const fetchPage = async (url: string) => {
    fetched.push(url);
    return pages.get(url) ?? null;
  };

  // The crawler reads the capability and contact pages, not the blog.
  const site = await crawlSupplierSite("https://polymerlabs.example/", fetchPage as never);
  assert.ok(site, "a reachable site must crawl");
  assert.equal(site.domain, "polymerlabs.example");
  assert.equal(site.companyName, "Polymer Laboratories");
  assert.ok(site.emails.includes("rfq@polymerlabs.example"), "published addresses are collected");
  assert.equal(fetched.includes("https://polymerlabs.example/blog/2026/news"), false, "only capability pages are crawled");
  assert.ok(site.sourceUrls.length >= 2, "provenance keeps every page the evidence came from");
  assert.equal(await crawlSupplierSite("https://missing.example/", fetchPage as never), null);

  const order = {
    orderId: "e3f6cacc-ca34-4d01-a787-c09da6805bce",
    customerId: "cmt1rgth70006rn8tvneq4dha",
    officeId: "office-1",
    companyName: "HypnoDreamz",
    material: "Molded viscoelastic memory foam insert",
    specification: "Cast foam part, 280 x 105 x 11.5 mm",
    quantity: "100",
    unit: "units",
    neededBy: null,
    notes: null,
  };
  const proposals = [
    { domain: "polymerlabs.example", url: "https://polymerlabs.example/", via: "test" },
    { domain: "dallasfoam.example", url: "https://dallasfoam.example/", via: "test" },
    { domain: "broken.example", url: "https://broken.example/", via: "test" },
  ];
  const proposers = [{
    name: "test",
    propose: async (input: { excludeDomains?: readonly string[] }) =>
      proposals.filter((entry) => !(input.excludeDomains ?? []).includes(entry.domain)),
  }];
  const verify = async (email: string) => ({
    email,
    verdict: "deliverable_likely" as const,
    confidence: 0.8,
    hasMx: true,
    isRole: true,
    domainMatchesCompany: true,
    reasons: [],
  });
  const inserted: string[] = [];
  const insertVendor = async (args: { contactEmail: string }) => {
    inserted.push(args.contactEmail);
    return `vendor-${inserted.length}`;
  };

  const wave = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.equal(wave.category, "molded-foam");
  assert.equal(wave.added, 1, "only the molder is loaded");
  assert.deepEqual(inserted, ["rfq@polymerlabs.example"], "the RFQ address is preferred over the generic one");
  assert.ok(
    wave.rejected.some((entry) => entry.domain === "dallasfoam.example"),
    "a foam converter is rejected with its reason",
  );
  assert.ok(
    wave.rejected.some((entry) => entry.domain === "broken.example" && /could not be read/.test(entry.reason)),
    "an unreadable site is recorded, not silently dropped",
  );
  assert.ok(wave.additions[0]!.matched.length >= 3, "the loaded supplier keeps its capability evidence");
  assert.equal(wave.discoveryExhausted, true, "the wave stops once discovery repeats itself");

  // A discovery provider that fails, for example an exhausted search API quota,
  // must not end the wave while another provider still answers.
  inserted.length = 0;
  const failing = {
    name: "failing-provider",
    propose: async () => {
      throw new Error("provider quota exhausted");
    },
  };
  const survived = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 1,
    proposers: [failing, ...proposers] as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.equal(survived.added, 1, "a failing provider falls through to the next one");
  assert.ok(
    survived.providerFailures.includes("failing-provider"),
    "the failing provider is recorded for the audit trail",
  );

  // A row the database refuses used to throw away the whole wave, including the
  // suppliers it had already qualified and the RFQ sends they had earned, so the
  // failure belongs to that supplier and the wave keeps its result.
  inserted.length = 0;
  const unsaved = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: (async () => {
      throw new Error("Timed out fetching a new connection from the connection pool");
    }) as never,
  });
  assert.equal(unsaved.added, 0, "a supplier that cannot be saved is not counted");
  assert.ok(
    unsaved.rejected.some((entry) =>
      entry.domain === "polymerlabs.example"
      && entry.reason === "the supplier could not be saved: the database connection failed"),
    "the failure class is recorded, without the driver text",
  );
  assert.deepEqual(
    unsaved.persistenceFailures,
    ["polymerlabs.example"],
    "a database that is down is reported as an outage, not as a rejected supplier",
  );
  assert.equal(
    unsaved.nextRound,
    unsaved.startRound,
    "the cursor stays put, so the retry searches the phrases whose suppliers were never saved",
  );

  // A row this supplier will never pass is that supplier's problem, so the wave
  // rejects it and keeps crawling the rest of the round.
  const rejectedRow = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: (async () => {
      throw new Error("value too long for type character varying(120)");
    }) as never,
  });
  assert.deepEqual(rejectedRow.persistenceFailures, [], "a row level failure is not an outage");

  // A schema mismatch is about the deployment, so it stops the slice instead of
  // rejecting every supplier the wave qualified.
  const schemaGone = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: (async () => {
      throw new Error('The column `Vendor.discoveredVia` does not exist in the current database.');
    }) as never,
  });
  assert.equal(schemaGone.persistenceFailures.length, 1, "a schema mismatch stops the slice");
  assert.ok(
    schemaGone.rejected.some((entry) =>
      entry.reason === "the supplier could not be saved: the database schema did not match"),
    "the schema mismatch is reported as its own class",
  );
  assert.ok(
    rejectedRow.rejected.some((entry) =>
      entry.reason === "the supplier could not be saved: the database rejected the row"),
    "the row is rejected with its class and the wave continues",
  );

  // A wave stops on its time budget instead of being killed by the platform.
  inserted.length = 0;
  const expired = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    deadlineAt: Date.now() - 1,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.equal(expired.timedOut, true, "an expired budget stops the wave and says so");
  assert.equal(expired.added, 0);
  assert.deepEqual(inserted, [], "no supplier is written after the budget is spent");

  // One hanging provider call must not eat the whole slice: the call is dropped
  // at the deadline, the wave reports the timeout, and it returns on its own.
  inserted.length = 0;
  const hanging = {
    name: "hanging-provider",
    propose: () => new Promise<never>(() => {}),
  };
  const startedAt = Date.now();
  const capped = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 1,
    // Far shorter than the call cap, so the deadline is what stops the call.
    deadlineAt: Date.now() + 300,
    proposers: [hanging] as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.ok(Date.now() - startedAt < 5_000, "the wave returned without waiting on the hanging call");
  assert.equal(capped.timedOut, true, "a call abandoned on the deadline is reported as a timeout");
  assert.ok(
    capped.providerFailures.includes("hanging-provider"),
    "the provider that outlasted its budget is recorded",
  );
  assert.deepEqual(inserted, [], "nothing is written when discovery never answered");

  // Suppliers already on the request are never proposed, crawled, or mailed twice.
  inserted.length = 0;
  const repeatReconciliationCalls: Array<{ customerId: string; orderId: string; officeId: string }> = [];
  const repeat = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({
      domains: new Set(["polymerlabs.example", "dallasfoam.example", "broken.example"]),
      emails: new Set(["rfq@polymerlabs.example"]),
    })) as never,
    insertVendor: insertVendor as never,
    reconcileStatus: (async (args) => {
      repeatReconciliationCalls.push(args);
      return "researching";
    }) as never,
  });
  assert.equal(repeat.added, 0);
  assert.equal(inserted.length, 0, "a repeated wave loads nobody twice");
  assert.equal(repeat.examined, 0, "already known domains are not even fetched");
  assert.deepEqual(repeatReconciliationCalls, [{
    customerId: order.customerId,
    orderId: order.orderId,
    officeId: order.officeId,
  }], "a repeat wave reconciles persisted supplier facts once");

  // A continuation slice has to search phrases the earlier slices never used,
  // and one search that returns nothing new must not end the wave while curated
  // phrases are left. Without this every queued slice repeated the first search,
  // proposed only known domains, and the wave stopped after one slice.
  inserted.length = 0;
  const asked: string[] = [];
  const barrenThenFinding = [{
    name: "phrase-recorder",
    propose: async (input: { query: string; excludeDomains?: readonly string[] }) => {
      asked.push(input.query);
      if (asked.length <= 2) return [];
      return proposals.filter((entry) => !(input.excludeDomains ?? []).includes(entry.domain));
    },
  }];
  const resumed = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 1,
    startRound: 5,
    proposers: barrenThenFinding as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.equal(resumed.startRound, 5, "a wave reports where it resumed");
  assert.ok(resumed.nextRound > 5, "the wave hands the next phrase round forward");
  assert.equal(resumed.added, 1, "an empty search does not end a wave that still has phrases");
  assert.equal(resumed.discoveryExhausted, false, "phrases were still left when the wave stopped");
  const firstRoundQueries = (await import("../src/lib/supply-os/supplier-sourcing-category"))
    .supplierSourcingQueries(
      (await import("../src/lib/supply-os/supplier-sourcing-category")).SUPPLIER_SOURCING_CATEGORIES
        .find((entry) => entry.key === "molded-foam")!,
      0,
      2,
    );
  assert.ok(
    asked.every((query) => !firstRoundQueries.includes(query)),
    "a resumed wave does not repeat the phrases the first slice already searched",
  );

  // A round cut short by the deadline is retried, not skipped: its phrases were
  // never searched, so the cursor must stay where it was.
  const cutShort = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 1,
    startRound: 3,
    deadlineAt: Date.now() + 300,
    proposers: [hanging] as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.equal(cutShort.timedOut, true);
  assert.equal(cutShort.nextRound, 3, "an unsearched round is handed back, not skipped");

  // Same for a round where every provider failed, for example on a spent search
  // quota: nobody searched those phrases, so the cursor must not move past them.
  const allFailed = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 1,
    startRound: 2,
    proposers: [failing] as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.equal(allFailed.nextRound, 2, "a round every provider failed on is retried, not skipped");

  // A losing insert race is reported as a duplicate rather than counted.
  const raced = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: (async () => null) as never,
  });
  assert.equal(raced.added, 0);
  assert.ok(raced.rejected.some((entry) => /already on this request/.test(entry.reason)));

  // An address that fails deliverability screening is not loaded.
  const undeliverable = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 10,
    proposers: proposers as never,
    fetchPage: fetchPage as never,
    verify: (async (email: string) => ({
      email,
      verdict: "undeliverable" as const,
      confidence: 0.1,
      hasMx: false,
      isRole: true,
      domainMatchesCompany: true,
      reasons: ["no mx"],
    })) as never,
    loadOrder: (async () => order) as never,
    loadExistingKeys: (async () => ({ domains: new Set<string>(), emails: new Set<string>() })) as never,
    insertVendor: insertVendor as never,
  });
  assert.equal(undeliverable.added, 0);
  assert.ok(undeliverable.rejected.some((entry) => /deliverability/.test(entry.reason)));

  const derivedOrder = { ...order, material: "stainless steel hydraulic fittings", specification: null };
  const derivedWave = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 5,
    proposers: [{ name: "empty", propose: async () => [] }] as never,
    loadOrder: (async () => derivedOrder) as never,
    loadExistingKeys: (async () => ({ domains: new Map<string, number>(), emails: new Set<string>() })) as never,
  });
  assert.equal(derivedWave.categorySource, "derived", "unknown materials use a deterministic derived profile");

  const multiProposer = [{
    name: "multi-contact",
    propose: async () => [{ domain: "hydraulic.example", url: "https://hydraulic.example/", via: "test" }],
  }];
  const multiInserted: string[] = [];
  const multiInsert = async (args: { contactEmail: string }) => {
    multiInserted.push(args.contactEmail);
    return `hydraulic-vendor-${multiInserted.length}`;
  };
  const multiWave = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 5,
    contactsPerCompany: 3,
    proposers: multiProposer as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => derivedOrder) as never,
    loadExistingKeys: (async () => ({ domains: new Map<string, number>(), emails: new Set<string>() })) as never,
    insertVendor: multiInsert as never,
  });
  assert.equal(multiWave.added, 1);
  assert.equal(multiWave.contactsAdded, 3);
  assert.equal(multiInserted.length, 3);
  const fourthPass = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 5,
    contactsPerCompany: 3,
    proposers: multiProposer as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => derivedOrder) as never,
    loadExistingKeys: (async () => ({
      domains: new Map([["hydraulic.example", 3]]),
      emails: new Set(multiInserted),
    })) as never,
    insertVendor: multiInsert as never,
  });
  assert.equal(fourthPass.added, 0);
  assert.equal(fourthPass.contactsAdded, 0);
  assert.equal(multiInserted.length, 3);
  const singleContact = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 5,
    contactsPerCompany: 1,
    proposers: multiProposer as never,
    fetchPage: fetchPage as never,
    verify: verify as never,
    loadOrder: (async () => derivedOrder) as never,
    loadExistingKeys: (async () => ({ domains: new Map<string, number>(), emails: new Set<string>() })) as never,
    insertVendor: multiInsert as never,
  });
  assert.equal(singleContact.added, 1);
  assert.equal(singleContact.contactsAdded, 1);

  const topUpInserted: string[] = [];
  const topUpVerified: string[] = [];
  const topUpVerify = async (email: string) => {
    topUpVerified.push(email);
    return {
      email,
      verdict: email === "quotes@topup.example" ? "risky" as const : "deliverable_likely" as const,
      confidence: 0.8,
      hasMx: true,
      isRole: true,
      domainMatchesCompany: true,
      reasons: email === "quotes@topup.example" ? ["risky inbox"] : [],
    };
  };
  const topUpWave = await runProcurementSupplierSourcingWave({
    orderId: order.orderId,
    target: 5,
    contactsPerCompany: 4,
    proposers: [{
      name: "top-up",
      propose: async () => [{ domain: "topup.example", url: "https://topup.example/", via: "test" }],
    }] as never,
    fetchPage: (async (url: string) => (
      url === "https://topup.example/" ? page(url, TOP_UP_CONTACT_HOME) : null
    )) as never,
    verify: topUpVerify as never,
    loadOrder: (async () => derivedOrder) as never,
    loadExistingKeys: (async () => ({ domains: new Map<string, number>(), emails: new Set<string>() })) as never,
    insertVendor: (async (args: { contactEmail: string }) => {
      topUpInserted.push(args.contactEmail);
      return `top-up-vendor-${topUpInserted.length}`;
    }) as never,
  });
  assert.equal(topUpWave.added, 1);
  assert.equal(topUpWave.contactsAdded, 4);
  assert.equal(topUpVerified.length, 5);
  assert.deepEqual([...topUpInserted].sort(), [
    "sales@topup.example",
    "info@topup.example",
    "ops@topup.example",
    "engineering@topup.example",
  ].sort());
  await assert.rejects(
    runProcurementSupplierSourcingWave({
      orderId: order.orderId,
      target: 5,
      proposers: proposers as never,
      loadOrder: (async () => null) as never,
    }),
    (error: unknown) => error instanceof SupplierSourcingError && error.code === "not_found",
  );

  console.log("procurement sourcing wave contract passed");
}

void main();
