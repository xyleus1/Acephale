import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboardLayout = readFileSync(resolve(root, "src/app/dashboard/layout.tsx"), "utf8");
const rootLayout = readFileSync(resolve(root, "src/app/layout.tsx"), "utf8");
const loginPage = readFileSync(resolve(root, "src/app/login/page.tsx"), "utf8");
const middleware = readFileSync(resolve(root, "src/middleware.ts"), "utf8");
const supplierFinderPage = readFileSync(
  resolve(root, "src/app/dashboard/supplier-finder/page.tsx"),
  "utf8",
);
const marketPage = readFileSync(resolve(root, "src/app/dashboard/market/page.tsx"), "utf8");

assert.doesNotMatch(dashboardLayout, /<aside\b|className="sidebar"|<NavLink\b/);
assert.match(dashboardLayout, /app-shell app-shell-single-surface/);
assert.match(dashboardLayout, /href="\/dashboard\/supply-os" className="topbar-brand"/);
assert.doesNotMatch(dashboardLayout, /Supply OS/, "the dashboard navbar must use the Derya brand without a product suffix");
assert.doesNotMatch(dashboardLayout, />Deal Desk<|>Incoming RFQs<|>CRM<|>Outreach<|>Intel<|>Supplier Finder</);
assert.doesNotMatch(dashboardLayout, /CommandPalette|AgentChatWidget/);
assert.match(dashboardLayout, /href="\/dashboard\/customer-portal"/);
assert.match(dashboardLayout, /href="\/dashboard\/admin"/);

assert.match(rootLayout, /default: "Derya Supply OS"/);
assert.match(loginPage, />Derya Supply OS<\/h1>/);
assert.match(middleware, /const EMPLOYEE_HOME = "\/dashboard\/supply-os"/);
assert.match(middleware, /pathname === "\/dashboard"/);
assert.match(middleware, /new URL\("\/dashboard\/supply-os", req\.url\)/);
assert.match(
  supplierFinderPage,
  /redirect\("\/dashboard\/supply-os\?panel=suppliers"\)/,
  "the standalone supplier finder should enter the integrated Supply OS supplier panel",
);
assert.match(
  marketPage,
  /redirect\("\/dashboard\/supply-os\?panel=scenarios"\)/,
  "the legacy market route should enter the integrated Supply OS scenario panel",
);

console.log("Supply OS single-surface contract passed.");
