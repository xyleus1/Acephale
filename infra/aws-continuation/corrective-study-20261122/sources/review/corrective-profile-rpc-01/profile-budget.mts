// Profile-only owner association; unchanged production04 client owns every operation.
import { DurableBudget as OriginalRPCBudget } from "/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-native-plumbing-02/durable-budget-rpc-alias.ts";
export const owners=new WeakMap<object,OriginalRPCBudget>();
export class DurableBudget extends OriginalRPCBudget {
 constructor(path:string){super(path);owners.set(this.ledger,this);}
}
