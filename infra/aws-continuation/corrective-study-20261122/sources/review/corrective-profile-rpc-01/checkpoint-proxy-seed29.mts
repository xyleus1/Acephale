// Exact profile import only; other original hosted exports are retained.
export * from "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-qualified-inputs-03/seed29-first01/application/services/acephale-runtime/infra-hosted-workers.ts";
import { owners } from "./profile-budget.mts";
import { validateMonotonicLedgerCheckpoint } from "/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-financial-namespace-01/monotonic-checkpoint.mts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export function validateInfraLedgerCheckpoint(value:unknown,ledger:object,ledgerPath:string){
 const owner=owners.get(ledger);
 if(!owner||owner.ledger!==ledger)throw Error("Genuine RPC owner association required");
 const proof=validateMonotonicLedgerCheckpoint(value,owner,ledgerPath);
 const logs=process.env.ACEPHALE_PROFILE_PREPARE_ACTIVE_LOG;
 if(logs)writeFileSync(join(logs,"monotonic-"+randomUUID()+".json"),JSON.stringify(proof)+"\n",{flag:"wx",mode:0o600});
 return proof;
}
