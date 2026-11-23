import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hash } from "../../src/lib/acephale/canonical";
import { nativeCohortScope } from "./infra-cohort-reservations";
export function correctiveAccountingScope(configuration: any, manifest: any) {
 const path=process.env.ACEPHALE_CORRECTIVE_SCOPE_BINDING, expected=process.env.ACEPHALE_CORRECTIVE_SCOPE_BINDING_SHA256;
 if (!path || !expected) throw new Error("Exact corrective accounting scope binding required");
 const bytes=readFileSync(path);
 if(createHash("sha256").update(bytes).digest("hex")!==expected) throw new Error("Corrective scope binding changed");
 const binding=JSON.parse(bytes.toString("utf8"));
 if(binding.kind!=="acephale-corrective-native-scope-binding-v1")throw new Error("Corrective scope binding kind");
 const {calibrationHash:_,...data}=manifest.data,{scheduleHash:__,...protocol}=manifest.protocol;
 if(hash({sourceCommit:manifest.sourceCommit,actor:manifest.actor,data,protocol,taskBundleHash:configuration.taskBundleHash})!==hash(binding.scientificCore))
   throw new Error("Corrective scientific scope differs");
 const stage=binding.stages[configuration.stage], actual=nativeCohortScope(manifest,configuration.taskBundleHash);
 const matches=stage?.segments.filter((s:any)=>s.observedScopeHash===actual&&hash(configuration.runs)===s.runsHash&&hash(configuration.runs.map((r:any)=>r.runId))===hash(s.runIds));
 if(matches?.length!==1)throw new Error("Original exact segment and observed worker scope required");
 return stage.accountingScopeHash;
}
