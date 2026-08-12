import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync("src/app/dashboard/supply-os/supply-os-operating-shell.tsx", "utf8");
const settingsPage = readFileSync("src/app/dashboard/settings/integrations/integrations-settings.tsx", "utf8");
const publicPage = readFileSync("src/app/integrations/page.tsx", "utf8");
const connector = readFileSync("src/lib/supply-os/connector-custom-rest.ts", "utf8");

assert.match(shell, /href="\/dashboard\/settings\/integrations"/);
assert.match(shell, />Settings<\/span>/);
assert.match(settingsPage, /href="\/integrations"/);
assert.match(settingsPage, /adapterKey: "CUSTOM_REST_V1"/);
assert.match(settingsPage, /config: \{ tokenUrl, scope:/);
assert.match(publicPage, /Client integration contract/);
assert.match(publicPage, /OAuth 2\.0 client credentials/);
assert.match(publicPage, /The first integration is read-only/);
assert.match(publicPage, /Failed runs do not replace the prior snapshot/);
assert.match(publicPage, /Credentials should follow the agreed secure setup process, not email/);
assert.match(connector, /const DEFAULT_PATHS = \{/);
assert.match(connector, /nextCursor/);

for (const [name, source] of [["shell", shell], ["settings", settingsPage], ["public", publicPage]] as const) {
  assert.equal(source.includes("\u2014"), false, `${name} must not contain U+2014.`);
}

console.log("Integrations surfaces contract passed.");
