import assert from "node:assert/strict";
import { searchComponentSuppliers } from "../src/lib/supply-os/component-supplier-research";
import { GUILD_PROCUREMENT_BOM, REPRESENTATIVE_LIVE_RESEARCH_IDS, type ProcurementAcceptanceItem } from "./fixtures/guild-procurement-bom";

type ResearchResult = Awaited<ReturnType<typeof searchComponentSuppliers>>;

function hasAttributableListingClaim(result: ResearchResult) {
  return result.candidates.some((candidate) => {
    if (
      candidate.price.state !== "SUPPORTED"
      || candidate.currency.state !== "SUPPORTED"
      || candidate.unitOfMeasure.state !== "SUPPORTED"
      || candidate.price.freshness !== "UNKNOWN"
      || candidate.currency.freshness !== "UNKNOWN"
      || candidate.unitOfMeasure.freshness !== "UNKNOWN"
      || typeof candidate.price.value !== "number"
      || !Number.isFinite(candidate.price.value)
      || candidate.price.value <= 0
      || typeof candidate.currency.value !== "string"
      || !/^[A-Z]{3}$/.test(candidate.currency.value.toUpperCase())
      || typeof candidate.unitOfMeasure.value !== "string"
      || !candidate.unitOfMeasure.value.trim()
    ) return false;
    return candidate.price.sources.some((source) =>
      candidate.currency.sources.some((currencySource) => currencySource.url === source.url)
      && candidate.unitOfMeasure.sources.some((unitSource) => unitSource.url === source.url));
  });
}

function selectedItems() {
  const all = process.argv.includes("--all");
  const idsArgument = process.argv.find((argument) => argument.startsWith("--ids="));
  const ids = all
    ? GUILD_PROCUREMENT_BOM.filter((item) => item.expectedOutcome === "RESEARCHABLE").map((item) => item.id)
    : idsArgument
      ? idsArgument.slice("--ids=".length).split(",").map((id) => id.trim()).filter(Boolean)
      : [...REPRESENTATIVE_LIVE_RESEARCH_IDS];
  return ids.map((id) => {
    const item = GUILD_PROCUREMENT_BOM.find((candidate) => candidate.id === id);
    assert.ok(item, `unknown BOM item ${id}`);
    assert.equal(item.expectedOutcome, "RESEARCHABLE", `${id} requires clarification and cannot enter live research`);
    return item;
  });
}

function requestBody(item: ProcurementAcceptanceItem, workspaceId: string) {
  return {
    componentItemKey: `request:guild-${item.id}`,
    componentName: item.description,
    specification: `${item.specification}. Supplier deliverable: ${item.supplierDeliverable}.`,
    targetCountry: "United States",
    requestText: `${item.quantity} ${item.unit} of ${item.description}`,
    requestedQuantity: item.quantity,
    requestedUnit: item.unit,
    sourceRegion: "Any region",
    deliveryLocation: "Austin, TX, United States",
    needByDate: "2026-10-15",
    workspaceId,
  };
}

async function research(item: ProcurementAcceptanceItem): Promise<ResearchResult> {
  const baseUrl = process.env.SUPPLY_OS_ACCEPTANCE_BASE_URL?.replace(/\/$/, "");
  const cookie = process.env.SUPPLY_OS_ACCEPTANCE_COOKIE;
  const workspaceId = process.env.SUPPLY_OS_ACCEPTANCE_WORKSPACE_ID ?? "acceptance-guild";
  if (baseUrl) {
    assert.ok(cookie, "SUPPLY_OS_ACCEPTANCE_COOKIE is required for deployed acceptance tests");
    const response = await fetch(`${baseUrl}/api/supply-os/supplier-research`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(requestBody(item, workspaceId)),
    });
    const payload = await response.json() as { result?: ResearchResult; error?: string };
    assert.equal(response.status, 200, `${item.id} deployed research failed: ${payload.error ?? response.statusText}`);
    assert.ok(payload.result, `${item.id} deployed research returned no result`);
    return payload.result;
  }
  assert.ok(process.env.OPENAI_API_KEY, "Set OPENAI_API_KEY or SUPPLY_OS_ACCEPTANCE_BASE_URL plus SUPPLY_OS_ACCEPTANCE_COOKIE");
  return searchComponentSuppliers({
    officeId: "acceptance-office",
    workspaceId,
    componentItemKey: `request:guild-${item.id}`,
    componentName: item.description,
    specification: `${item.specification}. Supplier deliverable: ${item.supplierDeliverable}.`,
    targetCountry: "United States",
    requestedQuantity: item.quantity ?? undefined,
    requestedUnit: item.unit ?? undefined,
    sourceRegion: "Any region",
    deliveryLocation: "Austin, TX, United States",
    needByDate: "2026-10-15",
  });
}

async function main() {
  const items = selectedItems();
  const results: Array<{ id: string; description: string; result: ResearchResult }> = [];
  for (let index = 0; index < items.length; index += 2) {
    const batch = items.slice(index, index + 2);
    const batchResults = await Promise.all(batch.map(async (item) => ({ item, result: await research(item) })));
    for (const { item, result } of batchResults) {
      assert.equal(result.degraded, false, `${item.id} degraded: ${result.warnings.join(" ")}`);
      assert.ok(result.candidates.length > 0, `${item.id} returned no attributable supplier candidate`);
      for (const candidate of result.candidates) {
        assert.ok(candidate.website || candidate.sourceUrls.length, `${item.id} candidate ${candidate.companyName} has no attributable source`);
      }
      results.push({ id: item.id, description: item.description, result });
      console.log(`${item.id} ${item.description}: ${result.candidates.length} attributable candidate(s)`);
    }
  }

  const priceSuitableIds = new Set(["001", "011", "017", "028"]);
  const priceSuitableResults = results.filter((entry) => priceSuitableIds.has(entry.id));
  if (priceSuitableResults.length) {
    assert.ok(
      priceSuitableResults.some((entry) => hasAttributableListingClaim(entry.result)),
      "representative retail or commodity searches returned no attributable unverified listing claim with price, currency, unit, and one common source",
    );
  }

  console.log(JSON.stringify({
    testedAt: new Date().toISOString(),
    mode: process.env.SUPPLY_OS_ACCEPTANCE_BASE_URL ? "deployed" : "direct-provider",
    results: results.map(({ id, description, result }) => ({
      id,
      description,
      warnings: result.warnings,
      candidates: result.candidates.map((candidate) => ({
        companyName: candidate.companyName,
        website: candidate.website,
        roles: candidate.roles,
        sourceUrls: candidate.sourceUrls,
        price: candidate.price.state === "SUPPORTED" ? candidate.price.value : null,
        currency: candidate.currency.state === "SUPPORTED" ? candidate.currency.value : null,
        unitOfMeasure: candidate.unitOfMeasure.state === "SUPPORTED" ? candidate.unitOfMeasure.value : null,
      })),
    })),
  }, null, 2));
}

void main();
