// Shared cargo helpers usable from both server and client components.

export type DimRow = { qty: string; length: string; width: string; height: string };
const TWENTY_FOOT_INTERNAL_HEIGHT_CM = 239;

export const CONTAINER_TYPES = ["20DC", "40DC", "40HC", "45HC", "20RF", "40RF", "40OT", "40FR"] as const;
export const CONTAINER_TYPE_LABEL: Record<string, string> = {
  "20DC": "20' Dry", "40DC": "40' Dry", "40HC": "40' High Cube", "45HC": "45' High Cube",
  "20RF": "20' Reefer", "40RF": "40' Reefer", "40OT": "40' Open Top", "40FR": "40' Flat Rack",
};

export function parseDimensions(raw: string | null | undefined): DimRow[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((r) => ({
      qty: String(r.qty ?? ""),
      length: String(r.length ?? ""),
      width: String(r.width ?? ""),
      height: String(r.height ?? ""),
    }));
  } catch {
    return [];
  }
}

export function dimensionsSummary(raw: string | null | undefined): string {
  const rows = parseDimensions(raw).filter((r) => r.qty || r.length || r.width || r.height);
  if (rows.length === 0) return "";
  return rows.map((r) => `${r.qty || 1}×${r.length || "?"}×${r.width || "?"}×${r.height || "?"}cm`).join(", ");
}

export function rowCbm(r: DimRow): number {
  const qty = Number(r.qty) || 0;
  const l = Number(r.length) || 0;
  const w = Number(r.width) || 0;
  const h = Number(r.height) || 0;
  return (qty * l * w * h) / 1_000_000;
}

function hasAnyDimensionValue(r: DimRow): boolean {
  return Boolean(r.qty || r.length || r.width || r.height);
}

export function isCompleteDimensionRow(r: DimRow): boolean {
  return (
    (Number(r.qty) || 0) > 0 &&
    (Number(r.length) || 0) > 0 &&
    (Number(r.width) || 0) > 0 &&
    (Number(r.height) || 0) > 0
  );
}

export function dimensionCompleteness(rows: DimRow[]) {
  const entered = rows.filter(hasAnyDimensionValue);
  const complete = entered.filter(isCompleteDimensionRow);
  const incomplete = entered.length - complete.length;
  return {
    enteredRows: entered.length,
    completeRows: complete.length,
    incompleteRows: incomplete,
    hasCompleteDimensions: complete.length > 0 && incomplete === 0,
    hasPartialDimensions: incomplete > 0,
  };
}

export function totalCbm(rows: DimRow[]): number {
  return Math.round(rows.filter(isCompleteDimensionRow).reduce((s, r) => s + rowCbm(r), 0) * 1000) / 1000;
}

export function rowNonStackableCbm(r: DimRow): number {
  const qty = Number(r.qty) || 0;
  const l = Number(r.length) || 0;
  const w = Number(r.width) || 0;
  return (qty * l * w * TWENTY_FOOT_INTERNAL_HEIGHT_CM) / 1_000_000;
}

export function totalChargeableCbm(rows: DimRow[], stackable?: string | null): number {
  const completeRows = rows.filter(isCompleteDimensionRow);
  const raw = stackable === "NO"
    ? completeRows.reduce((s, r) => s + rowNonStackableCbm(r), 0)
    : completeRows.reduce((s, r) => s + rowCbm(r), 0);
  return Math.round(raw * 1000) / 1000;
}
