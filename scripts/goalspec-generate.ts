import { compileFromFile } from "json-schema-to-typescript";
import { readFileSync, writeFileSync } from "node:fs";

async function main() {
  const result = await compileFromFile("src/lib/goalspec/contracts/v1.schema.json", {
    bannerComment: "/* Generated from v1.schema.json. Do not edit. */", unreachableDefinitions: true,
  });
  const path = "src/lib/goalspec/contracts/generated.ts";
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== result.replace(/\r\n/g, "\n")) throw new Error("Generated GoalSpec types are out of date");
  } else writeFileSync(path, result);
}
void main();
