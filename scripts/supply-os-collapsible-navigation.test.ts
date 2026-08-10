import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const shell = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/dashboard/supply-os/supply-os-operating-shell.module.css"), "utf8");

assert.match(shell, /const \[sidebarCollapsed, setSidebarCollapsed\] = useState\(false\)/);
assert.match(shell, /data-sidebar-collapsed=\{sidebarCollapsed\}/);
assert.match(shell, /aria-controls="supply-os-panel-navigation"/);
assert.match(shell, /aria-expanded=\{!sidebarCollapsed\}/);
assert.match(shell, /setSidebarCollapsed\(\(current\) => !current\)/);
assert.match(shell, /sidebarCollapsed \? "Expand navigation" : "Collapse navigation"/);
assert.match(shell, /<div className=\{styles\.sidebarHeader\}>[\s\S]*className=\{styles\.operatingBrand\}[\s\S]*className=\{styles\.sidebarToggle\}/);
assert.doesNotMatch(shell, /sidebarFooter/);
assert.doesNotMatch(shell, /<span>\{sidebarCollapsed \? "Expand" : "Collapse"\}<\/span>/);
assert.match(shell, /aria-label=\{`\$\{String\(index \+ 1\)\.padStart\(2, "0"\)\} \$\{panel\.shortLabel\}`\}/);

assert.match(styles, /@media \(min-width: 901px\)[\s\S]*data-sidebar-collapsed="true"[\s\S]*grid-template-columns: 84px minmax\(0, 1fr\)/);
assert.match(styles, /data-sidebar-collapsed="true"[\s\S]*\.navCopy[\s\S]*display: none/);
assert.match(styles, /data-sidebar-collapsed="true"[\s\S]*\.sidebarHeader \{[\s\S]*justify-content: center;[\s\S]*padding: 0;/);
assert.match(styles, /data-sidebar-collapsed="true"[\s\S]*\.sidebarToggle \{[\s\S]*position: absolute;[\s\S]*z-index: 2;[\s\S]*right: -16px;[\s\S]*width: 32px;[\s\S]*height: 32px;/);
assert.match(styles, /\.sidebarToggle \{[\s\S]*width: 44px;[\s\S]*height: 44px;/);
assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.sidebarToggle \{[\s\S]*display: none/);
assert.equal(`${shell}\n${styles}`.includes("\u2014"), false);

console.log("Supply OS collapsible navigation contract passed.");
