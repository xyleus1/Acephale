import { readFileSync } from "node:fs";
import { frequentContexts, resolveBinding } from "../src/lib/acephale/patterns";
import { hash } from "../src/lib/acephale/canonical";
import { validateContract } from "../src/lib/acephale/contracts/validate";
import { minePatterns } from "../src/lib/acephale/miner";
const input = JSON.parse(readFileSync(0, "utf8"));
let result: unknown;
if (input.operation === "contexts") result = frequentContexts(input.histories, input.groups, input.maxContext, input.minSupport);
else if (input.operation === "mine") result = minePatterns(input.episodes);
else if (input.operation === "binding") result = resolveBinding(input.expression, input.events, input.throughSeq);
else if (input.operation === "hash") result = hash(input.value);
else if (input.operation === "validate") {
  try { validateContract(input.contract, input.value); result = true; } catch { result = false; }
} else throw new Error("Unknown parity operation");
process.stdout.write(JSON.stringify(result));
