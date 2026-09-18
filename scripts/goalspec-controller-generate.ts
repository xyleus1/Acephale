import { compileFromFile } from "json-schema-to-typescript";
import { readFileSync, writeFileSync } from "node:fs";
const schema = "src/lib/goalspec/contracts/v4-controller.schema.json";
const target = "src/lib/goalspec/contracts/v4-controller.generated.ts";
async function main() {
const generated = await compileFromFile(schema, { bannerComment: "/* Generated from v4-controller.schema.json. Do not edit. */", unreachableDefinitions: true, ignoreMinAndMaxItems: true });
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== generated.replace(/\r\n/g, "\n")) throw new Error("Stale controller generated contract");
} else writeFileSync(target, generated);
}
void main();
