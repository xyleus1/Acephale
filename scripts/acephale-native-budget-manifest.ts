import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Create provenance for an explicitly selected operational financial port. */
export async function writeNativeBudgetPortManifest(frozenRoot: string, analysisRoot: string, output: string) {
  const operatorRoot = fileURLToPath(new URL("..", import.meta.url));
  const loader = join(operatorRoot, "scripts/acephale-native-budget-port.mjs");
  const port = await import(pathToFileURL(loader).href);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const frozen = resolve(frozenRoot), analysis = resolve(analysisRoot);
  if (git(analysis, "rev-parse", "HEAD") !== port.ANALYSIS_COMMIT
    || git(analysis, "status", "--porcelain", "--untracked-files=no")
    || git(frozen, "rev-parse", "HEAD") !== port.FROZEN_COMMIT
    || git(frozen, "status", "--porcelain", "--untracked-files=no")
    || git(operatorRoot, "status", "--porcelain", "--untracked-files=no")) {
    throw new Error("Budget port requires clean committed frozen and operational sources");
  }
  git(operatorRoot, "ls-files", "--error-unmatch", ...port.FINANCIAL_FILES);
  const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const manifest = { version: 1, profile: port.PROFILE, frozenRoot: frozen,
    frozenSourceCommit: port.FROZEN_COMMIT, analysisRoot: analysis, analysisSourceCommit: port.ANALYSIS_COMMIT,
    analysisTargetPath: join(analysis, "services/acephale-runtime/durable-budget.ts"), analysisTargetSha256: port.FROZEN_BUDGET_SHA,
    operatorRoot: resolve(operatorRoot),
    operatorSourceCommit: git(operatorRoot, "rev-parse", "HEAD"),
    targetPath: join(frozen, "services/acephale-runtime/durable-budget.ts"), targetSha256: port.FROZEN_BUDGET_SHA,
    modelContractsChanged: false, originalJournalRewritten: false,
    files: Object.fromEntries(port.FINANCIAL_FILES.map((path: string) => [path, sha(join(operatorRoot, path))])) };
  if (sha(manifest.targetPath) !== manifest.targetSha256 || sha(manifest.analysisTargetPath) !== manifest.analysisTargetSha256) throw new Error("Unexpected frozen financial module");
  writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  port.validatePort(resolve(output), sha(output));
  return { path: resolve(output), sha256: sha(output), profile: port.PROFILE,
    nodeOptions: `--import=${pathToFileURL(loader).href}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error("Usage: acephale-native-budget-manifest <frozen-native-root> <frozen-analysis-root> <new-manifest.json>");
  void writeNativeBudgetPortManifest(process.argv[2], process.argv[3], process.argv[4]).then(value => console.log(JSON.stringify(value)));
}
