import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const page = readFileSync(join(root, "src/app/supply-os/page.tsx"), "utf8");
const prototype = readFileSync(join(root, "src/app/supply-os/supply-os-prototype.tsx"), "utf8");
const styles = readFileSync(join(root, "src/app/supply-os/supply-os.module.css"), "utf8");
const dashboardLayout = readFileSync(join(root, "src/app/dashboard/layout.tsx"), "utf8");
const source = page + "\n" + prototype + "\n" + styles;

for (const forbidden of ["@/lib/", "@/components/", "prisma", "use server", "fetch("]) {
  assert.equal(source.includes(forbidden), false, "standalone prototype must not contain " + forbidden);
}

for (const required of [
  "Command center",
  "Supply map",
  "Supplier intelligence",
  "Quote room",
  "Execution room",
  "Derya control",
  "Prototype data only",
  "No messages, bookings, filings, posts, or external writes occur",
]) {
  assert.equal(source.includes(required), true, "prototype is missing: " + required);
}

assert.equal(source.includes("\u2014"), false, "prototype must not contain an em dash");
assert.equal(styles.includes(".mapCanvas > svg"), true, "map SVG must be scoped to the direct map child");
assert.equal(styles.includes("@media (max-width: 720px)"), true, "prototype needs a mobile layout");
assert.equal(
  dashboardLayout.includes('<NavLink href="/supply-os" icon={<Icon name="layers" />}>Supply OS</NavLink>'),
  true,
  "dashboard sidebar must link to the Supply OS prototype",
);

console.log("supply OS prototype checks passed");
