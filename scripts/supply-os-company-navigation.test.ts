import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const page = readFileSync(resolve(root, "src/app/dashboard/supply-os/page.tsx"), "utf8");
const index = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-company-index.tsx"), "utf8");
const demoCompany = readFileSync(resolve(root, "src/lib/supply-os/demo-company.ts"), "utf8");
const shellStyles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"), "utf8");
const workspaceRoute = readFileSync(resolve(root, "src/app/api/supply-os/workspaces/route.ts"), "utf8");

assert.match(shell, /className=\{styles\.operatingSidebar\}/, "left domain sidebar must remain persistent");
assert.match(shell, /const \[companyIndexOpen, setCompanyIndexOpen\] = useState\(true\)/, "company list must be the clean entry state");
assert.match(shell, /<ArrowLeft size=\{15\} \/> Companies/, "selected workspaces need a back-to-companies control");
assert.match(shell, /className=\{styles\.commandHeader\}/, "company identity ribbon must remain above every domain view");
assert.match(shell, /companyLogoUrl/, "company identity ribbon must resolve a company image");
assert.match(shell, /<img src=\{companyLogoUrl\}/, "company identity ribbon must render the resolved company image");
assert.match(shell, /data-company-index=\{companyIndexOpen\}/);
assert.match(shellStyles, /\.panelStage\s*\{[\s\S]*overflow: hidden/, "every domain must use the same fixed stage");
assert.doesNotMatch(shell, /key=\{activePanel\}/, "switching domains must not remount the fixed stage");
assert.match(index, /className=\{styles\.companyRow\}/, "company index must use simple rows");
assert.match(index, /<img src=\{SUPPLY_OS_DEMO_COMPANY\.logoUrl\}/, "the illustrative company row must use the same real logo as the ribbon");
assert.match(demoCompany, /https:\/\/www\.atlas-robotics\.com\/icon\.svg/, "the illustrative company must use the official same-domain logo asset");
assert.match(index, /"New company"/, "admins need an inline company creation action");
assert.match(index, /className=\{styles\.createRow\}/, "company creation must stay inline");
assert.doesNotMatch(index, /<dialog|role="dialog"|aria-modal/, "company selection and creation must not use popups");
assert.match(page, /where: \{ id: session\.userId, officeId: session\.officeId, isActive: true \}/, "page permissions must use the current database user, not a stale cookie role");
assert.match(page, /canCreateCompany=\{currentUser\.role === "ADMIN"\}/, "company creation must be limited to current admins in the UI");
assert.match(page, /canApproveProcurement=\{currentUser\.role === "ADMIN" \|\| currentUser\.role === "MANAGER"\}/, "procurement decisions must be limited to current managers and admins in the UI");
assert.match(workspaceRoute, /session\.role !== "ADMIN"/, "company creation must be limited to admins on the server");

console.log("Supply OS company navigation contract passed.");
