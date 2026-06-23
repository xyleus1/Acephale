import {
  dimensionCompleteness,
  totalChargeableCbm,
  type DimRow,
} from "@/lib/cargo";

export type ParsedCargoVolumeReview = {
  label: string;
  explicitVolume: number;
  computedVolume: number;
  basis: "chargeable_non_stackable" | "dimension_cbm";
};

function normalizeDimensionValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = String(value).trim().replace(",", ".");
  if (!text) return "";
  const number = Number(text);
  return Number.isFinite(number) ? String(number) : "";
}

export function normalizeParsedDimensionRows(value: unknown): DimRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const normalized = {
        qty: normalizeDimensionValue(record.qty ?? record.quantity ?? record.count),
        length: normalizeDimensionValue(record.length ?? record.lengthCm ?? record.l),
        width: normalizeDimensionValue(record.width ?? record.widthCm ?? record.w),
        height: normalizeDimensionValue(record.height ?? record.heightCm ?? record.h),
      };
      return normalized.qty || normalized.length || normalized.width || normalized.height ? normalized : null;
    })
    .filter((row): row is DimRow => !!row);
}

export function parsedDimensionsJson(parsed: Record<string, unknown>): string | null {
  const rows = normalizeParsedDimensionRows(parsed.dimensions);
  return rows.length > 0 ? JSON.stringify(rows) : null;
}

export function parsedPackagesCount(parsed: Record<string, unknown>): number | null {
  const explicit = Number(parsed.packages);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const rows = normalizeParsedDimensionRows(parsed.dimensions);
  const total = rows.reduce((sum, row) => {
    const qty = Number(row.qty);
    return Number.isFinite(qty) && qty > 0 ? sum + qty : sum;
  }, 0);
  return total > 0 ? total : null;
}

export function parsedExplicitVolume(parsed: Record<string, unknown>): number | null {
  const explicit = Number(parsed.volume);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : null;
}

export function parsedComputedDimensionVolume(parsed: Record<string, unknown>): number | null {
  const rows = normalizeParsedDimensionRows(parsed.dimensions);
  const completeness = dimensionCompleteness(rows);
  if (!completeness.hasCompleteDimensions) return null;
  const cbm = totalChargeableCbm(rows, typeof parsed.stackable === "string" ? parsed.stackable : null);
  return Number.isFinite(cbm) && cbm > 0 ? cbm : null;
}

export function parsedDimensionVolume(parsed: Record<string, unknown>): number | null {
  return parsedComputedDimensionVolume(parsed) ?? parsedExplicitVolume(parsed);
}

export function parsedCargoVolumeReview(parsed: Record<string, unknown>): ParsedCargoVolumeReview | null {
  const explicitVolume = parsedExplicitVolume(parsed);
  const computedVolume = parsedComputedDimensionVolume(parsed);
  if (explicitVolume == null || computedVolume == null) return null;

  const tolerance = Math.max(0.05, explicitVolume * 0.05);
  if (Math.abs(explicitVolume - computedVolume) <= tolerance) return null;

  const nonStackable = parsed.stackable === "NO";
  return {
    label: nonStackable ? "Volume basis review" : "Volume conflict",
    explicitVolume,
    computedVolume,
    basis: nonStackable ? "chargeable_non_stackable" : "dimension_cbm",
  };
}
