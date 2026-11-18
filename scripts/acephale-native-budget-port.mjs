import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROFILE = "acephale-infrastructure-aware-native-budget-v1";
export const FROZEN_COMMIT = "5a36a8b3835820fe65b3615ead31fb6fb7bc9672";
export const ANALYSIS_COMMIT = "c8a662c97c5daae33d4868d7e50494d8355fbc2c";
export const FROZEN_BUDGET_SHA = "d00c7a6e71fd2f9beb9f13d04df70265915b37309ab141a0b3c0330c893da915";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FINANCIAL_FILES = [
  "scripts/acephale-native-budget-port.mjs",
  "services/acephale-runtime/native-financial-budget.ts",
  "services/acephale-runtime/durable-budget.ts",
  "services/acephale-runtime/budget-policy.ts",
  "services/acephale-runtime/infrastructure-funding.ts",
  "src/lib/acephale/budget.ts", "src/lib/acephale/canonical.ts",
  "src/lib/acephale/contracts/budget-policy-v2.json",
  "src/lib/acephale/contracts/budget-policy-v3.json",
  "src/lib/acephale/contracts/gpu-hour-capacity-v5.json",
  ...[1, 2, 3, 4, 5, 6, 7].map(v => `src/lib/acephale/contracts/infrastructure-funding-v${v}.json`),
];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function checked(path, expected) {
  if (!isAbsolute(path)) throw new Error("Budget port requires absolute source paths");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024
    || !/^[a-f0-9]{64}$/.test(expected) || sha(readFileSync(path)) !== expected) {
    throw new Error("Budget port source hash mismatch");
  }
}

export function validatePort(manifestPath, manifestSha256) {
  checked(manifestPath, manifestSha256);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const target = resolve(manifest.frozenRoot ?? "", "services/acephale-runtime/durable-budget.ts");
  const analysisTarget = resolve(manifest.analysisRoot ?? "", "services/acephale-runtime/durable-budget.ts");
  if (manifest.analysisSourceCommit !== ANALYSIS_COMMIT || !isAbsolute(manifest.analysisRoot ?? "")
    || manifest.analysisTargetPath !== analysisTarget || manifest.analysisTargetSha256 !== FROZEN_BUDGET_SHA
    || manifest.profile !== PROFILE || manifest.version !== 1 || manifest.frozenSourceCommit !== FROZEN_COMMIT
    || !isAbsolute(manifest.frozenRoot ?? "") || resolve(manifest.operatorRoot ?? "") !== ROOT
    || !/^[a-f0-9]{40}$/.test(manifest.operatorSourceCommit ?? "")
    || manifest.targetPath !== target || manifest.targetSha256 !== FROZEN_BUDGET_SHA
    || manifest.modelContractsChanged !== false || manifest.originalJournalRewritten !== false
    || !manifest.files || Object.keys(manifest.files).sort().join("\n") !== [...FINANCIAL_FILES].sort().join("\n")) {
    throw new Error("Budget port must bind the exact frozen consumer and financial source closure");
  }
  checked(target, FROZEN_BUDGET_SHA);
  checked(analysisTarget, FROZEN_BUDGET_SHA);
  for (const relative of FINANCIAL_FILES) checked(join(ROOT, relative), manifest.files[relative]);
  return { manifest, targets: new Set([realpathSync(target), realpathSync(analysisTarget)]), adapter: join(ROOT, "services/acephale-runtime/native-financial-budget.ts") };
}

// NODE_OPTIONS passes this explicit port to the frozen Python launcher's Node children.
// It redirects only the two explicitly pinned financial modules, never scientific modules.
if (process.env.ACEPHALE_NATIVE_BUDGET_PORT) {
  const port = validatePort(process.env.ACEPHALE_NATIVE_BUDGET_PORT, process.env.ACEPHALE_NATIVE_BUDGET_PORT_SHA256);
  registerHooks({ resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith("file:") && port.targets.has(fileURLToPath(result.url))) {
      checked(fileURLToPath(result.url), FROZEN_BUDGET_SHA);
      return { ...result, url: pathToFileURL(port.adapter).href };
    }
    return result;
  } });
}
