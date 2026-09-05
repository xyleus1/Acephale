import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboard = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-dashboard.tsx"), "utf8");
const inventorySourcing = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-inventory-sourcing.tsx"), "utf8");
const prospects = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-prospects.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-logistics.module.css"), "utf8");
const operatingShell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"), "utf8");
const projectStatus = readFileSync(resolve(root, "src/app/dashboard/supply-os/project-status-strip.tsx"), "utf8");

function cssBlocks(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...styles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1] ?? "");
}

assert.match(dashboard, /const materialsInspectorVisible = activePanel === "materials"[\s\S]*Boolean\(selectedInventoryItem\)[\s\S]*!procurementRequest[\s\S]*!customerProcurementRequest/);
assert.match(dashboard, /data-materials-inspector=\{activePanel === "materials" \? materialsInspectorVisible : undefined\}/);
assert.match(dashboard, /activePanel === "materials" && inventoryWorkspaceView === "projects" && selectedInventoryItem && materialsInspectorVisible \? \(/);
assert.match(prospects, /export \{ OTHER_PROJECT \}/);
assert.match(inventorySourcing, /name: "Other lists"/);
assert.match(inventorySourcing, /key: OTHER_PROJECT/);
assert.match(inventorySourcing, /list\.projectId \?\? OTHER_PROJECT/);
assert.match(inventorySourcing, /lockedProjectId=\{selectedProject\.key\}/);
assert.match(projectStatus, /<dl className=\{styles\.headerProjectFacts\}>/);
assert.match(projectStatus, /<dt>Leads<\/dt>[\s\S]*<dd>\{facts\.leads\}<\/dd>/);
assert.match(projectStatus, /<dt>Mails sent<\/dt>[\s\S]*<dd>\{facts\.mailsSent\}<\/dd>/);
assert.match(projectStatus, /<dt>Replies<\/dt>[\s\S]*<dd>\{facts\.replies\}<\/dd>/);
assert.match(projectStatus, /<dt>Active threads<\/dt>[\s\S]*<dd>\{facts\.activeThreads\}<\/dd>/);
assert.match(projectStatus, /<dt>\{facts\.successLabel\.slice/);
assert.match(operatingShell, /\.headerStatusSlot\s*\{[\s\S]*flex: 1 1 auto;[\s\S]*justify-content: flex-end;/);
assert.match(operatingShell, /\.headerProjectFacts > div \+ div\s*\{[\s\S]*border-left: 1px solid var\(--os-line\);/);
assert.doesNotMatch(styles, /projectStatusStrip|projectStatusFacts|projectStatusIdentity|projectStatusLoading/);

const materialsBlocks = cssBlocks('.commandCenter[data-domain="materials"] .commandMapStage');
assert.ok(materialsBlocks.length >= 3, "Materials layout needs desktop and responsive rules.");
assert.match(materialsBlocks[0] ?? "", /grid-template-columns: minmax\(0, 1fr\)/);
assert.match(materialsBlocks[0] ?? "", /grid-template-areas: "materials"/);
assert.doesNotMatch(materialsBlocks[0] ?? "", /inspector/, "The default materials grid must not reserve a ghost inspector track.");

const inspectorBlocks = cssBlocks('.commandCenter[data-domain="materials"][data-materials-inspector="true"] .commandMapStage');
assert.ok(inspectorBlocks.length >= 3, "The real inspector still needs desktop and responsive layout rules.");
assert.match(inspectorBlocks[0] ?? "", /grid-template-columns: minmax\(0, 2\.6fr\) minmax\(300px, 0\.75fr\)/);
assert.match(inspectorBlocks[0] ?? "", /grid-template-areas: "materials inspector"/);
assert.ok(inspectorBlocks.some((block) => /minmax\(440px, auto\)/.test(block)), "Tablet layout must add the inspector row only when the inspector renders.");
assert.ok(inspectorBlocks.some((block) => /minmax\(560px, auto\)/.test(block)), "Mobile layout must add the inspector row only when the inspector renders.");

console.log("Supply OS materials layout state passed.");
