import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { customRestV1Adapter } from "../src/lib/supply-os/connector-custom-rest";
import { SupplyConnectorError } from "../src/lib/supply-os/connector-contract";

const secretRef = "TEST_SUPPLY_CONNECTOR_SECRET";
const priorSecret = process.env[secretRef];
process.env[secretRef] = JSON.stringify({ clientId: "fixture-client", clientSecret: "fixture-secret" });

const config = customRestV1Adapter.validateConfig({
  tokenUrl: "/oauth/token",
  resourcePaths: {
    locations: "/locations",
    items: "/items",
    bom: false,
    inventory: "/inventory",
    demand: "/demand",
    purchaseOrders: false,
    supplierTerms: "/supplier-terms",
    complianceRecords: false,
  },
});

const requests: string[] = [];
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
  if (url.pathname === "/oauth/token") {
    assert.equal(init?.method, "POST");
    assert.match(String(init?.body), /grant_type=client_credentials/);
    return Response.json({ access_token: "fixture-access-token", expires_in: 3600 });
  }
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-access-token");
  if (url.pathname === "/locations") return Response.json({ data: [{ id: "loc-1", locationKey: "AUS", name: "Austin", kind: "FACTORY", countryCode: "US" }] });
  if (url.pathname === "/items" && !url.searchParams.has("cursor")) return Response.json({ data: [{ id: "item-1", itemKey: "RADIO", sku: "RADIO", name: "Radio module", unitOfMeasure: "EA" }], nextCursor: "page-2" });
  if (url.pathname === "/items") return Response.json({ data: [{ id: "item-2", itemKey: "LIDAR", sku: "LIDAR", name: "Safety lidar", unitOfMeasure: "EA" }], syncToken: "sync-42", sourceVersion: "client-v42" });
  if (url.pathname === "/inventory") return Response.json({ data: [{ positionKey: "inv-1", itemKey: "RADIO", locationKey: "AUS", quantityOnHand: 4, quantityAllocated: 1, quantityInTransit: 2, quantityOnOrder: 0, unitOfMeasure: "EA", asOf: "2026-08-11T12:00:00Z" }] });
  if (url.pathname === "/demand") return Response.json({ data: [{ demandKey: "dem-1", itemKey: "RADIO", locationKey: "AUS", quantity: 10, unitOfMeasure: "EA", dueAt: "2026-08-20T12:00:00Z" }] });
  if (url.pathname === "/supplier-terms") return Response.json({ data: [{ termKey: "term-1", itemKey: "RADIO", supplierName: "Recorded Supplier", isCurrent: true, unitPrice: 42, currency: "USD", leadTimeDays: 10, facilityKey: "AUS" }] });
  return new Response("Not found", { status: 404 });
};

async function main() {
try {
  const result = await customRestV1Adapter.pull({
    installationId: "connector-1",
    baseUrl: "https://client.example/",
    secretRef,
    config,
    inputCursor: null,
    traceId: "trace-1",
    fetcher,
  });
  assert.equal(result.normalized.locations.length, 1);
  assert.equal(result.normalized.items.length, 2, "pagination should collect every item page");
  assert.equal(result.normalized.inventory[0]?.quantityOnHand, 4);
  assert.equal(result.normalized.demand[0]?.quantity, 10);
  assert.equal(result.normalized.supplierTerms[0]?.isCurrent, true);
  assert.deepEqual(result.outputCursor, { syncToken: "sync-42" });
  assert.equal(result.sourceVersion, "client-v42");
  assert.ok(requests.includes("GET /items?cursor=page-2"));

  await assert.rejects(
    () => customRestV1Adapter.pull({
      installationId: "connector-rate",
      baseUrl: "https://client.example/",
      secretRef,
      config,
      inputCursor: null,
      traceId: "trace-rate",
      fetcher: async () => new Response(null, { status: 429 }),
    }),
    (error: unknown) => error instanceof SupplyConnectorError && error.code === "RATE_LIMITED" && error.retryable,
  );

  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert.match(schema, /model ConnectorInstallation \{/);
  assert.match(schema, /secretRef\s+String/);
  assert.doesNotMatch(schema, /clientSecret\s+String/);
  const service = readFileSync("src/lib/supply-os/connectors.ts", "utf8");
  assert.match(service, /publishSupplyImportForOffice/);
  assert.match(service, /status: "RUNNING"/);
  assert.match(service, /currentCursor: result\.outputCursor/);
  console.log("Supply OS connector contract passed.");
} finally {
  if (priorSecret === undefined) delete process.env[secretRef];
  else process.env[secretRef] = priorSecret;
}
}

void main();
