import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { reserveNativeCohort, type NativeCohortPlan } from "../services/acephale-runtime/infra-cohort-reservations";

/** Run under the sole original-journal owner, before either serving segment. */
export async function reserveCohortFile(planPath: string, ledgerPath: string, outputDirectory: string) {
  const path = resolve(ledgerPath), metadata = await stat(path);
  if (!metadata.isFile() || metadata.size === 0) throw new Error("Existing nonempty original budget journal required");
  const plan: NativeCohortPlan = JSON.parse(await readFile(resolve(planPath), "utf8"));
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: false });
  await writeFile(join(directory, "plan.json"), canonical(plan) + "\n", { flag: "wx", mode: 0o600 });
  const budget = new DurableBudget(path);
  try {
    const receipt = reserveNativeCohort(plan, budget.ledger, path);
    await writeFile(join(directory, "reservation.json"), canonical(receipt) + "\n", { flag: "wx", mode: 0o600 });
    const entries = budget.ledger.snapshot();
    const checkpoint = { version: 1, ledgerPathHash: hash(path), entriesHash: hash(entries), entries,
      ...(budget.policy ? { budgetPolicyHash: budget.policy.policyHash, budgetAmendmentHash: budget.policy.contentHash } : {}) };
    await writeFile(join(directory, "checkpoint.json"), canonical(checkpoint) + "\n", { flag: "wx", mode: 0o600 });
    return { reservationHash: receipt.contentHash, checkpointHash: hash(checkpoint), trials: plan.runs.length };
  } finally { budget.close(); }
}
async function main() {
  const [plan, ledger, output] = process.argv.slice(2);
  if (!plan || !ledger || !output) throw new Error("Usage: acephale-infra-cohort <whole-cohort-plan.json> <original-budget.jsonl> <new-directory>");
  // Parent must exist; refusing implicit directory trees catches operator typos.
  await stat(dirname(resolve(output)));
  console.log(JSON.stringify(await reserveCohortFile(plan, ledger, output)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
