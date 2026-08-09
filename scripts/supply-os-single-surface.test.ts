import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dashboardLayout = readFileSync(resolve(root, "src/app/dashboard/layout.tsx"), "utf8");
const rootLayout = readFileSync(resolve(root, "src/app/layout.tsx"), "utf8");
const loginPage = readFileSync(resolve(root, "src/app/login/page.tsx"), "utf8");
const logoutButton = readFileSync(resolve(root, "src/components/logout-button.tsx"), "utf8");
const globalStyles = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
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
for (const removedAccountMenuItem of [
  "Email &amp; WhatsApp",
  "Customer portal",
  "Admin",
  "Language",
  "LangToggle",
  "topbar-menu-user",
  "topbar-menu-email",
]) {
  assert.equal(
    dashboardLayout.includes(removedAccountMenuItem),
    false,
    `the account menu must not contain: ${removedAccountMenuItem}`,
  );
}
assert.match(
  dashboardLayout,
  /<div className="topbar-menu-panel">\s*<LogoutButton \/>\s*<\/div>/,
  "the account menu must contain only the sign-out control",
);
assert.match(logoutButton, /await logout\(\)/, "the sign-out control must clear the authenticated session");
assert.match(logoutButton, /<form action=\{logoutAction\}>/, "the sign-out control must submit its server action");
assert.match(logoutButton, />\s*Sign out\s*<\/button>/, "the account action must use the plain Sign out label");
assert.doesNotMatch(logoutButton, /↩/, "the retired sign-out arrow must stay removed");
assert.match(
  globalStyles,
  /\.topbar-menu-panel\s*\{[^}]*width:\s*132px;/s,
  "the one-action account menu must stay compact",
);

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
