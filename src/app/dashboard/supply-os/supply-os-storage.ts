import {
  SUPPLY_CASE_STORAGE_KEY,
  parseStoredSupplyCases,
  resolveSelectedSupplyCase,
  serializeSupplyCases,
  type SupplyCaseDashboard,
} from "@/lib/supply-os-case-model";

export function supplyCaseStorageKeys(storageScope: string) {
  const cases = `${SUPPLY_CASE_STORAGE_KEY}:${storageScope}`;
  return { cases, selected: `${cases}:selected` };
}

export function readBrowserStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeBrowserStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeBrowserStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Local storage is an optional demo convenience.
  }
}

export function removeLegacySupplyCaseStorage() {
  removeBrowserStorage(SUPPLY_CASE_STORAGE_KEY);
  removeBrowserStorage(`${SUPPLY_CASE_STORAGE_KEY}:selected`);
}

export function loadSupplyCases(storageScope: string) {
  const keys = supplyCaseStorageKeys(storageScope);
  const cases = parseStoredSupplyCases(readBrowserStorage(keys.cases));
  const selected = resolveSelectedSupplyCase(cases, readBrowserStorage(keys.selected));
  return { keys, cases, selected };
}

export function visibleSupplyCases(cases: readonly SupplyCaseDashboard[]) {
  return cases
    .filter((item) => !item.archivedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function persistSupplyCases(
  storageScope: string,
  cases: readonly SupplyCaseDashboard[],
  selectedCaseId: string,
) {
  const keys = supplyCaseStorageKeys(storageScope);
  const previousCases = readBrowserStorage(keys.cases);
  const previousSelected = readBrowserStorage(keys.selected);
  if (!writeBrowserStorage(keys.cases, serializeSupplyCases(cases))) return false;
  if (writeBrowserStorage(keys.selected, selectedCaseId)) return true;

  if (previousCases === null) removeBrowserStorage(keys.cases);
  else writeBrowserStorage(keys.cases, previousCases);
  if (previousSelected === null) removeBrowserStorage(keys.selected);
  else writeBrowserStorage(keys.selected, previousSelected);
  return false;
}
