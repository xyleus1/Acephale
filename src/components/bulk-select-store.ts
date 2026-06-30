"use client";

// Cross-component selection state without React context. Each <BulkCheckbox>
// and the <BulkActionBar> subscribe to the same singleton; toggling is O(1)
// and notifications fire to every subscriber so all visible chrome updates
// in lockstep.

const selected = new Set<string>();
const subs = new Set<() => void>();

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

function notify() { for (const s of subs) s(); }

export function toggle(id: string): void {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  notify();
}

export function isSelected(id: string): boolean {
  return selected.has(id);
}

export function getSelected(): string[] {
  return [...selected];
}

export function clear(): void {
  selected.clear();
  notify();
}

export function selectMany(ids: string[]): void {
  for (const id of ids) selected.add(id);
  notify();
}
