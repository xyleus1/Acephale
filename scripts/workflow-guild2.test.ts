import assert from "node:assert/strict";
import fs from "node:fs";
import { GUILD2_SOURCING_ITEMS, GUILD_SOURCING_ITEMS } from "../src/lib/supply-os/guild-sourcing-items";

assert.equal(GUILD_SOURCING_ITEMS.length, 40);
assert.equal(GUILD2_SOURCING_ITEMS.length, 40);
assert.deepEqual(
  GUILD2_SOURCING_ITEMS.map((item) => item.sku),
  GUILD_SOURCING_ITEMS.map((item) => item.sku.replace(/^GUILD-/, "GUILD2-")),
);
assert.deepEqual(
  GUILD2_SOURCING_ITEMS.map(({ sku: _sku, ...item }) => item),
  GUILD_SOURCING_ITEMS.map(({ sku: _sku, ...item }) => item),
);

const bridge = fs.readFileSync("src/lib/supply-os/external-sourcing-workflow.ts", "utf8");
const route = fs.readFileSync("src/app/api/supply-os/external-sourcing/guild2/route.ts", "utf8");
const dashboard = fs.readFileSync("src/app/dashboard/supply-os/supply-os-dashboard.tsx", "utf8");

assert.match(bridge, /CREATE SCHEMA IF NOT EXISTS derya/);
assert.match(bridge, /CREATE TABLE IF NOT EXISTS derya\.sourcing_runs/);
assert.match(bridge, /WORKFLOW_AGENT_TRIGGER_URL/);
assert.match(bridge, /authorization: `Bearer \$\{token\}`/);
assert.match(route, /\["ensure", "run"\]/);
assert.match(dashboard, /GUILD2_SOURCING_ITEMS/);
assert.doesNotMatch(dashboard, /void runCampaign\(\)/);

console.log("GUILD2 workflow boundary checks passed.");
