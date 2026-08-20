import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  allowedContextChild,
  contextAncestorChain,
  contextSnapshotHash,
  resolveContextFacts,
} from "../src/lib/supply-os/context-contract";

const nodes = [
  { id: "company", parentId: null, scopeType: "COMPANY", name: "Hypnodreamz", visibility: "SHARED", version: 1 },
  { id: "product-a", parentId: "company", scopeType: "PRODUCT", name: "Sleep system", visibility: "SHARED", version: 2 },
  { id: "part-a", parentId: "product-a", scopeType: "PART", name: "Control board", visibility: "SHARED", version: 3 },
  { id: "part-b", parentId: "product-a", scopeType: "PART", name: "Frame", visibility: "SHARED", version: 1 },
  { id: "product-b", parentId: "company", scopeType: "PRODUCT", name: "Sibling product", visibility: "INTERNAL", version: 1 },
];
const chain = contextAncestorChain(nodes, "part-a");
assert.deepEqual(chain.map((node) => node.id), ["company", "product-a", "part-a"]);
assert.equal(chain.some((node) => node.id === "part-b" || node.id === "product-b"), false, "siblings must never enter assembled context");
assert.equal(allowedContextChild("COMPANY", "PRODUCT"), true);
assert.equal(allowedContextChild("PRODUCT", "PART"), true);
assert.equal(allowedContextChild("PART", "REQUEST"), true);
assert.equal(allowedContextChild("REQUEST", "PART"), false);

const facts = [
  { id: "hq", nodeId: "company", key: "headquarters", value: "San Diego", status: "CONFIRMED", visibility: "SHARED", evidence: ["document:hq"], createdAt: "2026-08-19T10:00:00Z" },
  { id: "material-product", nodeId: "product-a", key: "material", value: "ABS", status: "CONFIRMED", visibility: "SHARED", evidence: ["document:spec"], createdAt: "2026-08-19T10:01:00Z" },
  { id: "material-part", nodeId: "part-a", key: "material", value: "PC-ABS", status: "CONFIRMED", visibility: "SHARED", evidence: ["message:override"], createdAt: "2026-08-19T10:02:00Z" },
  { id: "sibling-secret", nodeId: "part-b", key: "buy_price", value: 4.2, status: "CONFIRMED", visibility: "INTERNAL", evidence: ["gmail_thread:secret"], createdAt: "2026-08-19T10:03:00Z" },
  { id: "proposal", nodeId: "part-a", key: "finish", value: "black", status: "PROPOSED", visibility: "SHARED", evidence: ["document:spec"], createdAt: "2026-08-19T10:04:00Z" },
];
const resolved = resolveContextFacts({ chain, facts });
assert.deepEqual(resolved.resolved.map((fact) => [fact.key, fact.value, fact.inherited]), [
  ["headquarters", "San Diego", true],
  ["material", "PC-ABS", false],
]);
assert.deepEqual(resolved.resolved.find((fact) => fact.key === "material")?.overridden.map((fact) => fact.id), ["material-product"]);
assert.equal(JSON.stringify(resolved).includes("buy_price"), false, "sibling facts must not leak");
assert.equal(JSON.stringify(resolved).includes("finish"), false, "proposals cannot override confirmed facts");

const conflict = resolveContextFacts({
  chain,
  facts: [
    ...facts,
    { id: "material-part-2", nodeId: "part-a", key: "material", value: "Nylon", status: "CONFIRMED", visibility: "SHARED", evidence: ["message:conflict"], createdAt: "2026-08-19T10:05:00Z" },
  ],
});
assert.deepEqual(conflict.conflicts.map((entry) => entry.key), ["material"]);
assert.equal(conflict.resolved.some((fact) => fact.key === "material"), false, "conflicting confirmed facts must block one definitive value");

const frozen = { node: "part-a", sources: ["hq", "material-part"], version: 7 };
const frozenHash = contextSnapshotHash(frozen);
assert.equal(contextSnapshotHash(frozen), frozenHash);
assert.notEqual(contextSnapshotHash({ ...frozen, sources: [...frozen.sources, "new-message"] }), frozenHash);

const root = process.cwd();
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20260819000100_supply_context/migration.sql"), "utf8");
const persistence = readFileSync(resolve(root, "src/lib/supply-os/context-persistence.ts"), "utf8");
const agent = readFileSync(resolve(root, "src/lib/supply-os/context-agent.ts"), "utf8");
const outbound = readFileSync(resolve(root, "src/lib/supply-os/context-outbound.ts"), "utf8");
const portalRoute = readFileSync(resolve(root, "src/app/api/portal/context/route.ts"), "utf8");
const portalUpload = readFileSync(resolve(root, "src/app/api/portal/context/documents/route.ts"), "utf8");
const portalDownload = readFileSync(resolve(root, "src/app/api/portal/context/documents/[documentId]/route.ts"), "utf8");
const panelRouting = readFileSync(resolve(root, "src/lib/supply-os/panel-routing.ts"), "utf8");
const supplyPage = readFileSync(resolve(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const contextUi = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-context.tsx"), "utf8");
const contextStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-context.module.css"), "utf8");
const shellStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"), "utf8");
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const portalUi = readFileSync(resolve(root, "src/app/portal/components/customer-context-workspace.tsx"), "utf8");
const documentRuntime = readFileSync(resolve(root, "src/lib/supply-os/context-documents.ts"), "utf8");

for (const model of ["SupplyContextNode", "SupplyContextMessage", "SupplyContextDocument", "SupplyContextFact", "SupplyContextSourceLink", "SupplyContextOutboundDraft"]) {
  assert.match(schema, new RegExp(`model ${model}`));
  assert.match(migration, new RegExp(`CREATE TABLE "${model}"`));
}
assert.match(migration, /FROM "SupplyWorkspace" workspace[\s\S]*workspace\."companyId" IS NOT NULL/);
assert.match(migration, /pg_trigger_depth\(\) <= 1/, "append-only messages must still permit parent cascade cleanup");
assert.match(schema, /@@unique\(\[workspaceId, contentHash\]\)/, "duplicate context uploads must be rejected per workspace");
assert.match(persistence, /officeId: args\.context\.officeId[\s\S]*workspaceId: args\.workspaceId/);
assert.match(persistence, /visibility: "SHARED"[\s\S]*role: \{ not: "AGENT" \}[\s\S]*publishedAt: \{ not: null \}/, "portal reads must only include published agent replies");
assert.match(persistence, /status: "CONFIRMED"/, "portal facts must be reviewed");
assert.match(persistence, /allowedCitationIds/);
assert.match(persistence, /citations\.filter/);
assert.match(persistence, /facts: facts\.map\(portalFact\)/);
assert.match(persistence, /companyId: args\.companyId/, "linked sources must stay inside the workspace company");
assert.match(persistence, /sourceType === "WHATSAPP"/);
assert.match(persistence, /provider: "WHATSAPP"/);
assert.match(persistence, /Supplier conversations cannot be customer-visible/);
assert.doesNotMatch(portalRoute, /getSession\(/, "portal APIs must not accept an internal session as customer authorization");
assert.match(portalDownload, /visibility: "SHARED"/);
assert.match(portalDownload, /companyId: \{ in: companyIds \}/);
assert.doesNotMatch(portalDownload, /SupplyContextOutboundDraft|EmailThread|buy_price|margin/i);
assert.doesNotMatch(portalUpload, /storageUrl: document\.storageUrl|extractionText: document\.extractionText/);
assert.match(agent, /untrusted source material/);
assert.match(agent, /Sibling scopes are intentionally absent/);
assert.match(agent, /assembled\.blocked/);
assert.match(outbound, /draft\.state !== "APPROVED"/);
assert.match(outbound, /state: "SENDING"/);
assert.match(outbound, /state === "UNKNOWN" \? "DELIVERY_UNKNOWN"/);
assert.match(outbound, /contextHash: assembled\.contextHash/);
assert.match(outbound, /Select at least one context source/);
assert.match(documentRuntime, /CONTEXT_DOCUMENT_MAX_BYTES = 10 \* 1024 \* 1024/);
assert.match(documentRuntime, /Scanned-image OCR is not supported/);
assert.match(documentRuntime, /state: "UNSUPPORTED"/);
assert.equal(panelRouting.includes('"automations"]'), false);
assert.match(panelRouting, /value === "automations"\) return "context"/);
assert.match(supplyPage, /panel === "automations"[\s\S]*panel=context/);
assert.match(contextUi, /aria-label="Context chat"/);
assert.match(contextUi, /Files in context/);
assert.match(contextUi, /placeholder="Ask Derya"/);
assert.match(contextUi, /multiple[\s\S]*accept=\{ACCEPTED_FILES\}/, "the chat composer must accept multiple attachments");
assert.match(contextUi, /form\.set\("visibility", "INTERNAL"\)/, "operator uploads must stay internal by default");
assert.doesNotMatch(contextUi, /Propose fact|Supplier drafts|Scope name|Publish to customer/, "database controls do not belong in the chat surface");
assert.match(contextStyles, /grid-template-columns: minmax\(0, 1fr\) 360px/);
assert.match(contextStyles, /\.fileDrawerOpen/);
assert.match(contextStyles, /\.composer/);
assert.match(shellStyles, /data-panel="context"[\s\S]*\.commandHeader[\s\S]*display: none/);
assert.match(shell, /const needsContextWorkspace = panel === "context"/, "Context must resolve a real workspace before opening chat");
assert.doesNotMatch(shell, /autoOpenContextWorkspace/, "direct Context navigation must not add a hook that changes the mounted shell order");
assert.match(shell, /autoOpenFirstWorkspace=\{[\s\S]*activePanel === "context"[\s\S]*!workspaceSelection/, "direct Context navigation must derive office chat auto-open state");
assert.match(portalUi, /Viewer access is read-only/);
assert.match(portalUi, /operation: "CREATE_NODE"/);
assert.match(portalUi, /operation: "POST_MESSAGE"/);

for (const source of [schema, migration, persistence, agent, outbound, portalRoute, portalUpload, portalDownload, panelRouting, supplyPage, contextUi, contextStyles, shellStyles, shell, portalUi, documentRuntime]) {
  assert.equal(source.includes("\u2014"), false, "changed context files must not contain the forbidden character");
}

console.log("Supply OS scoped context contract passed.");
