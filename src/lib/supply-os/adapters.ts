import {
  normalizeSupplyCsvBundle,
  type NormalizedSupplyCsvBundle,
  type NormalizeSupplyCsvOptions,
  type SupplyCsvBundle,
} from "./csv-import";

export type SupplyAdapterId = "csv" | "sap" | "oracle";

export type SupplyAdapterStatus = {
  available: boolean;
  reason: string | null;
};

export interface SupplyDataAdapter<TInput = unknown> {
  id: SupplyAdapterId;
  label: string;
  status: SupplyAdapterStatus;
  normalize(input: TInput, options?: NormalizeSupplyCsvOptions): Promise<NormalizedSupplyCsvBundle>;
}

class CsvSupplyDataAdapter implements SupplyDataAdapter<SupplyCsvBundle> {
  readonly id = "csv" as const;
  readonly label = "Mapped CSV";
  readonly status = { available: true, reason: null };

  async normalize(input: SupplyCsvBundle, options?: NormalizeSupplyCsvOptions) {
    return normalizeSupplyCsvBundle(input, options);
  }
}

class UnavailableSupplyDataAdapter implements SupplyDataAdapter<never> {
  readonly status: SupplyAdapterStatus;

  constructor(readonly id: "sap" | "oracle", readonly label: string) {
    this.status = {
      available: false,
      reason: `${label} is registered for contract compatibility but no live connector or credentials are configured.`,
    };
  }

  async normalize(): Promise<NormalizedSupplyCsvBundle> {
    throw new Error(this.status.reason!);
  }
}

export const supplyDataAdapters = Object.freeze({
  csv: new CsvSupplyDataAdapter(),
  sap: new UnavailableSupplyDataAdapter("sap", "SAP"),
  oracle: new UnavailableSupplyDataAdapter("oracle", "Oracle"),
} satisfies Record<SupplyAdapterId, SupplyDataAdapter<never> | SupplyDataAdapter<SupplyCsvBundle>>);

export function getSupplyDataAdapter(id: string): SupplyDataAdapter | undefined {
  return supplyDataAdapters[id as SupplyAdapterId] as SupplyDataAdapter | undefined;
}
