import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const routePath = path.join(
  root,
  "src/app/dashboard/intel/load/page.tsx"
);
const component = fs.readFileSync(
  path.join(
    root,
    "src/app/dashboard/intel/components/china-import-load-review.tsx"
  ),
  "utf8"
);
const styles = fs.readFileSync(
  path.join(
    root,
    "src/app/dashboard/intel/components/china-import-load-review.module.css"
  ),
  "utf8"
);
const actions = fs.readFileSync(
  path.join(root, "src/app/dashboard/intel/actions.ts"),
  "utf8"
);
const reportActions = fs.readFileSync(
  path.join(
    root,
    "src/app/dashboard/intel/components/intel-report-actions.tsx"
  ),
  "utf8"
);
const domesticTool = fs.readFileSync(
  path.join(
    root,
    "src/app/dashboard/intel/components/load-check-panel.tsx"
  ),
  "utf8"
);

assert.ok(fs.existsSync(routePath), "the dedicated load-review route exists");
const route = fs.readFileSync(routePath, "utf8");
assert.ok(
  route.includes("await requireSession()"),
  "the load-review route requires an authenticated session"
);
assert.ok(
  route.includes("<ChinaImportLoadReview />"),
  "the route renders the fixed load-review surface"
);

for (const requiredCopy of [
  "Review one China hardware import",
  "Read-only, no RFQ or shipment write",
  "This does not calculate",
  "pasted text is sent to",
  "OpenAI GPT-5.6",
  "This page does not persist",
  "Eight customs gates",
  "Official source ledger",
  "Questions to send now",
  "Controlling customs event",
]) {
  assert.ok(
    component.includes(requiredCopy),
    `the load review preserves required copy: ${requiredCopy}`
  );
}

assert.ok(
  component.indexOf('id="load-facts"') <
    component.indexOf('id="review-load-fields"'),
  "report results precede the editor in DOM order"
);
assert.ok(
  component.includes('aria-busy={pending || reportOutdated}') &&
    component.includes("requestSequence.current"),
  "async field updates expose busy state and reject stale responses"
);
assert.ok(
  component.includes("selectedReviewPaths") &&
    component.includes("confirmSelectedPaths") &&
    component.includes("Selection alone changes nothing.") &&
    component.includes("Confirm {selectedEligiblePaths.length} selected"),
  "source-backed drafts support explicit multi-select confirmation in one rebuild"
);
assert.ok(
  component.includes("Confirm ${label}") &&
    component.includes("Confirm ${feature.label} answer"),
  "individual confirmation controls have field-specific accessible names"
);
assert.ok(
  component.includes("formatRuleTimestamp") &&
    component.includes('"America/New_York"') &&
    component.includes("action.effectiveDate") &&
    component.includes("action.effectiveToDate") &&
    component.includes("source gives date only") &&
    component.includes("No published end"),
  "rule boundaries distinguish exact Eastern timestamps, date-only authorities, and open ends"
);
assert.ok(
  component.includes('"local_fallback"') &&
    component.includes("Local fallback extraction used") &&
    component.includes('data-mode={extractionMode}'),
  "the UI clearly identifies local fallback extraction when the action note exposes it"
);
assert.ok(
  component.includes('"Mert:"') &&
    component.includes('"Supplier:"') &&
    component.includes('"Broker/importer:"') &&
    component.includes('label: "Other"') &&
    component.includes("questionGroups.map"),
  "operator questions are grouped by deterministic owner prefixes"
);
assert.ok(
  component.includes('className={styles.sourceLedgerDetails}') &&
    component.includes("window.print()") &&
    component.includes("navigator.clipboard.writeText"),
  "the report provides collapsed sources, print, and copyable questions"
);
assert.ok(
  component.includes("assessment?.authorities.map") &&
    component.includes("authorityStatusLabel(authority.status)") &&
    component.includes("authorityEffectiveWindow(authority)") &&
    component.includes("authority.resolvedSource.sourceUrl") &&
    component.includes("authority.caveat") &&
    component.includes("authority.claimContexts.map"),
  "the collapsed ledger maps every cited authority to source provenance and claim context"
);
assert.ok(
  styles.includes(".authorityLedgerMeta") &&
    styles.includes('[data-status="current"]') &&
    styles.includes('[data-status="historical_reference"]') &&
    styles.includes('[data-status="time_limited"]') &&
    styles.includes('[data-status="upcoming"]') &&
    styles.includes(".authorityCaveat") &&
    styles.includes(".authorityClaims"),
  "authority statuses, caveats, and report claims are visually explicit inside the ledger"
);

const actionStart = actions.indexOf(
  "export async function analyzeChinaImportShipmentAction"
);
const actionEnd = actions.indexOf(
  "// Run a load idea through the pre-flight"
);
assert.ok(actionStart >= 0 && actionEnd > actionStart);
const loadAction = actions.slice(actionStart, actionEnd);
for (const forbidden of [
  "prisma.",
  "revalidatePath",
  "createWithFileReference",
  "createRfqFromLoadIdeaAction",
]) {
  assert.equal(
    loadAction.includes(forbidden),
    false,
    `the read-only load action does not call ${forbidden}`
  );
}

assert.ok(
  reportActions.includes('href="/dashboard/intel/load"'),
  "the primary intelligence report links to the load review"
);
assert.ok(
  domesticTool.includes("U.S. trucking scope only") &&
    domesticTool.includes("does not assess import duty"),
  "the domestic tool cannot be mistaken for the ocean customs review"
);
assert.ok(
  styles.includes("background-color: #223229") &&
    styles.includes(".reportNav") &&
    styles.includes("position: sticky") &&
    styles.includes("overflow: visible"),
  "the hero has fallback contrast and the report navigation can stick"
);
assert.ok(
  styles.includes("@media (max-width: 560px)") &&
    styles.includes("font-size: 16px") &&
    styles.includes("min-height: 44px") &&
    styles.includes(".reviewSelectionList") &&
    styles.includes(".questionGroups"),
  "mobile controls avoid browser zoom and retain touch targets"
);
assert.ok(
  styles.includes("@media print") &&
    styles.includes(".editorSection") &&
    styles.includes(".sourceLedger a::after"),
  "print output removes the editor and exposes source URLs"
);

console.log("China load review UI contract passed.");
