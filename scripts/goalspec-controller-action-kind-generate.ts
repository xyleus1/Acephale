import { compileFromFile } from "json-schema-to-typescript";
import { readFileSync, writeFileSync } from "node:fs";
async function main() {
  const generated = await compileFromFile("src/lib/goalspec/contracts/v4-action-kind.schema.json", { bannerComment: "/* Generated from v4-action-kind.schema.json. Do not edit. */", ignoreMinAndMaxItems: true });
  const target = "src/lib/goalspec/contracts/v4-action-kind.generated.ts";
  if (process.argv.includes("--check")) { if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== generated.replace(/\r\n/g, "\n")) throw new Error("Stale action-kind contract"); }
  else writeFileSync(target, generated);
}
void main();
