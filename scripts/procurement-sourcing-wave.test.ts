import assert from "node:assert/strict";

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

async function main() {
  const { runProcurementSupplierSourcingWave, crawlSupplierSite, SupplierSourcingError } = await import(
    "../src/lib/procurement-supplier-sourcing"
  );

  const pages = new Map<string, FakePage>([
    ["https://polymerlabs.example/", page("https://polymerlabs.example/", MOLDER_HOME)],
    ["https://polymerlabs.example/capabilities", page("https://polymerlabs.example/capabilities", MOLDER_CAPABILITIES)],
    ["https://polymerlabs.example/contact", page("https://polymerlabs.example/contact", MOLDER_CONTACT)],
    ["https://dallasfoam.example/", page("https://dallasfoam.example/", CONVERTER_HOME)],
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
  });
  assert.equal(repeat.added, 0);
  assert.equal(inserted.length, 0, "a repeated wave loads nobody twice");
  assert.equal(repeat.examined, 0, "already known domains are not even fetched");

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

  await assert.rejects(
    runProcurementSupplierSourcingWave({
      orderId: order.orderId,
      target: 5,
      proposers: proposers as never,
      loadOrder: (async () => ({ ...order, material: "Anodized aluminum bracket", specification: null })) as never,
    }),
    (error: unknown) => error instanceof SupplierSourcingError && error.code === "unsupported_category",
    "a request with no capability gate must not start a wave",
  );
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
