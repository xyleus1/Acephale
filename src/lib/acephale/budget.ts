export const ALLOCATIONS = {
  infrastructure: 35_000_000, preparation: 30_000_000, training: 60_000_000,
  development: 40_000_000, heldout: 240_000_000, replay: 30_000_000, contingency: 65_000_000,
} as const;
export type Allocation = keyof typeof ALLOCATIONS;
export type AllocationCaps = Readonly<Record<Allocation, number>>;
export type Reservation = { allocation: Allocation; maximum: number; actual?: number; parentId?: string };

// Integer microdollars. Single process owner; persist the ledger before dispatch.
// Unknown provider outcomes retain their maximum reservation until reconciliation.
export class BudgetLedger {
  private entries = new Map<string, Reservation>();
  readonly allocations: AllocationCaps;
  constructor(private persist: (entries: [string, Reservation][]) => void = () => {}, recovered: [string, Reservation][] = [],
    allocations: AllocationCaps = ALLOCATIONS) {
    if (Object.keys(allocations).length !== Object.keys(ALLOCATIONS).length
      || Object.keys(ALLOCATIONS).some(key => !Number.isSafeInteger(allocations[key as Allocation]) || allocations[key as Allocation] < 0)
      || Object.values(allocations).reduce((sum, value) => sum + value, 0) !== 500_000_000
      || allocations.contingency !== 65_000_000) throw new Error("Invalid budget allocation policy");
    this.allocations = Object.freeze({ ...allocations });
    for (const [id, entry] of recovered) {
      if (typeof id !== "string" || !id || this.entries.has(id) || !Object.hasOwn(ALLOCATIONS, entry.allocation)
        || !Number.isSafeInteger(entry.maximum) || entry.maximum < 0
        || (entry.actual !== undefined && (!Number.isSafeInteger(entry.actual) || entry.actual < 0))) throw new Error("Invalid recovered budget");
      this.entries.set(id, { ...entry });
    }
    for (const entry of this.entries.values()) if (entry.parentId) {
      const parent = this.entries.get(entry.parentId);
      if (!parent || parent.parentId || parent.allocation !== entry.allocation) throw new Error("Invalid recovered budget parent");
    }
  }
  reserve(id: string, allocation: Allocation, maximum: number): void {
    if (typeof id !== "string" || !id || !Object.hasOwn(ALLOCATIONS, allocation) || !Number.isSafeInteger(maximum) || maximum < 0 || this.entries.has(id)) throw new Error("Invalid reservation");
    if ([...this.entries.values()].some(r => r.actual !== undefined && r.actual > r.maximum)) throw new Error("Budget halted after overrun");
    const used = [...this.entries.values()].filter(r => r.allocation === allocation && !r.parentId)
      .reduce((sum, r) => sum + (r.actual ?? r.maximum), 0);
    if (used + maximum > this.allocations[allocation]) throw new Error("Budget exhausted");
    const roots = [...this.entries.values()].filter(row => !row.parentId);
    if (roots.reduce((sum, row) => sum + (row.actual ?? row.maximum), 0) + maximum > 500_000_000
      || (allocation !== "contingency" && roots.filter(row => row.allocation !== "contingency")
        .reduce((sum, row) => sum + (row.actual ?? row.maximum), 0) + maximum > 435_000_000)) throw new Error("Protected study ceiling exhausted");
    const next = new Map(this.entries).set(id, { allocation, maximum });
    this.persist([...next]);
    this.entries = next;
  }
  reserveChild(parentId: string, id: string, maximum: number) {
    const parent = this.entries.get(parentId);
    if (!parent || parent.parentId || parent.actual !== undefined || typeof id !== "string" || !id || this.entries.has(id)
      || !Number.isSafeInteger(maximum) || maximum < 0) throw new Error("Invalid child reservation");
    if ([...this.entries.values()].some(r => r.actual !== undefined && r.actual > r.maximum)) throw new Error("Budget halted after overrun");
    const used = [...this.entries.values()].filter(r => r.parentId === parentId).reduce((sum, r) => sum + (r.actual ?? r.maximum), 0);
    if (used + maximum > parent.maximum) throw new Error("Trial budget exhausted");
    const next = new Map(this.entries).set(id, { allocation: parent.allocation, maximum, parentId });
    this.persist([...next]); this.entries = next;
  }
  reserveMany(reservations: { id: string; allocation: Allocation; maximum: number }[]) {
    const proposed = new BudgetLedger(undefined, [...this.entries], this.allocations);
    for (const reservation of reservations) proposed.reserve(reservation.id, reservation.allocation, reservation.maximum);
    const next = proposed.snapshot().map(({ id, ...entry }) => [id, entry] as [string, Reservation]);
    this.persist(next);
    this.entries = new Map(next);
  }
  finishParent(id: string) {
    const children = [...this.entries.values()].filter(r => r.parentId === id);
    if (children.some(r => r.actual === undefined)) return; // Reconcile uncertain charges before release.
    this.settle(id, children.reduce((sum, r) => sum + r.actual!, 0));
  }
  settle(id: string, actual: number): void {
    const reservation = this.entries.get(id);
    if (!reservation || reservation.actual !== undefined || !Number.isSafeInteger(actual) || actual < 0) throw new Error("Invalid settlement");
    // Record overruns truthfully, then stop dispatch. Never discard a billed charge.
    const next = new Map(this.entries).set(id, { ...reservation, actual });
    this.persist([...next]); this.entries = next;
    if (actual > reservation.maximum) throw new Error("Cost exceeded reserved maximum");
  }
  snapshot() { return [...this.entries].map(([id, r]) => ({ id, ...r })); }
  remaining(allocation: Allocation): number {
    const committed = [...this.entries.values()].filter(row => row.allocation === allocation && !row.parentId)
      .reduce((sum, row) => sum + (row.actual ?? row.maximum), 0);
    return Math.max(0, this.allocations[allocation] - committed);
  }
}

export function heldoutSize(developmentCosts: number[], censored: boolean, remainingUsd = 240) {
  if (!developmentCosts.length || developmentCosts.some(c => !Number.isFinite(c) || c < 0)) throw new Error("Completed development costs required");
  if (!Number.isFinite(remainingUsd) || remainingUsd < 0 || remainingUsd > 240) throw new Error("Invalid remaining heldout allocation");
  const allowance = Math.ceil(Math.max(1.25, censored ? 2.5 : 0, 1.25 * Math.max(...developmentCosts)) * 4) / 4;
  return { allowance, families: Math.min(16, 2 * Math.floor(remainingUsd / (24 * allowance))) };
}

/** New studies use recovered remaining funds, never a fresh allocation ceiling. */
export function heldoutSizeFromLedger(ledger: BudgetLedger, developmentCosts: number[], censored: boolean) {
  return heldoutSize(developmentCosts, censored, ledger.remaining("heldout") / 1_000_000);
}
