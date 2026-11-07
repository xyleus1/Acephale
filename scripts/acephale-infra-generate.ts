import { compileFromFile } from "json-schema-to-typescript";
import { readFileSync, writeFileSync } from "node:fs";

async function main() {
  const source = "src/lib/acephale/contracts/infra-manifest-v2.schema.json";
  const target = "src/lib/acephale/contracts/infra-manifest-v2.generated.ts";
  const generated = await compileFromFile(source, { bannerComment: "/* Generated from infra-manifest-v2.schema.json. Do not edit. */",
    unreachableDefinitions: true, ignoreMinAndMaxItems: true });
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== generated.replace(/\r\n/g, "\n")) throw new Error("Stale infra manifest generated contract");
  } else writeFileSync(target, generated);
}
void main();
