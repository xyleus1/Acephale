// Financial transport alias only: original target is redirected by the unchanged production04 loaders.
import { DurableBudget } from "/REQUIRED_BINDINGS/research-root/workspaces/operator/science-source/services/acephale-runtime/durable-budget.ts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sha=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
const configuration="/REQUIRED_BINDINGS/research-root/workspaces/root/corrective-budget-rpc-01/configuration.json";
const register="/REQUIRED_BINDINGS/research-root/workspaces/rescue/execution/budget-rpc01/register02.mjs";
const client="/REQUIRED_BINDINGS/research-root/workspaces/rescue/execution/budget-rpc01/production01/final04/client04.mts";
if(process.env.ACEPHALE_BUDGET_RPC_CONFIG!==configuration ||
 process.env.ACEPHALE_BUDGET_RPC_SHA256!=="a4b05b6f3b97189a8f478b6bf6bfb75ee88fa4c61aa54e2dd9ff7a12bbedb730" ||
 sha(configuration)!==process.env.ACEPHALE_BUDGET_RPC_SHA256 ||
 sha(register)!=="9076d0d39989b4433affde26a45b938d15e6d79759f8033e4c608d358c891b84" ||
 sha(client)!=="11335326fc1b27f4174cc1ba5cabb8324a3bb69d32d6a9a0edcc6ece0c58470b" ||
 sha("/REQUIRED_BINDINGS/research-root/workspaces/operator/science-source/services/acephale-runtime/durable-budget.ts")!=="d00c7a6e71fd2f9beb9f13d04df70265915b37309ab141a0b3c0330c893da915" ||
 !process.env.NODE_OPTIONS?.split(/\s+/).includes("--import=file://"+register) ||
 !process.env.ACEPHALE_BUDGET_RPC_PARTICIPANT ||
 !JSON.parse(readFileSync(configuration,"utf8")).participants.includes(process.env.ACEPHALE_BUDGET_RPC_PARTICIPANT))
 throw new Error("Exact existing production04 RPC redirect is required; local budget writer prohibited");
export { DurableBudget };
