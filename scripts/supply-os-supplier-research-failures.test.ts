import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import {
  searchComponentSuppliers,
  SupplierResearchError,
  supplierResearchError,
} from "../src/lib/supply-os/component-supplier-research";

const root = process.cwd();
const service = readFileSync(resolve(root, "src/lib/supply-os/component-supplier-research.ts"), "utf8");
const route = readFileSync(resolve(root, "src/app/api/supply-os/supplier-research/route.ts"), "utf8");
const routeContract = readFileSync(resolve(root, "src/lib/supply-os/supplier-research-route-contract.ts"), "utf8");
const legacyWorkspaceRoute = resolve(root, "src/app/api/supply-os/workspaces/[workspaceId]/supplier-research/route.ts");
const procurement = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-procurement-workspace.tsx"), "utf8");
const persistence = readFileSync(resolve(root, "src/lib/supply-os/sourcing-research-persistence.ts"), "utf8");

assert.deepEqual(
  ["MISSING_CONFIGURATION", "PROVIDER_TIMEOUT", "PROVIDER_FAILURE", "PROVIDER_RESPONSE_TOO_LARGE", "INVALID_STRUCTURED_RESPONSE"]
    .map((code) => {
      const failure = new SupplierResearchError(code as ConstructorParameters<typeof SupplierResearchError>[0]);
      return [failure.code, failure.status, failure.message];
    }),
  [
    ["MISSING_CONFIGURATION", 503, "Public supplier research is not configured."],
    ["PROVIDER_TIMEOUT", 504, "Public supplier research timed out."],
    ["PROVIDER_FAILURE", 502, "Public supplier research provider failed."],
    ["PROVIDER_RESPONSE_TOO_LARGE", 502, "Public supplier research returned too much data."],
    ["INVALID_STRUCTURED_RESPONSE", 502, "Public supplier research returned an invalid response."],
  ],
);

const timeout = supplierResearchError(new OpenAI.APIConnectionTimeoutError());
assert.equal(timeout.code, "PROVIDER_TIMEOUT");
assert.equal(supplierResearchError(new OpenAI.APIUserAbortError()).code, "PROVIDER_TIMEOUT");
assert.equal(supplierResearchError(new DOMException("The operation was aborted", "AbortError")).code, "PROVIDER_TIMEOUT");
assert.equal(supplierResearchError(new Error("secret upstream detail")).code, "PROVIDER_FAILURE");
assert.doesNotMatch(supplierResearchError(new Error("secret upstream detail")).message, /secret/i);

assert.match(service, /const OPENAI_RESEARCH_TIMEOUT_MS = 60_000/);
assert.match(service, /timeout: OPENAI_RESEARCH_TIMEOUT_MS,[\s\S]*maxRetries: 0/);
assert.match(service, /signal: AbortSignal\.timeout\(OPENAI_RESEARCH_TIMEOUT_MS\)/, "the outer abort must cover response-body parsing as well as time to first byte");
assert.match(service, /store: false/);
assert.doesNotMatch(service, /researchObservedAt/);
assert.match(service, /trustClaimedObservedAt: false/);
assert.match(service, /process\.env\.EXA_API_KEY/);
assert.match(service, /searchExaComponentSuppliers/);
assert.doesNotMatch(service, /verifyCurrentSupplierPrices/);
assert.match(service, /const actionUrl = publicUrl\(action\.url\)/);
assert.match(route, /executeSupplierResearchRoute/);
assert.match(routeContract, /failRun\([\s\S]*failure\.code/);
assert.match(routeContract, /status: failure\.status/);
assert.equal(
  existsSync(legacyWorkspaceRoute),
  false,
  "workspace research must use the persisted canonical route instead of a read-only untracked back door",
);
assert.match(procurement, /setResearchAttempt\(\(current\) => current \+ 1\)/);
assert.match(procurement, /researchAttempt, workspaceId/);
assert.match(procurement, /workspaceId \? \[\] : buildProcurementOptions\(item\)/);
assert.match(persistence, /\{ maxWait: 5_000, timeout: 45_000 \}/, "research knowledge persistence needs an explicit transaction budget");
assert.match(persistence, /pg_advisory_xact_lock\(hashtextextended\(\$\{`supply-research:/, "supplier profile expansion must serialize per workspace");

async function main() {
  const slowBodyClient = new OpenAI({
    apiKey: "fixture-key",
    timeout: 1_000,
    maxRetries: 0,
    fetch: async (_request, init) => {
      const signal = init?.signal;
      assert.ok(signal, "the SDK must forward the request signal to fetch");
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const delayedBody = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          }, 250);
          signal.addEventListener("abort", () => {
            clearTimeout(delayedBody);
            controller.error(new DOMException("Response body aborted", "AbortError"));
          }, { once: true });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    () => slowBodyClient.responses.create(
      { model: "fixture-model", input: "fixture input" },
      { signal: AbortSignal.timeout(25) },
    ),
    (error: unknown) => error instanceof DOMException
      && error.name === "AbortError"
      && supplierResearchError(error).code === "PROVIDER_TIMEOUT",
    "an external timeout during OpenAI response-body parsing must remain a provider timeout",
  );

  const priorKey = process.env.OPENAI_API_KEY;
  const priorExaKey = process.env.EXA_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.EXA_API_KEY;
  await assert.rejects(
    () => searchComponentSuppliers({
      officeId: "office-test",
      workspaceId: "workspace-test",
      componentItemKey: "request:test",
      componentName: "Test component",
    }),
    (error: unknown) => error instanceof SupplierResearchError
      && error.code === "MISSING_CONFIGURATION"
      && error.status === 503,
  );
  if (priorKey) process.env.OPENAI_API_KEY = priorKey;
  if (priorExaKey) process.env.EXA_API_KEY = priorExaKey;
  console.log("Supply OS supplier research failure contract passed.");
}

void main();
