import { DurableBudget as CurrentBudget } from "./durable-budget";
import type { BudgetLedger, Allocation } from "../../src/lib/acephale/budget";

/** Financial port only. The frozen native runner, models and trial limits stay unchanged. */
export class DurableBudget {
  private readonly owner: CurrentBudget;
  readonly ledger: BudgetLedger;
  constructor(path: string) {
    this.owner = new CurrentBudget(path, { nativeFundingOwner: true });
    const denyInfrastructure = (allocation: Allocation) => {
      if (allocation === "infrastructure") throw new Error("Native financial port cannot reserve infrastructure");
    };
    this.ledger = new Proxy(this.owner.ledger, {
      get(target, property) {
        if (property === "reserve") return (id: string, allocation: Allocation, maximum: number) => {
          denyInfrastructure(allocation); return target.reserve(id, allocation, maximum);
        };
        if (property === "reserveMany") return (rows: Parameters<BudgetLedger["reserveMany"]>[0]) => {
          rows.forEach(row => denyInfrastructure(row.allocation)); return target.reserveMany(rows);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  get policy() { return this.owner.policy; }
  get recovery() { return this.owner.recovery; }
  get infrastructureFunding() { return this.owner.infrastructureFunding; }
  validateManifestPolicy(budgets: Parameters<CurrentBudget["validateManifestPolicy"]>[0]) {
    return this.owner.validateManifestPolicy(budgets);
  }
  close() { this.owner.close(); }
}
