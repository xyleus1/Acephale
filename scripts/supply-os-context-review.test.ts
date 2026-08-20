import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const agent = readFileSync(resolve(root, "src/lib/supply-os/context-agent.ts"), "utf8");
const persistence = readFileSync(resolve(root, "src/lib/supply-os/context-persistence.ts"), "utf8");
const portal = readFileSync(resolve(root, "src/app/portal/components/customer-context-workspace.tsx"), "utf8");
const outbound = readFileSync(resolve(root, "src/lib/supply-os/context-outbound.ts"), "utf8");
const feature = readFileSync(resolve(root, "src/lib/supply-os/context-feature.ts"), "utf8");
const chatRoute = readFileSync(resolve(root, "src/app/api/supply-os/workspaces/[workspaceId]/context/nodes/[nodeId]/chat/route.ts"), "utf8");
const contextUi = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-context.tsx"), "utf8");
const reconcileRoute = readFileSync(resolve(root, "src/app/api/supply-os/context/drafts/[draftId]/reconcile/route.ts"), "utf8");

assert.match(agent, /conversationHistory/);
assert.match(agent, /evidenceMessages: assembled\.messages\.filter\(\(message\) => message\.role !== "AGENT"\)/);
assert.match(agent, /if \(!citationIds\.length\)/);
assert.match(persistence, /messages\.filter\(\(message\) => message\.role !== "AGENT"\)/);
assert.match(persistence, /contextDocumentMetadata/);
assert.match(persistence, /SupplyPersistenceError\([\s\S]*"invalid_input"/);
assert.match(portal, /if \(saved\) setMessage\(""\)/);
assert.equal((portal.match(/entry\.nodeId === selectedNodeId/g) ?? []).length, 2);
assert.match(outbound, /reconcileSupplyContextOutboundDraft/);
assert.match(outbound, /provider\.reconcile/);
assert.match(reconcileRoute, /reconcileSupplyContextOutboundDraft/);
assert.match(chatRoute, /messageSaved: error\.messageSaved/);
assert.match(contextUi, /messageSaved = payload\?\.messageSaved === true/);
assert.match(feature, /PROCUREMENT_CUSTOMER_MAP_JSON/);

for (const source of [agent, persistence, portal, outbound, feature, chatRoute, contextUi, reconcileRoute]) {
  assert.equal(source.includes("\u2014"), false, "Context review files must not contain the forbidden character");
}

console.log("Supply OS Context review regressions passed.");
