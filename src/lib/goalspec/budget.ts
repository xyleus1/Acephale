export const ALLOCATIONS = {
  infrastructure: 35_000_000, preparation: 30_000_000, training: 60_000_000,
  development: 40_000_000, heldout: 240_000_000, replay: 30_000_000, contingency: 65_000_000,
} as const;
export type Allocation = keyof typeof ALLOCATIONS;
export type Reservation = { allocation: Allocation; maximum: number; actual?: number; parentId?: string };

// Integer microdollars. Single process owner; persist the ledger before dispatch.
// Unknown provider outcomes retain their maximum reservation until reconciliation.
export class BudgetLedger {
  private entries = new Map<string, Reservation>();
  constructor(private persist: (entries: [string, Reservation][]) => void = () => {}, recovered: [string, Reservation][] = []) {
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
    if (used + maximum > ALLOCATIONS[allocation]) throw new Error("Budget exhausted");
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
    const proposed = new BudgetLedger(undefined, [...this.entries]);
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
}

export function heldoutSize(developmentCosts: number[], censored: boolean) {
  if (!developmentCosts.length || developmentCosts.some(c => !Number.isFinite(c) || c < 0)) throw new Error("Completed development costs required");
  const allowance = Math.ceil(Math.max(1.25, censored ? 2.5 : 0, 1.25 * Math.max(...developmentCosts)) * 4) / 4;
  return { allowance, families: Math.min(16, 2 * Math.floor(240 / (24 * allowance))) };
}
