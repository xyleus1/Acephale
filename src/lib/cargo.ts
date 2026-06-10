// Shared cargo helpers usable from both server and client components.

export type DimRow = { qty: string; length: string; width: string; height: string };

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

export function totalCbm(rows: DimRow[]): number {
  return Math.round(rows.reduce((s, r) => s + rowCbm(r), 0) * 1000) / 1000;
}
